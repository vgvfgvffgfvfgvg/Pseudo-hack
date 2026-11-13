import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isModelId } from "@/lib/models";
import type { ApiChatMessage, ChatStreamEvent, ModelId, UpstreamChatMessage } from "@/lib/types";
import {
  PROVIDERS,
  buildUpstreamMessages,
  clampTemperature,
  createNovaClient,
  providerApiKey,
  probeNova,
} from "@/lib/server/providers";
import { toolSpecsForApi } from "@/lib/server/tools";
import { runAgentLoop, type ModelReply } from "@/lib/server/agent";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ── Validation ─────────────────────────────────────────────── */

const MAX_BODY_CHARS = 200_000;
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 16_000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(MAX_MESSAGE_CHARS),
});

const bodySchema = z.object({
  model: z.string(),
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  /** Agent mode: the model may call server-side tools before answering. */
  agent: z.boolean().optional(),
});

/* ── Tiny in-memory rate limiter (per server instance) ──────── */

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const window = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  window.push(now);
  hits.set(ip, window);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return window.length > RATE_LIMIT;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

/* ── SSE helpers ────────────────────────────────────────────── */

const encoder = new TextEncoder();

function sseEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Parse an upstream OpenAI-compatible SSE body and yield text deltas. */
async function* upstreamDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
          // ignore malformed keep-alive fragments
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function errorResponse(message: string, status: number, code?: number | string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Wrap plain text in the simulated-token SSE response (shared by Nova & agent finals). */
function simulatedStream(content: string, signal?: AbortSignal): Response {
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const tokens = content.match(/\S+\s*|\s+/g) ?? [content];
      try {
        for (const token of tokens) {
          if (signal?.aborted) break;
          controller.enqueue(sseEvent({ type: "delta", text: token }));
          await new Promise((r) => setTimeout(r, 18));
        }
        controller.enqueue(sseEvent({ type: "done" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function describeUpstreamError(label: string, keyEnv: string, status: number, bodyText: string): string {
  try {
    const data = JSON.parse(bodyText) as { error?: { message?: string } | string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
  } catch {
    /* keep default message */
  }
  if (status === 401) return `${label} rejected its API key — check ${keyEnv}.`;
  if (status === 429) return `${label} is rate limited right now — try again in a moment.`;
  return `${label} request failed (HTTP ${status}).`;
}

/* ── Provider runners (plain chat) ──────────────────────────── */

async function runOpenAiCompat(
  model: "flax" | "scythe",
  messages: ApiChatMessage[],
  temperature: number,
  stream: boolean
): Promise<Response> {
  const cfg = PROVIDERS[model];
  const apiKey = providerApiKey(model);
  if (!apiKey) {
    return errorResponse(
      `${cfg.label} is not configured on this server. Add ${cfg.keyEnv} in your Vercel project settings to enable it.`,
      503,
      "NO_KEY"
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.targetModel,
        messages: buildUpstreamMessages(messages),
        temperature: clampTemperature(model, temperature),
        max_tokens: 2048,
        stream,
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return errorResponse(
      aborted ? `${cfg.label} took too long to respond. Try again.` : `Could not reach ${cfg.label}.`,
      504,
      "UPSTREAM"
    );
  }

  if (!upstream.ok) {
    const body = await upstream.text();
    return errorResponse(
      describeUpstreamError(cfg.label, cfg.keyEnv, upstream.status, body),
      upstream.status,
      "UPSTREAM"
    );
  }

  if (!stream || !upstream.body) {
    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string") {
      return errorResponse(`${cfg.label} returned an unexpected response.`, 502, "BAD_UPSTREAM");
    }
    return NextResponse.json({ reply });
  }

  const upstreamBody = upstream.body;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      try {
        for await (const delta of upstreamDeltas(upstreamBody)) {
          safeEnqueue(sseEvent({ type: "delta", text: delta }));
        }
        safeEnqueue(sseEvent({ type: "done" }));
      } catch {
        safeEnqueue(sseEvent({ type: "error", message: "The stream was interrupted. Please retry." }));
        safeEnqueue(sseEvent({ type: "done" }));
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      // Client disconnected — drop the upstream connection promptly.
      upstreamBody.cancel().catch(() => {});
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Nova runs on the built-in GLM runtime (z-ai-web-dev-sdk, server-side only).
 * The SDK returns the full completion at once, so we simulate a token stream.
 */
async function runNova(messages: ApiChatMessage[], stream: boolean, signal: AbortSignal): Promise<Response> {
  let content: string;
  try {
    const nova = await createNovaClient();
    // Plain chat never produces tool turns, so the upstream list only ever
    // contains system/user/assistant here despite the wider static type.
    const completion = await nova.chat.completions.create({
      messages: buildUpstreamMessages(messages) as unknown as Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
      thinking: { type: "disabled" },
    });
    content = completion.choices[0]?.message?.content ?? "";
  } catch {
    return errorResponse(
      "Nova needs the built-in GLM runtime, which isn't provisioned on this server. Configure GROQ_API_KEY or ZAI_API_KEY to use Flax or Scythe instead.",
      503,
      "NOVA_UNAVAILABLE"
    );
  }

  if (!content.trim()) {
    return errorResponse("Nova returned an empty response. Try again.", 502, "EMPTY");
  }

  if (!stream) {
    return NextResponse.json({ reply: content });
  }

  return simulatedStream(content, signal);
}

/* ── Agent mode ─────────────────────────────────────────────── */

/** Non-streaming single model call with tools — used by the agent loop. */
function novaCallModel(): (messages: UpstreamChatMessage[]) => Promise<ModelReply> {
  return async (messages) => {
    const nova = await createNovaClient();
    // The gateway forwards role:"tool" turns fine even though the SDK's
    // TypeScript surface only lists system/user/assistant (verified at runtime).
    const completion = await nova.chat.completions.create({
      messages: messages as unknown as Array<{ role: "system" | "user" | "assistant"; content: string }>,
      tools: toolSpecsForApi(),
      thinking: { type: "disabled" },
    });
    const raw = completion.choices?.[0]?.message;
    return {
      content: typeof raw?.content === "string" ? raw.content : "",
      toolCalls: (Array.isArray(raw?.tool_calls) ? raw.tool_calls : []).map((tc) => ({
        id: String(tc.id ?? `call_${Math.random().toString(36).slice(2)}`),
        name: String(tc.function?.name ?? ""),
        arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : "{}",
      })),
    };
  };
}

function openAiCompatCallModel(
  model: "flax" | "scythe",
  temperature: number
): (messages: UpstreamChatMessage[]) => Promise<ModelReply> {
  return async (messages) => {
    const cfg = PROVIDERS[model];
    const apiKey = providerApiKey(model);
    if (!apiKey) {
      throw new Error(`${cfg.label} is not configured on this server. Add ${cfg.keyEnv} to use agent mode.`);
    }

    const upstream = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: cfg.targetModel,
        messages,
        temperature: clampTemperature(model, temperature),
        max_tokens: 2048,
        stream: false,
        tools: toolSpecsForApi(),
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      throw new Error(describeUpstreamError(cfg.label, cfg.keyEnv, upstream.status, body));
    }

    const data = (await upstream.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const raw = data.choices?.[0]?.message;
    return {
      content: typeof raw?.content === "string" ? raw.content : "",
      toolCalls: (raw?.tool_calls ?? []).map((tc, i) => ({
        id: String(tc.id ?? `call_${i}`),
        name: String(tc.function?.name ?? ""),
        arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : "{}",
      })),
    };
  };
}

interface AgentStreamOptions {
  model: ModelId;
  messages: ApiChatMessage[];
  temperature: number;
  stream: boolean;
  signal: AbortSignal;
}

async function runAgent(options: AgentStreamOptions): Promise<Response> {
  const { model, messages, temperature, stream, signal } = options;

  // Same availability gates as plain chat, but up-front so the user gets a
  // clean error before any tool activity starts.
  if (model === "nova") {
    if (!(await probeNova())) {
      return errorResponse(
        "Agent mode needs the built-in GLM runtime for Nova, which isn't provisioned on this server. Configure GROQ_API_KEY or ZAI_API_KEY to run the agent on Flax or Scythe.",
        503,
        "NOVA_UNAVAILABLE"
      );
    }
  } else if (!providerApiKey(model)) {
    const cfg = PROVIDERS[model];
    return errorResponse(
      `Agent mode on ${cfg.label} needs ${cfg.keyEnv} in your server settings.`,
      503,
      "NO_KEY"
    );
  }

  const callModel =
    model === "nova" ? novaCallModel() : openAiCompatCallModel(model, temperature);
  const upstreamMessages = buildUpstreamMessages(messages, true);

  if (!stream) {
    const outcome = await runAgentLoop({
      messages: upstreamMessages,
      tools: toolSpecsForApi(),
      callModel,
      signal,
    });
    if (!outcome.text.trim()) {
      return errorResponse(
        "Pseudo ran out of agent steps without reaching a final answer. Try rephrasing or simplifying the task.",
        502,
        "AGENT_LIMIT"
      );
    }
    return NextResponse.json({ reply: outcome.text, trace: outcome.trace });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseEvent(event));
        } catch {
          closed = true;
        }
      };

      try {
        const outcome = await runAgentLoop({
          messages: upstreamMessages,
          tools: toolSpecsForApi(),
          callModel,
          signal,
          onToolEvent: (ev) => safeEnqueue({ type: "tool", name: ev.name, detail: ev.detail, ok: ev.ok }),
        });

        if (!outcome.text.trim()) {
          safeEnqueue({
            type: "error",
            message: signal.aborted
              ? "Generation stopped."
              : "Pseudo ran out of agent steps without reaching a final answer. Try rephrasing or simplifying the task.",
          });
          safeEnqueue({ type: "done" });
          return;
        }

        // Stream the final answer token-by-token (models ran non-streaming above).
        const tokens = outcome.text.match(/\S+\s*|\s+/g) ?? [outcome.text];
        for (const token of tokens) {
          if (signal.aborted) break;
          safeEnqueue({ type: "delta", text: token });
          await new Promise((r) => setTimeout(r, 18));
        }
        safeEnqueue({ type: "done" });
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          safeEnqueue({
            type: "error",
            message: err instanceof Error ? err.message : "The agent run failed unexpectedly.",
          });
          safeEnqueue({ type: "done" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Client stop button aborts req.signal, which unblocks the loop.
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ── Handler ────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return errorResponse("Too many requests — slow down for a minute.", 429, "RATE_LIMITED");
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return errorResponse("Conversation too large.", 413, "TOO_LARGE");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return errorResponse("Invalid JSON body.", 400, "BAD_JSON");
  }

  const check = bodySchema.safeParse(parsedBody);
  if (!check.success) {
    return errorResponse("Invalid request payload.", 400, "BAD_PAYLOAD");
  }

  const { messages, temperature, stream = true, agent = false } = check.data;
  const modelRaw = check.data.model;
  if (!isModelId(modelRaw)) {
    return errorResponse("Unknown model.", 400, "BAD_MODEL");
  }
  const model: ModelId = modelRaw;

  // Never trust client roles: any client "system" turn is dropped here, and the
  // locked Pseudo persona is always prepended server-side (buildUpstreamMessages).
  const convo: ApiChatMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  if (convo.length === 0) {
    return errorResponse("Nothing to send.", 400, "EMPTY");
  }

  if (agent) {
    return runAgent({ model, messages: convo, temperature: temperature ?? 0.7, stream, signal: req.signal });
  }

  if (model === "nova") {
    return runNova(convo, stream, req.signal);
  }
  return runOpenAiCompat(model, convo, temperature ?? 0.7, stream);
}

export function GET() {
  return errorResponse("Method Not Allowed", 405);
}
