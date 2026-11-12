import "server-only";
import { LOCKED_SYSTEM_PROMPT } from "./prompt";
import type { ApiChatMessage, ModelId } from "@/lib/types";

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
    targetModel: "openai/gpt-oss-120b",
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
 * Builds the final message list. The locked system persona is always
 * prepended and any client-supplied system message is dropped, so the
 * persona can never be changed from the outside.
 */
export function buildUpstreamMessages(messages: ApiChatMessage[]): ApiChatMessage[] {
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  return [{ role: "system", content: LOCKED_SYSTEM_PROMPT }, ...convo];
}

export function clampTemperature(model: ModelId, temperature: number | undefined): number {
  const t = typeof temperature === "number" && Number.isFinite(temperature) ? temperature : 0.7;
  if (model === "flax") return Math.min(2, Math.max(0, t));
  return Math.min(PROVIDERS.scythe.maxTemperature, Math.max(0.05, t));
}
