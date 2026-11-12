import type { ModelId } from "./types";

export interface ModelInfo {
  id: ModelId;
  name: string;
  sub: string;
  tag: string;
}

/**
 * Client-side model registry. Only presentation metadata lives here —
 * provider endpoints, model names and keys are resolved server-side
 * (src/lib/server/providers.ts) so the client cannot choose arbitrary targets.
 */
export const MODEL_REGISTRY: Record<ModelId, ModelInfo> = {
  flax: {
    id: "flax",
    name: "Flax",
    sub: "Fast mode",
    tag: "flax · fast & versatile",
  },
  scythe: {
    id: "scythe",
    name: "Scythe",
    sub: "Creative mode",
    tag: "scythe · creative mode",
  },
  nova: {
    id: "nova",
    name: "Nova",
    sub: "GLM mode",
    tag: "nova · deep reasoning",
  },
};

export const MODEL_IDS: ModelId[] = ["flax", "scythe", "nova"];

export function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as ModelId);
}
