"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * State-free theme toggle: the icons are swapped purely with CSS `dark:`
 * variants (next-themes sets the class on <html>), so there is no hydration
 * flash and no mounted bookkeeping.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        const dark = document.documentElement.classList.contains("dark");
        setTheme(dark ? "light" : "dark");
        e.currentTarget.blur();
      }}
      title="Toggle theme"
      aria-label="Toggle color theme"
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
