"use client";

import { AlertTriangle, ArrowDown, Code2, Dices, RotateCcw, X, Zap, Atom } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/lib/store";
import { ChatMessageView } from "./chat-message";
import { LogoMark } from "./logo-mark";
import { MarkdownRenderer } from "./markdown-renderer";
import type { Chat } from "@/lib/types";

const SUGGESTIONS = [
  { icon: Dices, label: "Fun fact", prompt: "Tell me a mind-blowing space fact" },
  { icon: Code2, label: "Python code", prompt: "Write a python function for binary search with comments" },
  { icon: Atom, label: "Quantum physics", prompt: "Explain quantum entanglement simply for a 10 year old" },
  { icon: Zap, label: "Productivity", prompt: "Give me 5 actionable tips to boost daily productivity" },
];

interface ChatMessagesProps {
  chat: Chat | undefined;
  onSuggestion: (prompt: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  busy: boolean;
}

export function ChatMessages({ chat, onSuggestion, onRegenerate, onRetry, busy }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = useChatStore((s) => s.streaming);
  const lastError = useChatStore((s) => s.lastError);
  const setError = useChatStore((s) => s.setError);
  const [showJump, setShowJump] = useState(false);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 120;
    setShowJump(distance > 200);
  }, []);

  // Keep pinned to bottom while streaming (only if the user hasn't scrolled up)
  useEffect(() => {
    if (streaming && stickToBottom.current) {
      scrollToBottom();
    }
  }, [streaming?.text, streaming?.chatId, scrollToBottom]);

  // Jump to bottom when switching chats
  useEffect(() => {
    stickToBottom.current = true;
    requestAnimationFrame(() => scrollToBottom());
  }, [chat?.id, scrollToBottom]);

  const messages = chat?.messages ?? [];
  const streamingHere = streaming != null && streaming.chatId === chat?.id;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const isEmpty = messages.length === 0 && !streamingHere;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-thin absolute inset-0 overflow-y-auto"
        aria-live="polite"
      >
        {isEmpty ? (
          <Welcome onSuggestion={onSuggestion} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
            {messages.map((m) => (
              <ChatMessageView
                key={m.id}
                message={m}
                canRegenerate={m.id === lastAssistantId && !busy}
                onRegenerate={onRegenerate}
              />
            ))}

            {/* Streaming ghost bubble */}
            {streamingHere && (
              <div className="msg group flex w-full gap-3">
                <div
                  className="mt-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/25 bg-card"
                  aria-hidden
                >
                  <LogoMark size={30} />
                </div>
                <div className="flex min-w-0 max-w-[min(100%,42rem)] flex-col gap-1 items-start">
                  <div className="w-fit max-w-full rounded-2xl rounded-tl-sm border border-primary/15 bg-bubble-ai px-4 py-3 text-sm leading-relaxed">
                    {streaming.text ? (
                      <>
                        <MarkdownRenderer content={streaming.text} />
                        <span className="stream-cursor" aria-hidden />
                      </>
                    ) : (
                      <span className="flex items-center gap-1 py-1" aria-label="Pseudo is thinking">
                        <span className="thinking-dot size-1.5 rounded-full bg-primary" />
                        <span className="thinking-dot size-1.5 rounded-full bg-primary" />
                        <span className="thinking-dot size-1.5 rounded-full bg-primary" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error banner */}
            {lastError?.chatId === chat?.id && !busy && (
              <div className="anim-fade-up mx-auto flex w-fit items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span className="max-w-[28rem]">{lastError.message}</span>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 border-destructive/40" onClick={onRetry}>
                  <RotateCcw className="size-3" /> Retry
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive/70 hover:text-destructive"
                  onClick={() => setError(chat?.id ?? "", null)}
                  aria-label="Dismiss error"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Jump to latest */}
      <Button
        size="icon"
        className={`absolute bottom-4 right-4 z-10 size-9 rounded-full border bg-card shadow-lg transition-all ${
          showJump ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
        }`}
        onClick={() => scrollToBottom(true)}
        aria-label="Jump to latest message"
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}

function Welcome({ onSuggestion }: { onSuggestion: (prompt: string) => void }) {
  return (
    <div className="flex h-full min-h-full items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full max-w-md flex-col items-center gap-6 text-center"
      >
        <div className="rounded-2xl border border-primary/25 shadow-[0_0_44px_var(--glow)]">
          <LogoMark size={72} className="rounded-2xl" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            I&apos;m <span className="text-primary">Pseudo</span>
          </h1>
          <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
            Ultra-fast AI on any browser.
            <br />
            Pick a mode, or start with a prompt.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSuggestion(prompt)}
              className="flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary hover:shadow-md"
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
