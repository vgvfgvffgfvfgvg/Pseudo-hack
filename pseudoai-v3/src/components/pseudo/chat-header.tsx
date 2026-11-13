"use client";

import { Download, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODEL_REGISTRY } from "@/lib/models";
import { useAvailability } from "@/lib/availability";
import { useChatStore } from "@/lib/store";
import type { Chat } from "@/lib/types";

interface ChatHeaderProps {
  chat: Chat | undefined;
  onToggleSidebar: () => void;
  onExport: () => void;
}

export function ChatHeader({ chat, onToggleSidebar, onExport }: ChatHeaderProps) {
  const streaming = useChatStore(
    (s) => s.streaming != null && s.streaming.chatId === chat?.id
  );
  const availability = useAvailability();
  const model = chat?.model ?? "flax";
  const modelInfo = MODEL_REGISTRY[model];
  const unavailable = !streaming && availability[model] === "unavailable";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/80 px-3 backdrop-blur-md md:pl-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
        <h2 className="truncate text-sm font-semibold">{chat?.title ?? "Pseudo"}</h2>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div
          className={`flex items-center gap-2 rounded-full border bg-card px-3 py-1 font-mono text-[10px] ${
            unavailable ? "border-destructive/40 text-destructive" : "text-muted-foreground"
          }`}
          aria-live="polite"
        >
          <span
            className={`size-1.5 rounded-full ${
              streaming ? "dot-pulse bg-primary" : unavailable ? "bg-destructive" : "bg-primary/70"
            }`}
            aria-hidden
          />
          {streaming
            ? "thinking…"
            : unavailable
              ? `${modelInfo.name.toLowerCase()} · unavailable`
              : `ready · ${modelInfo.name.toLowerCase()}`}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onExport}
          title="Export conversation as Markdown"
          aria-label="Export conversation as Markdown"
        >
          <Download className="size-4" />
        </Button>
      </div>
    </header>
  );
}
