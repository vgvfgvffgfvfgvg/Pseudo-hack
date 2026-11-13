import "server-only";
import { executeTool, toolSpecsForApi } from "./tools";
import type { UpstreamChatMessage } from "@/lib/types";

/**
 * Model-agnostic agent loop: call the model, run any requested tools, feed
 * results back, repeat until a final answer or the budget runs out.
 *
 * The loop itself never talks to a provider — `callModel` is injected, so the
 * same loop serves Flax/Scythe (fetch) and Nova (SDK), and can be unit-tested
 * with a mock.
 */

export const MAX_MODEL_STEPS = 6;

export interface ToolTraceEvent {
  name: string;
  detail: string;
  ok: boolean;
}

/** A model reply in OpenAI message shape (may carry tool_calls). */
export interface ModelReply {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface AgentLoopOptions {
  messages: UpstreamChatMessage[];
  tools: ReturnType<typeof toolSpecsForApi>;
  callModel: (messages: UpstreamChatMessage[]) => Promise<ModelReply>;
  /** Called as soon as a tool finishes, for live UI trace. */
  onToolEvent?: (event: ToolTraceEvent) => void;
  /** Wall-clock budget for the whole loop (ms). */
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface AgentLoopOutcome {
  text: string;
  trace: ToolTraceEvent[];
  steps: number;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopOutcome> {
  const {
    messages,
    tools,
    callModel,
    onToolEvent,
    deadlineMs = 48_000,
    signal,
  } = options;

  const started = Date.now();
  const convo: UpstreamChatMessage[] = [...messages];
  const trace: ToolTraceEvent[] = [];

  for (let step = 0; step < MAX_MODEL_STEPS; step++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() - started > deadlineMs) {
      return { text: "", trace, steps: step };
    }

    const reply = await callModel(convo);

    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { text: reply.content, trace, steps: step + 1 };
    }

    // Record the assistant turn that requested tools (OpenAI conversation shape).
    convo.push({
      role: "assistant",
      content: reply.content || "",
      ...(reply.toolCalls.length > 0
        ? {
            tool_calls: reply.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    });

    for (const call of reply.toolCalls) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const outcome = await executeTool(call.name, call.arguments);
      trace.push({ name: call.name, detail: outcome.detail, ok: outcome.ok });
      onToolEvent?.(trace[trace.length - 1]);

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: outcome.result,
      });
    }
  }

  // Budget exhausted without a final text answer.
  return { text: "", trace, steps: MAX_MODEL_STEPS };
}
