"use client";

import { MessageSquare, PenLine, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MODEL_REGISTRY, MODEL_IDS } from "@/lib/models";
import { availabilityHint, useAvailability } from "@/lib/availability";
import { useChatStore } from "@/lib/store";
import { ThemeToggle } from "./theme-toggle";
import type { ModelId } from "@/lib/types";

interface SidebarProps {
  onOpenSettings: () => void;
  onRename: (id: string, currentTitle: string) => void;
  onCloseMobile: () => void;
  className?: string;
}

export function Sidebar({ onOpenSettings, onRename, onCloseMobile, className }: SidebarProps) {
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const currentModel = useChatStore((s) => s.currentModel);
  const availability = useAvailability();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [chats, query]);

  const newChat = () => {
    useChatStore.getState().createChat(true);
    onCloseMobile();
  };

  return (
    <aside className={className}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3.5">
        <div className="flex items-center gap-2.5">
          <Logo />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 lg:hidden"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* New chat */}
      <div className="px-3.5 pt-3.5">
        <Button onClick={newChat} className="w-full gap-2 font-semibold shadow-sm">
          <Plus className="size-4" /> New chat
        </Button>
      </div>

      {/* Search */}
      <div className="relative px-3.5 py-3">
        <Search className="pointer-events-none absolute left-6.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats and messages…"
          className="h-8 pl-8 text-xs"
          aria-label="Search chats and messages"
        />
      </div>

      {/* History */}
      <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-3" aria-label="Chat history">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
            {query ? `No matches for “${query}”` : "No conversations yet"}
          </p>
        ) : (
          filtered.map((chat) => {
            const active = chat.id === activeChatId;
            return (
              <div
                key={chat.id}
                className={`group/item flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors ${
                  active ? "border-primary/25 bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    useChatStore.getState().switchChat(chat.id);
                    onCloseMobile();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                >
                  <MessageSquare
                    className={`size-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span
                    className={`truncate text-[13px] ${active ? "font-medium text-sidebar-accent-foreground" : "text-muted-foreground group-hover/item:text-foreground"}`}
                  >
                    {chat.title}
                  </span>
                </button>
                <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground group-hover/item:hidden md:block">
                  {formatDistanceToNow(chat.updatedAt, { addSuffix: false })}
                </span>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => onRename(chat.id, chat.title)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    aria-label={`Rename “${chat.title}”`}
                    title="Rename"
                  >
                    <PenLine className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => useChatStore.getState().deleteChat(chat.id)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-destructive"
                    aria-label={`Delete “${chat.title}”`}
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </nav>

      {/* Footer: model cards + prefs */}
      <div className="flex flex-col gap-3 border-t bg-background/60 p-3.5">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Model mode">
          {MODEL_IDS.map((id: ModelId) => {
            const info = MODEL_REGISTRY[id];
            const active = currentModel === id;
            const unavailable = availability[id] === "unavailable";
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-disabled={unavailable || undefined}
                title={unavailable ? (availabilityHint(id) ?? `${info.name} is unavailable`) : undefined}
                onClick={() => {
                  if (unavailable) {
                    toast.info(`${info.name} is unavailable here`, {
                      description: availabilityHint(id),
                    });
                    return;
                  }
                  useChatStore.getState().setModel(id);
                }}
                className={`rounded-lg border px-2 py-2 text-center transition-all ${
                  unavailable
                    ? "cursor-not-allowed border-dashed bg-card/50 opacity-55"
                    : active
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_10px_var(--glow)]"
                      : "bg-card hover:border-muted-foreground/40"
                }`}
              >
                <span
                  className={`block text-xs font-bold ${
                    unavailable ? "text-muted-foreground line-through decoration-1" : active ? "text-primary" : ""
                  }`}
                >
                  {info.name}
                </span>
                <span className="block font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
                  {unavailable ? "unavailable" : info.sub}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted-foreground">Pseudo Studio v3.0</span>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="block size-8 overflow-hidden rounded-lg border border-primary/25">
        <LogoIcon />
      </span>
      <span className="font-display text-lg font-bold tracking-tight">
        Pseudo<span className="text-primary">AI</span>
      </span>
    </span>
  );
}

function LogoIcon() {
  return (
    <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden>
      <defs>
        <linearGradient id="side-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12241c" />
          <stop offset="1" stopColor="#070c0a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="url(#side-bg)" />
      <path
        d="M17 21 L31 32 L17 43"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="35" y="39.5" width="13" height="5.5" rx="2.75" fill="var(--primary)" />
    </svg>
  );
}
