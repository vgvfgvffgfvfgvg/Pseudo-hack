export type ModelId = "flax" | "scythe" | "nova";

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** true when generation was stopped by the user mid-stream */
  stopped?: boolean;
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

/** SSE events emitted by /api/chat */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "error"; message: string; code?: number }
  | { type: "done" };
