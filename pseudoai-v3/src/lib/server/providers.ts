import "server-only";
import { AGENT_SYSTEM_ADDENDUM, LOCKED_SYSTEM_PROMPT } from "./prompt";
import type { ApiChatMessage, ModelId, UpstreamChatMessage } from "@/lib/types";

export interface ProviderConfig {
  /** OpenAI-compatible chat completions endpoint */
  apiUrl: string;
  /** Env var that must hold the bearer key */
  keyEnv: "GROQ_API_KEY" | "ZAI_API_KEY";
  /** Upstream model id */
  targetModel: string;
  /** Temperature ceiling tolerated by the provider */
  maxTemperature: number;
  label: string;
}

export const PROVIDERS: Record<"flax" | "scythe", ProviderConfig> = {
  flax: {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    targetModel: "llama-3.3-70b-versatile",
    maxTemperature: 2,
    label: "Flax",
  },
  scythe: {
    apiUrl: "https://api.z.ai/api/paas/v4/chat/completions",
    keyEnv: "ZAI_API_KEY",
    targetModel: "glm-4.5-flash",
    maxTemperature: 0.95,
    label: "Scythe",
  },
};

export function providerApiKey(model: "flax" | "scythe"): string | undefined {
  const cfg = PROVIDERS[model];
  const key = process.env[cfg.keyEnv];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

/**
 * Nova depends on the built-in GLM runtime, which authenticates through a
 * provisioned `.z-ai-config` file (baseUrl + apiKey). That file only exists
 * where the Z.AI runtime is deployed — a standard Vercel deployment has none,
 * so `ZAI.create()` throws there. The client is created once per server
 * instance and reused; probeNova() reports real availability to /api/models.
 */
type NovaClient = Awaited<ReturnType<(typeof import("z-ai-web-dev-sdk"))["default"]["create"]>>;

let novaClientPromise: Promise<NovaClient> | null = null;

export function createNovaClient(): Promise<NovaClient> {
  if (!novaClientPromise) {
    novaClientPromise = import("z-ai-web-dev-sdk")
      .then((m) => m.default.create())
      .catch((err: unknown) => {
        // Allow a later request to retry instead of caching the failure forever.
        novaClientPromise = null;
        throw err;
      });
  }
  return novaClientPromise;
}

export async function probeNova(): Promise<boolean> {
  try {
    await createNovaClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the final message list. The locked system persona is always
 * prepended and any client-supplied system message is dropped, so the
 * persona can never be changed from the outside. In agent mode the locked
 * tool-use instructions are appended to the same system turn.
 */
export function buildUpstreamMessages(messages: ApiChatMessage[], agent = false): UpstreamChatMessage[] {
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  const system = agent ? `${LOCKED_SYSTEM_PROMPT} ${AGENT_SYSTEM_ADDENDUM}` : LOCKED_SYSTEM_PROMPT;
  return [{ role: "system", content: system }, ...convo];
}

export function clampTemperature(model: ModelId, temperature: number | undefined): number {
  const t = typeof temperature === "number" && Number.isFinite(temperature) ? temperature : 0.7;
  if (model === "flax") return Math.min(2, Math.max(0, t));
  return Math.min(PROVIDERS.scythe.maxTemperature, Math.max(0.05, t));
}
