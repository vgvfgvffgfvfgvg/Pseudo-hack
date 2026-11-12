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
    codeTagProps?: React.CSSProperties;
    [key: string]: unknown;
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>;
  export const PrismLight: ComponentType<SyntaxHighlighterProps>;
  export const Light: ComponentType<SyntaxHighlighterProps>;
  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: unknown;
  export const oneLight: unknown;
  export const vscDarkPlus: unknown;
  export const vs: unknown;
}
