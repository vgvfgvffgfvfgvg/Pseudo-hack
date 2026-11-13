"use client";

import { ArrowUp, Bot, Square } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { MODEL_REGISTRY } from "@/lib/models";
import { useChatStore } from "@/lib/store";
import type { ModelId } from "@/lib/types";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  model: ModelId;
}

const MAX_HEIGHT = 160;

export function ChatInput({ onSend, onStop, busy, model }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingText = useChatStore((s) => s.streaming?.chatId);
  const agentOn = useChatStore((s) => s.agentMode);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [autoGrow]);

  // Refocus the composer when a generation finishes
  useEffect(() => {
    if (!streamingText) textareaRef.current?.focus();
  }, [streamingText]);

  const submit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || busy) return;
    onSend(text);
    el.value = "";
    el.style.height = "auto";
    el.focus();
  }, [busy, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  return (
    <div className="shrink-0 border-t bg-background/80 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-4 pb-3 pt-3">
        <div
          className={`flex items-end gap-2 rounded-2xl border bg-card p-2 pl-3 transition-colors focus-within:border-primary/60 focus-within:shadow-[0_0_0_3px_var(--glow)] ${
            busy ? "opacity-90" : ""
          }`}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={busy ? "Pseudo is replying…" : "Message Pseudo…"}
            className="scroll-thin max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
            onKeyDown={handleKeyDown}
            onInput={autoGrow}
            aria-label="Message input"
            disabled={false}
          />
          {busy ? (
            <Button
              size="icon"
              onClick={onStop}
              className="size-9 shrink-0 rounded-xl bg-destructive text-white hover:bg-destructive/85"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              className="size-9 shrink-0 rounded-xl"
              title="Send message"
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-1 font-mono text-[10px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate">{MODEL_REGISTRY[model].tag}</span>
            <button
              type="button"
              onClick={() => useChatStore.getState().setAgent(!agentOn)}
              className={`ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-all ${
                agentOn
                  ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_8px_var(--glow)]"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
              }`}
              aria-pressed={agentOn}
              title="Agent mode — Pseudo can use tools (web pages, Wikipedia, calculator) before answering"
            >
              <Bot className="size-3" aria-hidden />
              agent {agentOn ? "on" : "off"}
            </button>
          </span>
          <span className="hidden sm:inline">Enter to send · Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}
