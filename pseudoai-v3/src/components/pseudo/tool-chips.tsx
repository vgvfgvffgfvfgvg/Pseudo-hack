"use client";

import { BookOpen, Calculator, Clock, Globe, Search, Wrench } from "lucide-react";
import { memo } from "react";
import type { ToolTrace } from "@/lib/types";

const TOOL_ICONS: Record<string, typeof Wrench> = {
  web_fetch: Globe,
  web_search: Search,
  wikipedia_search: BookOpen,
  calculator: Calculator,
  now: Clock,
};

/** Compact trace of the tool calls an agent turn made. */
export const ToolChips = memo(function ToolChips({ tools }: { tools: ToolTrace[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Tool calls used for this reply">
      {tools.map((t, i) => {
        const Icon = TOOL_ICONS[t.name] ?? Wrench;
        return (
          <span
            key={`${t.name}-${i}`}
            className={`inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
              t.ok
                ? "border-primary/25 bg-primary/5 text-muted-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
            title={`${t.name}${t.detail ? `: ${t.detail}` : ""}${t.ok ? "" : " (failed)"}`}
          >
            <Icon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{t.name}</span>
            {t.detail && <span className="truncate opacity-70">· {t.detail}</span>}
          </span>
        );
      })}
    </div>
  );
});
