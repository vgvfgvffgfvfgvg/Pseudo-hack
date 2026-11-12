"use client";

import { toast } from "sonner";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useChat } from "@/hooks/use-chat";
import { useChatStore } from "@/lib/store";
import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { ChatMessages } from "./chat-messages";
import { RenameDialog } from "./rename-dialog";
import { SettingsDialog } from "./settings-dialog";
import { Sidebar } from "./sidebar";

const SIDEBAR_PREF_KEY = "pseudo_sidebar_collapsed";

/** Client-only hydration gate without setState-in-effect (lint-safe). */
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PseudoApp() {
  const mounted = useMounted();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SIDEBAR_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  const activeChat = useChatStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const currentModel = useChatStore((s) => s.currentModel);
  const { send, stop, regenerate, retry, busy } = useChat();

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth < 1024) {
      setMobileOpen((v) => !v);
    } else {
      setDesktopCollapsed((v) => {
        localStorage.setItem(SIDEBAR_PREF_KEY, v ? "0" : "1");
        return !v;
      });
    }
  }, []);

  const exportActiveChat = useCallback(() => {
    const chat = useChatStore.getState().chats.find((c) => c.id === useChatStore.getState().activeChatId);
    if (!chat || chat.messages.length === 0) {
      toast.info("Nothing to export yet");
      return;
    }
    let md = `# ${chat.title}\n\n`;
    for (const m of chat.messages) {
      md += `### ${m.role === "user" ? "You" : "Pseudo"}\n\n${m.content}\n\n---\n\n`;
    }
    download(
      `${chat.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "chat"}.md`,
      md,
      "text/markdown"
    );
    toast.success("Conversation exported as Markdown");
  }, []);

  const exportAll = useCallback(() => {
    const chats = useChatStore.getState().chats;
    download(`pseudo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(chats, null, 2), "application/json");
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      send(text);
      if (window.innerWidth < 1024) setMobileOpen(false);
    },
    [send]
  );

  if (!mounted) {
    // Neutral splash avoids hydration mismatch with the persisted store.
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onRename={(id, title) => setRenaming({ id, title })}
        onCloseMobile={() => setMobileOpen(false)}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${desktopCollapsed ? "lg:hidden" : ""}`}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <ChatHeader chat={activeChat} onToggleSidebar={toggleSidebar} onExport={exportActiveChat} />
        <ChatMessages
          chat={activeChat}
          busy={busy}
          onSuggestion={handleSend}
          onRegenerate={regenerate}
          onRetry={retry}
        />
        <ChatInput onSend={handleSend} onStop={stop} busy={busy} model={activeChat?.model ?? currentModel} />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onExportAll={exportAll}
        onClearAll={() => {
          setSettingsOpen(false);
          setClearOpen(true);
        }}
      />

      <RenameDialog
        chatId={renaming?.id ?? null}
        currentTitle={renaming?.title ?? ""}
        onRename={(id, title) => useChatStore.getState().renameChat(id, title)}
        onClose={() => setRenaming(null)}
      />

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all conversations?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every chat stored in this browser. This action cannot be
              undone — consider exporting a backup first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                useChatStore.getState().clearAll();
                toast.success("All conversations deleted");
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
