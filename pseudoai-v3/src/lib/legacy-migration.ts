import type { Chat, ChatMessage, ModelId, Role } from "./types";
import { isModelId } from "./models";

/**
 * One-time migration from the legacy Pseudo v2 single-file app
 * (localStorage keys: pseudo_chats_v2 / pseudo_active_chat_id /
 * pseudo_active_model / pseudo_temperature).
 *
 * Must be imported (and invoked) before the zustand store is created so the
 * new `pseudo-store-v3` key already exists when persist rehydrates.
 * The legacy system-prompt preference is intentionally dropped: the persona
 * is locked server-side in v3.
 */
export function migrateLegacyIfNeeded(): void {
  if (typeof window === "undefined") return;

  const NEW_KEY = "pseudo-store-v3";
  const LEGACY_CHATS = "pseudo_chats_v2";

  try {
    if (localStorage.getItem(NEW_KEY)) return;
    const raw = localStorage.getItem(LEGACY_CHATS);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    const now = Date.now();
    const chats: Chat[] = [];
    for (const c of parsed) {
      if (!c || typeof c !== "object" || !Array.isArray(c.messages)) continue;
      const createdAt = typeof c.createdAt === "number" ? c.createdAt : now;
      const messages: ChatMessage[] = c.messages
        .filter((m: unknown): m is { role: string; content: string; timestamp?: number } => {
          const mm = m as { role?: unknown; content?: unknown };
          return (
            !!mm &&
            typeof mm.role === "string" &&
            (mm.role === "user" || mm.role === "ai" || mm.role === "assistant") &&
            typeof mm.content === "string"
          );
        })
        .map((m: { role: string; content: string; timestamp?: number }, i: number) => ({
          id: `m${createdAt}_${i}`,
          role: (m.role === "user" ? "user" : "assistant") as Role,
          content: m.content,
          createdAt: typeof m.timestamp === "number" ? m.timestamp : createdAt + i,
        }));

      chats.push({
        id: typeof c.id === "string" ? c.id : `chat_${createdAt}_${chats.length}`,
        title: typeof c.title === "string" && c.title ? c.title : "Imported conversation",
        model: isModelId(c.model) && c.model !== "nova" ? (c.model as ModelId) : "flax",
        createdAt,
        updatedAt: messages.at(-1)?.createdAt ?? createdAt,
        messages,
      });
    }

    if (chats.length > 0) {
      localStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          state: {
            chats,
            activeChatId: localStorage.getItem("pseudo_active_chat_id") ?? chats[0].id,
            currentModel: localStorage.getItem("pseudo_active_model") ?? "flax",
            temperature: parseFloat(localStorage.getItem("pseudo_temperature") || "0.7") || 0.7,
          },
          version: 1,
        })
      );
    }

    // Retire legacy keys (including the now-locked system prompt).
    localStorage.removeItem(LEGACY_CHATS);
    localStorage.removeItem("pseudo_active_chat_id");
    localStorage.removeItem("pseudo_active_model");
    localStorage.removeItem("pseudo_temperature");
    localStorage.removeItem("pseudo_system_prompt");
    localStorage.removeItem("pseudo_groq_key");
    localStorage.removeItem("pseudo_zai_key");
  } catch {
    // Corrupt legacy data — start fresh rather than crash.
  }
}
