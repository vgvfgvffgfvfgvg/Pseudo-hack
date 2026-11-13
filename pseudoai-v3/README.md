# Pseudo — AI (v3)

An ultra-fast AI chat that runs in any browser: **real token-by-token streaming**, three model modes, full Markdown rendering, local-first history — now built as a proper **Next.js 16 + TypeScript + Tailwind 4** app.

This is a ground-up overhaul of the original single-file `index.html` + Vercel function project.

---

## What changed from v2 (the original source.zip)

### Fixed
| Issue in v2 | Fix in v3 |
| --- | --- |
| Temperature slider did nothing — the value was never sent to the API | Temperature is sent with every request, clamped per provider server-side |
| “Streaming” cursor was fake — the whole reply was awaited, then dumped | True SSE streaming: `/api/chat` pipes upstream deltas to the browser token-by-token |
| Stop button discarded everything (partial text was never captured) | Stop keeps the partial reply, marks it “Generation stopped” and saves it |
| XSS: copy buttons injected raw message content into inline `onclick` attributes | No inline handlers with content anywhere — React rendering + `addEventListener` only, no `dangerouslySetInnerHTML` |
| Client could send any `system` prompt | **System persona is locked server-side** — client `system` roles are stripped and the locked persona is prepended on every request |
| No input validation, no limits, no timeouts on the serverless function | Zod validation, message/size caps, 55 s upstream timeout, per-IP rate limit, friendly error mapping (401/429/5xx) |
| Frontend contained dead/duplicated provider config (endpoints even disagreed) | Provider endpoints + model ids live only in `src/lib/server/providers.ts`; the client chooses a preset, never a target |
| `user-scalable=no`, no favicon, no meta description | Zoom enabled, custom SVG icon, proper metadata + theme-color |
| Object URLs leaked on export; `alert()`/`prompt()` UX | URLs revoked, dialogs + toasts (sonner) everywhere |

### New
- **AGENT MODE** (v3.2): flip the `agent` toggle in the composer and Pseudo can call server-side tools before answering — `web_fetch` (read any web page), `wikipedia_search`, `calculator`, `now`, plus `web_search` when `TAVILY_API_KEY` is configured. The agent loop (max 6 model steps, 48 s budget) runs entirely on the server; the UI shows live tool chips (`wikipedia_search · Eiffel Tower`) while it works, they stay attached to the finished reply, and the final answer still streams token-by-token. Works on all three models (OpenAI-compatible tool calling on Flax/Scythe, native tool support on Nova's runtime).
- **Regenerate** any last answer; **Retry** on errors; error banner with dismiss.
- **Search across message contents**, not just titles.
- **Third model mode “Nova”** (GLM via the built-in runtime) — works with no setup wherever the Z.AI runtime is provisioned (e.g. this preview environment), so the app is never dead on arrival. See the model availability note below.
- **Deep visual overhaul**: new mint-on-charcoal identity, Space Grotesk / Inter / JetBrains Mono, **light + dark themes** (toggle in the sidebar footer).
- **Full Markdown**: GFM tables, lists, links (forced `rel="noopener"`), syntax-highlighted code blocks with copy buttons.
- Chat history **migrates automatically** from the old v2 localStorage keys (`pseudo_chats_v2`…), so existing users keep their data. The old editable system prompt is dropped — the persona is locked now.
- Debounced localStorage persistence (no write per token), defensive rehydration, legacy schema cleanup.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`), accessibility passes (aria labels, keyboard nav, `prefers-reduced-motion`).

---

## Project structure

```
src/
├── app/
│   ├── api/chat/route.ts      # Streaming chat endpoint (SSE) — validation, rate limit, providers
│   ├── api/models/route.ts    # Reports which models this deployment can actually serve
│   ├── layout.tsx             # Fonts, metadata, theme provider, toasts
│   ├── page.tsx               # The chat app
│   ├── globals.css            # Design tokens (light/dark), markdown + animation styles
│   └── icon.svg               # Favicon / app icon
├── components/pseudo/         # UI: sidebar, messages, markdown, input, tool chips, dialogs, theme
├── hooks/use-chat.ts          # Stream orchestration: send / stop / regenerate / retry / tool events
├── lib/
│   ├── store.ts               # Zustand store + debounced localStorage persistence
│   ├── availability.ts        # Client availability hook (GET /api/models) + auto-fallback
│   ├── models.ts              # Client model registry (presentation only)
│   ├── legacy-migration.ts    # v2 → v3 localStorage migration
│   └── server/
│       ├── agent.ts           # Model-agnostic agent loop (tool_calls → execute → repeat)
│       ├── tools.ts           # Server-side tools: web_fetch, wikipedia_search, calculator, now, web_search
│       ├── providers.ts       # Provider endpoints, key lookup, Nova client/probe (server-only)
│       └── prompt.ts          # The LOCKED system persona + agent addendum (server-only)
└── types/                     # Module shims
```

---

## Running locally

```bash
bun install       # or npm install / pnpm install
bun run dev       # http://localhost:3000
```

With **no configuration at all**, the app boots and the **Nova** mode streams real replies wherever the Z.AI built-in runtime is provisioned — Flax and Scythe show a clear “not configured” error until you add keys.

## Configuration

| Env var | Mode | Provider / model |
| --- | --- | --- |
| `GROQ_API_KEY` | Flax (fast) | Groq · `llama-3.3-70b-versatile` |
| `ZAI_API_KEY` | Scythe (creative) | Z.AI · `glm-4.5-flash` |
| — | Nova (GLM) | Built-in runtime — needs a provisioned `.z-ai-config` |
| `TAVILY_API_KEY` *(optional)* | Agent mode | Adds the `web_search` tool (general web results). Without it the agent still has `web_fetch`, `wikipedia_search`, `calculator`, `now` |

Keys are read **server-side only** and never reach the browser.

## Agent mode

Toggle **agent** in the composer footer (next to the model tag). When on, `/api/chat` runs a server-side tool loop:

1. The model is called with the tool specs (non-streaming, per step).
2. Any `tool_calls` are executed server-side — each tool is time-boxed (10–14 s) and its output capped (~3.5 KB). `web_fetch` blocks private/internal hosts (SSRF guard).
3. Results go back to the model; repeat until a final answer or the budget (max **6 model steps**, **48 s** wall clock) is exhausted.
4. The final answer streams to the browser token-by-token; every tool call is emitted as an SSE `tool` event and rendered as a chip above the reply (persisted in localStorage with the message).

Tools: `web_fetch` (read any public web page as text), `wikipedia_search` (titles + intro extracts + links), `calculator` (arithmetic parser, no `eval`), `now` (server time), and `web_search` (Tavily, only when its key is set). The persona + agent instructions stay **locked server-side** — the client can only turn the mode on/off, never change the prompt or tools.

Agent mode requires at least one available model — availability is checked before the loop starts, so you get a clean error instead of a half-run.

### Model availability (important)

The app never lets you pick a model that can't run: on load the client calls **`GET /api/models`**, which reports real availability per deployment —

- **Flax** → available when `GROQ_API_KEY` is set.
- **Scythe** → available when `ZAI_API_KEY` is set.
- **Nova** → available only where the Z.AI built-in runtime is provisioned (the SDK finds a `.z-ai-config` with `baseUrl` + `apiKey`). This is true in the Z.AI preview environment; **a standard Vercel deployment has no such config, so Nova will report as unavailable there** — its card shows “unavailable” in the sidebar, the header badge flags it, and sending is blocked with an explanatory toast. The selection auto-falls-back to the first working model.

If you self-host somewhere you control, you can enable Nova by placing a `.z-ai-config` JSON file (`{"baseUrl": "…", "apiKey": "…"}`) in the project directory, the user home, or `/etc`. On Vercel the simplest path is: add `GROQ_API_KEY` (free tier) and/or `ZAI_API_KEY` and use Flax/Scythe.

## Deploying to Vercel

1. Push this folder to a Git repo (or run `vercel` from it).
2. In **Vercel → Project → Settings → Environment Variables**, add `GROQ_API_KEY` and/or `ZAI_API_KEY` (Nova is not available on standard Vercel — it needs the Z.AI built-in runtime).
3. Deploy. The streaming route sets `maxDuration = 60`; lower it in `src/app/api/chat/route.ts` if your plan limits function duration.

## Notes & limits

- Conversations are stored **only in the browser** (localStorage). Export a backup from Settings → Export backup. Wire Prisma (already scaffolded in `prisma/`) if you want server-side history.
- The rate limiter is in-memory per server instance — for serious traffic, add Vercel WAF or Upstash Redis.
- Nova streams simulated tokens (the SDK returns the full completion); Flax and Scythe stream true upstream deltas in normal mode. In agent mode every model runs non-streaming per step, and only the final answer is streamed.
- The system persona cannot be changed from the client — by design.
