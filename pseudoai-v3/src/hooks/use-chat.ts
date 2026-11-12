"use client";

import { useCallback, useRef } from "react";
import { useChatStore, uid } from "@/lib/store";
import type { ApiChatMessage, ChatStreamEvent } from "@/lib/types";

/**
 * Orchestrates talking to /api/chat: streaming SSE parsing, stop/regenerate,
 * partial-save on abort and error surfacing.
 */
export function useChat() {
  const abortRef = useRef<AbortController | null>(null);

  const busy = useChatStore((s) => s.streaming !== null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const streamReply = useCallback(async (chatId: string, model: string, temperature: number) => {
    const store = useChatStore.getState();
    const chat = store.chats.find((c) => c.id === chatId);
    if (!chat) return;

    const messages: ApiChatMessage[] = chat.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    store.setStreaming({ chatId, text: "", startedAt: Date.now() });
    store.setError(chatId, null);

    const finish = (stopped: boolean) => {
      const s = useChatStore.getState();
      const streaming = s.streaming;
      s.commitStreaming(stopped);
      if (stopped && streaming && !streaming.text.trim()) {
        s.setError(chatId, "Generation stopped before any text arrived.");
      }
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature, stream: true, messages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        useChatStore.getState().setError(chatId, data?.error || `Request failed (HTTP ${res.status})`);
        useChatStore.getState().setStreaming(null);
        return;
      }

      const body = res.body;
      if (!body) {
        useChatStore.getState().setError(chatId, "Empty response stream.");
        useChatStore.getState().setStreaming(null);
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          let event: ChatStreamEvent;
          try {
            event = JSON.parse(payload) as ChatStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "delta") {
            useChatStore.getState().appendDelta(event.text);
          } else if (event.type === "error") {
            useChatStore.getState().setError(chatId, event.message);
          } else if (event.type === "done") {
            sawDone = true;
          }
        }
      }

      if (sawDone || useChatStore.getState().streaming?.text) {
        finish(false);
      } else {
        useChatStore.getState().setStreaming(null);
        useChatStore.getState().setError(chatId, "The response ended unexpectedly. Please retry.");
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      const s = useChatStore.getState();
      if (aborted) {
        finish(true);
      } else {
        s.setStreaming(null);
        s.setError(chatId, err instanceof Error ? err.message : "Unexpected network error.");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      const store = useChatStore.getState();
      if (!clean || store.streaming) return;

      let chat = store.chats.find((c) => c.id === store.activeChatId);
      if (!chat) {
        store.createChat(true);
        chat = useChatStore.getState().chats[0];
      }
      const chatId = chat.id;

      useChatStore.getState().setTitleFromFirstMessage(chatId, clean);
      useChatStore.getState().appendMessage(chatId, {
        id: uid("msg"),
        role: "user",
        content: clean,
        createdAt: Date.now(),
      });

      const current = useChatStore.getState();
      const target = current.chats.find((c) => c.id === chatId);
      await streamReply(chatId, target?.model ?? current.currentModel, current.temperature);
    },
    [streamReply]
  );

  const regenerate = useCallback(async () => {
    const store = useChatStore.getState();
    if (store.streaming || !store.activeChatId) return;
    const chatId = store.activeChatId;
    store.removeLastAssistant(chatId);
    const current = useChatStore.getState();
    const chat = current.chats.find((c) => c.id === chatId);
    if (!chat || chat.messages.length === 0) return;
    await streamReply(chatId, chat.model, current.temperature);
  }, [streamReply]);

  const retry = useCallback(async () => {
    const store = useChatStore.getState();
    if (store.streaming || !store.activeChatId) return;
    const chatId = store.activeChatId;
    const chat = store.chats.find((c) => c.id === chatId);
    if (!chat || chat.messages.length === 0) return;
    await streamReply(chatId, chat.model, store.temperature);
  }, [streamReply]);

  return { send, stop, regenerate, retry, busy };
}
