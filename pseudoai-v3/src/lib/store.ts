"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { migrateLegacyIfNeeded } from "./legacy-migration";
import { isModelId } from "./models";
import type { Chat, ChatMessage, ModelId, ToolTrace } from "./types";

export function uid(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ── Debounced localStorage (avoid writing per token during streams) ── */

const FLUSH_MS = 400;
let pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const [key, value] of pendingWrites) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota exceeded — drop silently */
    }
  }
  pendingWrites.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushNow);
}

const debouncedLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    pendingWrites.set(name, value);
    if (!flushTimer) {
      flushTimer = setTimeout(flushNow, FLUSH_MS);
    }
  },
  removeItem: (name) => {
    pendingWrites.delete(name);
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

migrateLegacyIfNeeded();

/* ── Store ──────────────────────────────────────────────────── */

interface StreamingState {
  chatId: string;
  text: string;
  startedAt: number;
  /** Agent-mode tool calls observed so far in this generation */
  tools: ToolTrace[];
}

interface ChatState {
  chats: Chat[];
  activeChatId: string | null;
  currentModel: ModelId;
  temperature: number;
  /** Agent mode: server-side tools may be used to answer (global pref) */
  agentMode: boolean;

  /** In-flight generation buffer (not persisted) */
  streaming: StreamingState | null;
  /** Last generation error for a chat (not persisted) */
  lastError: { chatId: string; message: string } | null;

  createChat: (switchTo?: boolean) => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  switchChat: (id: string) => void;
  setModel: (model: ModelId) => void;
  setTemperature: (t: number) => void;
  setAgent: (on: boolean) => void;

  appendMessage: (chatId: string, msg: ChatMessage) => void;
  setTitleFromFirstMessage: (chatId: string, text: string) => void;
  removeLastAssistant: (chatId: string) => boolean;
  clearAll: () => void;

  setStreaming: (s: StreamingState | null) => void;
  appendDelta: (text: string) => void;
  appendToolTrace: (tool: ToolTrace) => void;
  commitStreaming: (stopped?: boolean) => void;
  setError: (chatId: string, message: string | null) => void;
}

function touchChat(chats: Chat[], id: string, mutate: (chat: Chat) => void): Chat[] {
  return chats.map((c) => {
    if (c.id !== id) return c;
    const clone: Chat = { ...c, messages: [...c.messages] };
    mutate(clone);
    clone.updatedAt = Date.now();
    return clone;
  });
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      currentModel: "flax",
      temperature: 0.7,
      agentMode: false,
      streaming: null,
      lastError: null,

      createChat: (switchTo = true) => {
        const id = uid("chat");
        const model = get().currentModel;
        const chat: Chat = {
          id,
          title: "New conversation",
          model,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        set((s) => ({ chats: [chat, ...s.chats], ...(switchTo ? { activeChatId: id } : {}) }));
        return id;
      },

      deleteChat: (id) => {
        set((s) => {
          const remaining = s.chats.filter((c) => c.id !== id);
          const wasActive = s.activeChatId === id;
          if (remaining.length === 0) {
            const fresh: Chat = {
              id: uid("chat"),
              title: "New conversation",
              model: s.currentModel,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            };
            return { chats: [fresh], activeChatId: wasActive ? fresh.id : s.activeChatId };
          }
          return {
            chats: remaining,
            activeChatId: wasActive ? remaining[0].id : s.activeChatId,
          };
        });
      },

      renameChat: (id, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          chats: touchChat(s.chats, id, (c) => {
            c.title = clean.slice(0, 80);
          }),
        }));
      },

      switchChat: (id) => set({ activeChatId: id }),

      setModel: (model) =>
        set((s) => ({
          currentModel: model,
          chats: s.activeChatId
            ? touchChat(s.chats, s.activeChatId, (c) => {
                c.model = model;
              })
            : s.chats,
        })),

      setTemperature: (t) => set({ temperature: Math.min(1, Math.max(0.1, t)) }),

      setAgent: (on) => set({ agentMode: on }),

      appendMessage: (chatId, msg) =>
        set((s) => ({
          chats: touchChat(s.chats, chatId, (c) => {
            c.messages.push(msg);
          }),
          lastError: s.lastError?.chatId === chatId ? null : s.lastError,
        })),

      setTitleFromFirstMessage: (chatId, text) => {
        const chat = get().chats.find((c) => c.id === chatId);
        if (!chat || chat.messages.length > 1) return;
        const title = text.length > 34 ? `${text.slice(0, 34)}…` : text;
        set((s) => ({
          chats: touchChat(s.chats, chatId, (c) => {
            c.title = title.replace(/\s+/g, " ").trim();
          }),
        }));
      },

      removeLastAssistant: (chatId) => {
        const chat = get().chats.find((c) => c.id === chatId);
        if (!chat) return false;
        const last = chat.messages.at(-1);
        if (!last || last.role !== "assistant") return false;
        set((s) => ({
          chats: touchChat(s.chats, chatId, (c) => {
            c.messages.pop();
          }),
        }));
        return true;
      },

      clearAll: () =>
        set((s) => {
          const fresh: Chat = {
            id: uid("chat"),
            title: "New conversation",
            model: s.currentModel,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
          };
          return { chats: [fresh], activeChatId: fresh.id, lastError: null, streaming: null };
        }),

      setStreaming: (streaming) => set({ streaming }),

      appendDelta: (text) =>
        set((s) =>
          s.streaming ? { streaming: { ...s.streaming, text: s.streaming.text + text } } : {}
        ),

      appendToolTrace: (tool) =>
        set((s) =>
          s.streaming
            ? { streaming: { ...s.streaming, tools: [...s.streaming.tools, tool] } }
            : {}
        ),

      commitStreaming: (stopped = false) => {
        const s = get();
        const streaming = s.streaming;
        if (!streaming) return;
        set({ streaming: null });
        const content = streaming.text;
        if (!content.trim() && stopped) return;
        const msg: ChatMessage = {
          id: uid("msg"),
          role: "assistant",
          content,
          createdAt: Date.now(),
          stopped: stopped || undefined,
          ...(streaming.tools.length > 0 ? { tools: streaming.tools } : {}),
        };
        set((st) => ({
          chats: touchChat(st.chats, streaming.chatId, (c) => {
            c.messages.push(msg);
          }),
        }));
      },

      setError: (chatId, message) =>
        set((s) => ({ lastError: message ? { chatId, message } : null })),
    }),
    {
      name: "pseudo-store-v3",
      version: 1,
      storage: createJSONStorage(() => debouncedLocalStorage),
      partialize: (state) => ({
        chats: state.chats,
        activeChatId: state.activeChatId,
        currentModel: state.currentModel,
        temperature: state.temperature,
        agentMode: state.agentMode,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatState>;
        const chats = Array.isArray(p.chats) ? p.chats : [];
        // Defensive revalidation of persisted data
        const validChats = chats.filter(
          (c): c is Chat =>
            !!c &&
            typeof c.id === "string" &&
            Array.isArray(c.messages) &&
            typeof c.title === "string"
        );
        const activeChatId =
          typeof p.activeChatId === "string" && validChats.some((c) => c.id === p.activeChatId)
            ? p.activeChatId
            : (validChats[0]?.id ?? null);
        return {
          ...current,
          chats: validChats,
          activeChatId,
          currentModel: isModelId(p.currentModel) ? p.currentModel : "flax",
          temperature:
            typeof p.temperature === "number" && p.temperature >= 0.1 && p.temperature <= 1
              ? p.temperature
              : 0.7,
          agentMode: typeof p.agentMode === "boolean" ? p.agentMode : false,
        };
      },
    }
  )
);

/* ── Selectors / helpers ────────────────────────────────────── */

export function useActiveChat(): Chat | undefined {
  return useChatStore((s) => s.chats.find((c) => c.id === s.activeChatId));
}

export function getActiveChat(): Chat | undefined {
  const s = useChatStore.getState();
  return s.chats.find((c) => c.id === s.activeChatId);
}
