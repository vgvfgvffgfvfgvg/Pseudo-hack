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
- **Regenerate** any last answer; **Retry** on errors; error banner with dismiss.
- **Search across message contents**, not just titles.
- **Third model mode “Nova”** (GLM via the built-in runtime) — works out of the box even without any API keys, so the app is never dead on arrival.
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
│   ├── layout.tsx             # Fonts, metadata, theme provider, toasts
│   ├── page.tsx               # The chat app
│   ├── globals.css            # Design tokens (light/dark), markdown + animation styles
│   └── icon.svg               # Favicon / app icon
├── components/pseudo/         # UI: sidebar, messages, markdown, input, dialogs, theme
├── hooks/use-chat.ts          # Stream orchestration: send / stop / regenerate / retry
├── lib/
│   ├── store.ts               # Zustand store + debounced localStorage persistence
│   ├── models.ts              # Client model registry (presentation only)
│   ├── legacy-migration.ts    # v2 → v3 localStorage migration
│   └── server/
│       ├── providers.ts       # Provider endpoints, key lookup, persona assembly (server-only)
│       └── prompt.ts          # The LOCKED system persona (server-only)
└── types/                     # Module shims
```

---

## Running locally

```bash
bun install       # or npm install / pnpm install
bun run dev       # http://localhost:3000
```

With **no configuration at all**, the app boots and the **Nova** mode streams real replies — Flax and Scythe show a clear “not configured” error until you add keys.

## Configuration

| Env var | Mode | Provider / model |
| --- | --- | --- |
| `GROQ_API_KEY` | Flax (fast) | Groq · `llama-3.3-70b-versatile` |
| `ZAI_API_KEY` | Scythe (creative) | Z.AI · `glm-4.5-flash` |
| — | Nova (GLM) | Built-in runtime, no key needed |

Keys are read **server-side only** and never reach the browser.

## Deploying to Vercel

1. Push this folder to a Git repo (or run `vercel` from it).
2. In **Vercel → Project → Settings → Environment Variables**, add `GROQ_API_KEY` and/or `ZAI_API_KEY`.
3. Deploy. The streaming route sets `maxDuration = 60`; lower it in `src/app/api/chat/route.ts` if your plan limits function duration.

## Notes & limits

- Conversations are stored **only in the browser** (localStorage). Export a backup from Settings → Export backup. Wire Prisma (already scaffolded in `prisma/`) if you want server-side history.
- The rate limiter is in-memory per server instance — for serious traffic, add Vercel WAF or Upstash Redis.
- Nova streams simulated tokens (the SDK returns the full completion); Flax and Scythe stream true upstream deltas.
- The system persona cannot be changed from the client — by design.
