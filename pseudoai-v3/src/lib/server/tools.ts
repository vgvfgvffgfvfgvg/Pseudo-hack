import "server-only";
import dns from "node:dns";

// Some environments (this sandbox included) have broken or blocked IPv6 egress;
// undici happily picks AAAA records first and gets reset/403 responses.
// Prefer IPv4 for all server-side fetches — harmless on Vercel.
dns.setDefaultResultOrder("ipv4first");

/**
 * Server-side tools for Pseudo's agent mode.
 *
 * Every tool returns a compact string for the model and a short human-readable
 * `detail` for the UI trace. Executions are time-boxed and output-capped so a
 * single tool call can never blow the function deadline.
 */

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<{ result: string; detail: string }>;
}

/* ── Shared helpers ─────────────────────────────────────────── */

const MAX_RESULT_CHARS = 3_500;
const MAX_FETCH_BYTES = 120_000;

function truncate(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated]`;
}

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

/** Blocks obvious SSRF targets before we fetch a user/model-supplied URL. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "[::1]" || h === "::1" || h.endsWith(".local")) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|p|div|section|article|h[1-6]|li|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── Tools ──────────────────────────────────────────────────── */

const TOOL_UA =
  "PseudoStudioBot/3.1 (agent tool; contact: pseudo-studio@example.com)";

const webFetch: ToolSpec = {
  name: "web_fetch",
  description:
    "Fetch a web page by URL and return its readable text content. Use for reading a specific page the user mentions or that you need to check.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full http(s) URL of the page to fetch" },
    },
    required: ["url"],
  },
  run: async (args) => {
    const raw = asString(args, "url").trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { result: "ERROR: invalid URL.", detail: "invalid url" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { result: "ERROR: only http and https URLs are supported.", detail: "bad scheme" };
    }
    if (isBlockedHost(parsed.hostname)) {
      return { result: "ERROR: that host is not allowed.", detail: parsed.hostname };
    }

    try {
      const res = await fetch(parsed.toString(), {
        headers: { "User-Agent": TOOL_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        return { result: `ERROR: HTTP ${res.status} from ${parsed.hostname}.`, detail: `HTTP ${res.status}` };
      }
      const type = res.headers.get("content-type") ?? "";
      const raw2 = await res.text();
      const body = raw2.slice(0, MAX_FETCH_BYTES);
      const text = type.includes("html") ? htmlToText(body) : body.trim();
      return {
        result: truncate(`Content of ${parsed.toString()}:\n\n${text || "(empty page)"}`),
        detail: parsed.hostname,
      };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return {
        result: timedOut ? "ERROR: the page took too long to respond." : "ERROR: could not fetch that URL.",
        detail: "fetch failed",
      };
    }
  },
};

const wikipediaSearch: ToolSpec = {
  name: "wikipedia_search",
  description:
    "Search Wikipedia and return titles plus summary extracts for the top matches. Use for factual lookups (people, places, events, science).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  run: async (args) => {
    const query = asString(args, "query").trim();
    if (!query) return { result: "ERROR: empty query.", detail: "empty" };

    const api =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
      "&list=search&srlimit=3&srsearch=" +
      encodeURIComponent(query);
    try {
      const res = await fetch(api, {
        headers: { "User-Agent": TOOL_UA, "Api-User-Agent": TOOL_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { result: `ERROR: Wikipedia returned HTTP ${res.status}.`, detail: `HTTP ${res.status}` };
      const data = (await res.json()) as {
        query?: { search?: Array<{ title: string; snippet: string; wordcount: number }> };
      };
      const hits = data.query?.search ?? [];
      if (hits.length === 0) {
        return { result: `No Wikipedia articles matched "${query}".`, detail: "no results" };
      }

      // Pull a clean intro extract for the best hit.
      const titles = hits.map((h) => h.title).join("|");
      const exRes = await fetch(
        "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*" +
          "&prop=extracts&exintro&explaintext&exchars=900&redirects=1&titles=" +
          encodeURIComponent(titles),
        { headers: { "User-Agent": TOOL_UA, "Api-User-Agent": TOOL_UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }
      );
      const exData = (exRes.ok ? await exRes.json() : {}) as {
        query?: { pages?: Record<string, { title: string; extract?: string }> };
      };
      const extracts = Object.values(exData.query?.pages ?? {});

      const lines = hits.map((h, i) => {
        const snip = h.snippet.replace(/<[^>]+>/g, "").trim();
        const ex = extracts.find((p) => p.title === h.title)?.extract?.trim();
        const body = ex ? ex : snip;
        return `${i + 1}. ${h.title} — ${truncate(body, 450)}\n   https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`;
      });
      return {
        result: truncate(`Wikipedia results for "${query}":\n\n${lines.join("\n\n")}`),
        detail: hits[0].title,
      };
    } catch {
      return { result: "ERROR: Wikipedia is unreachable right now.", detail: "unreachable" };
    }
  },
};

/** Optional: real web search via Tavily, enabled only when TAVILY_API_KEY is set. */
const webSearch: ToolSpec = {
  name: "web_search",
  description:
    "Search the web and return the top results with short excerpts. Use when you need current information beyond Wikipedia.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  run: async (args) => {
    const key = process.env.TAVILY_API_KEY?.trim();
    if (!key) return { result: "ERROR: web_search is not configured on this server.", detail: "no key" };
    const query = asString(args, "query").trim();
    if (!query) return { result: "ERROR: empty query.", detail: "empty" };
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: 4, search_depth: "basic" }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { result: `ERROR: search provider returned HTTP ${res.status}.`, detail: `HTTP ${res.status}` };
      const data = (await res.json()) as {
        results?: Array<{ title: string; url: string; content?: string }>;
      };
      const hits = data.results ?? [];
      if (hits.length === 0) return { result: `No web results for "${query}".`, detail: "no results" };
      const lines = hits.map(
        (h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${truncate((h.content ?? "").replace(/\s+/g, " ").trim(), 250)}`
      );
      return { result: truncate(`Web results for "${query}":\n\n${lines.join("\n\n")}`), detail: query };
    } catch {
      return { result: "ERROR: the search provider is unreachable right now.", detail: "unreachable" };
    }
  },
};

const calculator: ToolSpec = {
  name: "calculator",
  description: "Evaluate an arithmetic expression. Supports + - * / % ^ and parentheses.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "e.g. (2+3)*7/5" },
    },
    required: ["expression"],
  },
  run: async (args) => {
    const expr = asString(args, "expression").trim().slice(0, 200);
    if (!expr) return { result: "ERROR: empty expression.", detail: "empty" };
    try {
      const value = evalArithmetic(expr);
      if (!Number.isFinite(value)) return { result: "ERROR: expression did not produce a finite number.", detail: expr };
      return { result: String(value), detail: `${expr} = ${value}` };
    } catch {
      return { result: "ERROR: could not parse that expression.", detail: expr };
    }
  },
};

/** Tiny recursive-descent parser — no eval, no Function constructor. */
function evalArithmetic(src: string): number {
  let pos = 0;
  const skip = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  };
  const peek = () => (skip(), src[pos]);
  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      const c = peek();
      if (c === "+") { pos++; left += parseTerm(); }
      else if (c === "-") { pos++; left -= parseTerm(); }
      else return left;
    }
  };
  const parseTerm = (): number => {
    let left = parsePower();
    for (;;) {
      const c = peek();
      if (c === "*") { pos++; left *= parsePower(); }
      else if (c === "/") { pos++; left /= parsePower(); }
      else if (c === "%") { pos++; left %= parsePower(); }
      else return left;
    }
  };
  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === "^") { pos++; return Math.pow(base, parsePower()); }
    return base;
  };
  const parseUnary = (): number => {
    const c = peek();
    if (c === "-") { pos++; return -parseUnary(); }
    if (c === "+") { pos++; return parseUnary(); }
    return parseAtom();
  };
  const parseAtom = (): number => {
    skip();
    if (src[pos] === "(") {
      pos++;
      const v = parseExpr();
      if (peek() !== ")") throw new Error("missing )");
      pos++;
      return v;
    }
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    if (start === pos) throw new Error(`unexpected token at ${pos}`);
    const num = Number(src.slice(start, pos));
    if (!Number.isFinite(num)) throw new Error("bad number");
    return num;
  };
  const result = parseExpr();
  skip();
  if (pos !== src.length) throw new Error("trailing input");
  return result;
}

const now: ToolSpec = {
  name: "now",
  description: "Get the current date and time on the server (UTC and ISO 8601).",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const d = new Date();
    return {
      result: `Current server time: ${d.toUTCString()} (ISO: ${d.toISOString()})`,
      detail: d.toISOString().slice(0, 16).replace("T", " ") + " UTC",
    };
  },
};

/* ── Registry ───────────────────────────────────────────────── */

export const TOOLS: ToolSpec[] = [webSearch, webFetch, wikipediaSearch, calculator, now]
  // web_search only exists when a search key is configured.
  .filter((t) => t.name !== "web_search" || !!process.env.TAVILY_API_KEY?.trim());

export function toolSpecsForApi() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toolByName(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

export async function executeTool(
  name: string,
  rawArguments: string
): Promise<{ result: string; detail: string; ok: boolean }> {
  const tool = toolByName(name);
  if (!tool) {
    return { result: `ERROR: unknown tool "${name}".`, detail: name, ok: false };
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return { result: `ERROR: invalid arguments for ${name}.`, detail: name, ok: false };
  }
  try {
    const out = await Promise.race([
      tool.run(args),
      new Promise<{ result: string; detail: string }>((_, reject) =>
        setTimeout(() => reject(new Error("tool timeout")), 14_000)
      ),
    ]);
    return { ...out, ok: !out.result.startsWith("ERROR") };
  } catch {
    return { result: `ERROR: ${name} failed.`, detail: name, ok: false };
  }
}
