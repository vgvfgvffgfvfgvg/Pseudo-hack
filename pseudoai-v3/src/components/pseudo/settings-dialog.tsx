"use client";

import { Download, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useChatStore } from "@/lib/store";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExportAll: () => void;
  onClearAll: () => void;
}

export function SettingsDialog({ open, onOpenChange, onExportAll, onClearAll }: SettingsDialogProps) {
  const temperature = useChatStore((s) => s.temperature);
  const setTemperature = useChatStore((s) => s.setTemperature);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Preferences are stored locally in your browser.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* System persona — locked */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="size-3.5 text-primary" />
              System persona
              <span className="rounded border border-primary/30 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-primary">
                locked
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Pseudo&apos;s persona is managed by Pseudo Studio and verified server-side on every
              request. It cannot be edited from the client.
            </p>
          </div>

          {/* Temperature */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Temperature</label>
              <span className="font-mono text-xs text-muted-foreground">{temperature.toFixed(2)}</span>
            </div>
            <Slider
              value={[temperature]}
              min={0.1}
              max={1}
              step={0.05}
              onValueChange={([v]) => setTemperature(v)}
              aria-label="Temperature"
            />
            <p className="text-[11px] text-muted-foreground">
              Lower is precise and factual, higher is more creative.
            </p>
          </div>

          {/* Data */}
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-medium">Data</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1 gap-2"
                onClick={() => {
                  onExportAll();
                  toast.success("Backup downloaded");
                }}
              >
                <Download className="size-4" /> Export backup
              </Button>
              <Button variant="destructive" className="flex-1 gap-2" onClick={onClearAll}>
                <Trash2 className="size-4" /> Clear all
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Chats live only in this browser (localStorage). Export regularly if they matter to you.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
