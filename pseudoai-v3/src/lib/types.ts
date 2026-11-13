export type ModelId = "flax" | "scythe" | "nova";

export type Role = "user" | "assistant";

/** One tool call made by the agent while producing an assistant reply */
export interface ToolTrace {
  name: string;
  /** Short human-readable summary for the UI chip */
  detail: string;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** true when generation was stopped by the user mid-stream */
  stopped?: boolean;
  /** Agent-mode tool calls (assistant messages only) */
  tools?: ToolTrace[];
}

export interface Chat {
  id: string;
  title: string;
  model: ModelId;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

/** Wire format sent to /api/chat */
export interface ApiChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the server actually sends upstream (locked persona + convo + tool turns) */
export interface UpstreamToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface UpstreamChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on role:"tool" turns */
  tool_call_id?: string;
  /** Present on assistant turns that requested tool calls */
  tool_calls?: UpstreamToolCall[];
}

/** SSE events emitted by /api/chat */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; detail: string; ok: boolean }
  | { type: "error"; message: string; code?: number }
  | { type: "done" };
