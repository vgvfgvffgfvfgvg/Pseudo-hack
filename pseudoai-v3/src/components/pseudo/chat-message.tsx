"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "./logo-mark";
import { MarkdownRenderer } from "./markdown-renderer";
import { useCopyFeedback } from "@/lib/clipboard";
import type { ChatMessage as ChatMessageType } from "@/lib/types";

interface ChatMessageProps {
  message: ChatMessageType;
  /** Last assistant message → gets the regenerate affordance */
  canRegenerate: boolean;
  onRegenerate: () => void;
  disabled?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const ChatMessageView = memo(function ChatMessageView({
  message,
  canRegenerate,
  onRegenerate,
  disabled,
}: ChatMessageProps) {
  const { copied, copy } = useCopyFeedback();
  const isUser = message.role === "user";

  return (
    <div className={`msg group flex w-full gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`mt-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-[11px] font-bold font-mono ${
          isUser
            ? "border-primary/20 bg-secondary text-accent-foreground"
            : "border-primary/25 bg-card"
        }`}
        aria-hidden
      >
        {isUser ? "ME" : <LogoMark size={30} />}
      </div>

      {/* Bubble + actions */}
      <div className={`flex min-w-0 max-w-[min(100%,42rem)] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`w-fit max-w-full rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "rounded-tr-sm border bg-bubble-user"
              : "rounded-tl-sm border border-primary/15 bg-bubble-ai"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <>
              <MarkdownRenderer content={message.content} />
              {message.stopped && (
                <p className="mt-2 text-xs italic text-muted-foreground">Generation stopped</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:opacity-50">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
            {formatTime(message.createdAt)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => copy(message.content)}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          {!isUser && canRegenerate && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onRegenerate}
              disabled={disabled}
            >
              <RefreshCw className="size-3" />
              Regenerate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
