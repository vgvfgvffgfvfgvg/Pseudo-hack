declare module "react-syntax-highlighter" {
  import type { ComponentType } from "react";

  export interface SyntaxHighlighterProps {
    language?: string;
    style?: unknown;
    children?: string | string[];
    className?: string;
    showLineNumbers?: boolean;
    wrapLongLines?: boolean;
    customStyle?: React.CSSProperties;
    codeTagProps?: { className?: string; style?: React.CSSProperties };
    [key: string]: unknown;
  }

  export type SyntaxHighlighterComponent = ComponentType<SyntaxHighlighterProps> & {
    registerLanguage(name: string, language: unknown): void;
  };

  export const Prism: SyntaxHighlighterComponent;
  export const PrismLight: SyntaxHighlighterComponent;
  export const Light: SyntaxHighlighterComponent;
  const SyntaxHighlighter: SyntaxHighlighterComponent;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: unknown;
  export const oneLight: unknown;
  export const vscDarkPlus: unknown;
  export const vs: unknown;
}
