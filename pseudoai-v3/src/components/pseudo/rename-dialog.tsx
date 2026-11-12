"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface RenameDialogProps {
  chatId: string | null;
  currentTitle: string;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}

export function RenameDialog({ chatId, currentTitle, onRename, onClose }: RenameDialogProps) {
  return (
    <Dialog open={!!chatId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        {chatId && (
          <RenameForm
            key={chatId}
            chatId={chatId}
            initialTitle={currentTitle}
            onRename={onRename}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RenameFormProps {
  chatId: string;
  initialTitle: string;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}

function RenameForm({ chatId, initialTitle, onRename, onClose }: RenameFormProps) {
  const [value, setValue] = useState(initialTitle);

  const submit = () => {
    if (value.trim()) onRename(chatId, value);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename conversation</DialogTitle>
      </DialogHeader>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        maxLength={80}
        autoFocus
        aria-label="Conversation title"
      />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!value.trim()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
