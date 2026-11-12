import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isModelId } from "@/lib/models";
import type { ApiChatMessage, ChatStreamEvent, ModelId } from "@/lib/types";
import {
  PROVIDERS,
  buildUpstreamMessages,
  clampTemperature,
  providerApiKey,
} from "@/lib/server/providers";

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

/* ── Provider runners ───────────────────────────────────────── */

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
    let message = `${cfg.label} request failed (HTTP ${upstream.status})`;
    try {
      const data = await upstream.json();
      if (data?.error?.message) message = data.error.message;
      else if (typeof data?.error === "string") message = data.error;
    } catch {
      /* keep default message */
    }
    if (upstream.status === 401) message = `${cfg.label} rejected its API key — check ${cfg.keyEnv}.`;
    if (upstream.status === 429)
      message = `${cfg.label} is rate limited right now — try again in a moment.`;
    return errorResponse(message, upstream.status, "UPSTREAM");
  }

  if (!stream || !upstream.body) {
    const data = await upstream.json();
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
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: buildUpstreamMessages(messages).map(
        (m): { role: "user" | "assistant"; content: string } => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })
      ),
      thinking: { type: "disabled" },
    });
    content = completion.choices[0]?.message?.content ?? "";
  } catch {
    return errorResponse(
      "Nova is unavailable on this deployment. Configure GROQ_API_KEY or ZAI_API_KEY to use Flax or Scythe instead.",
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

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const tokens = content.match(/\S+\s*|\s+/g) ?? [content];
      try {
        for (const token of tokens) {
          if (signal.aborted) break;
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

  const { messages, temperature, stream = true } = check.data;
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

  if (model === "nova") {
    return runNova(convo, stream, req.signal);
  }
  return runOpenAiCompat(model, convo, temperature ?? 0.7, stream);
}

export function GET() {
  return errorResponse("Method Not Allowed", 405);
}
