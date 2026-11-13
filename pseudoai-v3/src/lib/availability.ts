"use client";

import { toast } from "sonner";
import { useSyncExternalStore } from "react";
import { useChatStore } from "./store";
import { MODEL_REGISTRY } from "./models";
import type { ModelId } from "./types";

export type Availability = "unknown" | "available" | "unavailable";

export interface AvailabilityStatus {
  available: boolean;
  hint: string;
}

interface AvailabilityReport {
  models: Partial<Record<ModelId, AvailabilityStatus>>;
}

/* ── Module-level snapshot store (fetched once per page load) ── */

type Snapshot = Record<ModelId, Availability>;

let snapshot: Snapshot = { flax: "unknown", scythe: "unknown", nova: "unknown" };
let hints: Partial<Record<ModelId, string>> = {};
const listeners = new Set<() => void>();
let started = false;

function publish(model: ModelId, value: Availability, hint?: string) {
  snapshot = { ...snapshot, [model]: value };
  if (hint) hints = { ...hints, [model]: hint };
  for (const listener of listeners) listener();
}

async function fetchAvailability(): Promise<void> {
  try {
    const res = await fetch("/api/models", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as AvailabilityReport;
    for (const id of Object.keys(snapshot) as ModelId[]) {
      const status = data.models?.[id];
      if (!status) continue;
      publish(id, status.available ? "available" : "unavailable", status.hint);
    }
    applyFallback();
  } catch {
    // Offline or endpoint unreachable — keep "unknown" and let the
    // server-side checks produce their normal error messages.
  }
}

/** If the persisted model can't run here, fall back to one that can. */
function applyFallback(): void {
  const store = useChatStore.getState();
  const current = store.currentModel;
  if (snapshot[current] !== "unavailable") return;

  const fallback = (Object.keys(snapshot) as ModelId[]).find(
    (id) => snapshot[id] === "available"
  );
  if (!fallback) return; // Nothing usable — leave selection untouched.

  store.setModel(fallback);
  toast.info(`${MODEL_REGISTRY[current].name} isn't available on this deployment`, {
    description: hints[current] ?? `Switched to ${MODEL_REGISTRY[fallback].name}.`,
  });
}

function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetchAvailability();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureStarted();
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const getServerSnapshot = (): Snapshot => ({
  flax: "unknown",
  scythe: "unknown",
  nova: "unknown",
});

/** Reactive per-model availability. Subscribing triggers the single fetch. */
export function useAvailability(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function availabilityHint(model: ModelId): string | undefined {
  return hints[model];
}

/** Imperative check for send paths (works outside React). */
export function isModelUnavailable(model: ModelId): boolean {
  return snapshot[model] === "unavailable";
}
