# trade-bot

Quantitative research and intraday trading platform for NSE (Indian stock market).
pnpm monorepo: `apps/worker` (Node/TS backend) + `apps/frontend` (React/Vite UI),
backed by Firebase Realtime Database. Live ticks come from the Paytm Money API.

## Structure
- `apps/worker/src/cli/*-script.ts` — long-running scripts, each extends `BaseScript`
  (`cli/base-script.ts`) for heartbeat/status reporting to Firebase.
- `apps/worker/src/cli/live-stream/` — live tick pipeline: WebSocket ingest →
  per-minute aggregates (OHLCV/RSI/Bollinger) → signals → broadcast to frontend.
- `apps/worker/src/data/providers/` — Paytm Money REST/WebSocket clients.
- `apps/worker/src/firebase/client.ts` — single typed wrapper around Firebase RTDB
  (auth tokens, stock config, favorites, script status).
- `apps/worker/src/config/`, `utils/`, `types/` — env loading, logger, time helpers,
  Slack notifications, shared types.
- `apps/frontend/src/` — React 19 + Vite mobile-first UI; `context/AppContext.jsx`
  owns the live WebSocket connection + Firebase subscriptions.
- `apps/frontend/src/pages/live-ticks/` — Chart.js live charts (Price/RSI/Ratio/Pressure/Volume).
- `cron-config.json` — scheduled jobs (stock sync, OHLCV fetch, signal model).
- `data/`, `models/`, `reports/` — gitignored runtime artifacts, not source.
- `plan.md` — active ML roadmap with phase checklists.

## Conventions

### Worker (TypeScript)
- ESM + `tsx` runtime, strict TS. Always import with explicit `.ts` extensions.
- Scripts subclass `BaseScript`: implement `scriptName`, `run()`, `getMetadata()`.
- Favor small classes wired via constructor-injected callbacks (dependency injection
  over tight coupling) — see `streamer-manager.ts`, `client-broadcaster.ts`.
- Use `createLogger(scriptName)` from `utils/logger.ts`, not raw `console.log`.
- Run `pnpm w typecheck` (`tsc --noEmit`) after worker changes.

### Frontend (React/JSX)
- No semicolons, functional components + hooks only.
- Inline `styles` object defined at the bottom of each file (no CSS modules).
- Theming via CSS variables (`var(--color-*)`, `var(--space-*)`, `var(--font-*)`)
  from `theme.css`.
- Live data flows through `AppContext` (raw WebSocket) + Firebase RTDB `onValue`,
  dispatched by `msg.type`.

### General
- Minimal comments — only for non-obvious WHY (hidden constraints, workarounds).
- Don't add abstractions, error handling, or config beyond what's asked.
- Match the surrounding file's formatting exactly when editing.

## Cost-saving notes
- Never read/grep `node_modules`, `dist`, `apps/frontend/dist`, `.firebase`, or
  `data/ticks/*.ndjson` — large and irrelevant.
- `pnpm-lock.yaml` is huge — skip unless debugging a dependency issue.
- Prefer `apps/worker/src` and `apps/frontend/src` as search roots.
- `.env`, `private.key`, `certificate.crt` are secrets — never read or print contents.
