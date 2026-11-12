"use client";

import { Check, Copy } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { useCopyFeedback } from "@/lib/clipboard";
import type { ReactNode } from "react";

/* Register the most common languages; anything else renders as plain text. */
const LANGS: Record<string, unknown> = {
  bash,
  css,
  go,
  java,
  javascript,
  js: javascript,
  json,
  markdown,
  md: markdown,
  python,
  py: python,
  rust,
  sql,
  tsx,
  typescript,
  ts: typescript,
  yaml,
};
for (const [name, lang] of Object.entries(LANGS)) {
  SyntaxHighlighter.registerLanguage(name, lang as never);
}

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in (node as object)) {
    const el = node as { props?: { children?: ReactNode } };
    return nodeText(el.props?.children);
  }
  return "";
}

const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { resolvedTheme } = useTheme();
  const { copied, copy } = useCopyFeedback();
  const dark = resolvedTheme !== "light";
  const known = lang in LANGS;

  return (
    <div className="code-block my-3 overflow-hidden rounded-lg border" style={{ background: "var(--code-bg)" }}>
      <div
        className="flex items-center justify-between px-3 py-1.5 font-mono text-[11px]"
        style={{ background: "var(--code-header-bg)", color: "var(--muted-foreground)" }}
      >
        <span className="uppercase tracking-wider">{known ? lang : "code"}</span>
        <button
          type="button"
          onClick={() => copy(code)}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:text-[var(--primary)]"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={known ? lang : "text"}
        style={dark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "transparent",
          fontSize: "12.5px",
          lineHeight: 1.55,
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-jetbrains-mono), monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});

/**
 * Safe markdown renderer: react-markdown never injects raw HTML, links are
 * forced to new-tab + rel="noopener", and code blocks are highlighted with
 * a copy button.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            const child = Array.isArray(children) ? children[0] : children;
            let lang = "text";
            let code = "";
            if (child && typeof child === "object" && "props" in (child as object)) {
              const el = child as { props?: { className?: string; children?: ReactNode } };
              lang = /language-([\w-]+)/.exec(el.props?.className ?? "")?.[1] ?? "text";
              code = nodeText(el.props?.children).replace(/\n$/, "");
            } else {
              code = nodeText(children).replace(/\n$/, "");
            }
            return <CodeBlock lang={lang} code={code} />;
          },
          a({ href, children }) {
            const safe = typeof href === "string" && /^https?:\/\//i.test(href) ? href : undefined;
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
