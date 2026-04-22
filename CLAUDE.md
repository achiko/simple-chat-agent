# CLAUDE.md

Entrypoint for future Claude sessions. Keep this short — detailed per-component specs live under [`docs/`](./docs/).

## What this is

Full-stack AI chat agent built by extending the [`vercel/chatbot`](https://github.com/vercel/chatbot) template with the queue + worker + dashboard architecture described in [`docs/action-plan.md`](./docs/action-plan.md). Every prompt (Text or Image) becomes a **Job** row in Postgres, is enqueued into **BullMQ**, and is executed by a separate **worker** process. Text tokens stream back through **Redis Pub/Sub** to an SSE endpoint, with persisted chunks for reconnect; images are returned as base64 data URLs.

## Tech stack (final)

| Layer                  | Choice                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Framework              | Next.js 16 (App Router, Cache Components) + TypeScript         |
| UI                     | Tailwind 4 + shadcn/ui + Radix + sonner + SWR                  |
| ORM / DB               | Drizzle + PostgreSQL 16                                        |
| Queue / Pub/Sub        | BullMQ + Redis 7 (same Redis for queue, pub/sub, log tail)     |
| AI                     | AI SDK v6 + `@ai-sdk/openai` (`gpt-5` text, `gpt-image-1`)     |
| Auth                   | Auth.js (next-auth 5 beta) — guest mode only                   |
| Tests                  | Playwright                                                     |
| Orchestration          | Single Dockerfile + `docker-compose.yml` (app/worker/migrate/db/redis) |

## Project layout

```
chat-ui/
├── CLAUDE.md                     ← this file
├── docs/                         ← detailed per-component specs
│   ├── action-plan.md            ← original roadmap (source of truth for scope)
│   ├── architecture.md
│   ├── postgres.md
│   ├── redis.md
│   ├── worker.md
│   ├── api.md
│   ├── ui.md
│   ├── auth.md
│   ├── docker.md
│   └── testing.md
├── app/
│   ├── layout.tsx                ← root layout with TabsNav + providers
│   ├── page.tsx                  ← Chat tab
│   ├── history/page.tsx          ← History tab
│   ├── gallery/page.tsx          ← Gallery tab
│   ├── system/page.tsx           ← System tab
│   ├── api/jobs/route.ts         ← POST (create + enqueue), GET (list)
│   ├── api/jobs/[id]/route.ts    ← GET job + result
│   ├── api/jobs/[id]/stream/route.ts  ← SSE: replay + subscribe
│   ├── api/system/stats/route.ts ← dashboard feed
│   ├── (auth)/                   ← template auth (guest-only, kept as-is)
│   └── (chat)/api/*              ← template chat routes (unused by UI, kept for template compat)
├── components/
│   ├── tabs-nav.tsx              ← top navigation
│   ├── chat-tab/                 ← Text|Image composer + SSE client
│   ├── history-tab/              ← SWR-polled list
│   ├── gallery-tab/              ← SWR-polled image grid
│   ├── system-tab/               ← live dashboard
│   └── ui/, chat/, ai-elements/  ← template components (mostly unused)
├── lib/
│   ├── db/
│   │   ├── schema.ts             ← Job + Result + template tables
│   │   ├── jobs.ts               ← helpers shared by Next AND worker (no server-only)
│   │   ├── queries.ts            ← template helpers (server-only)
│   │   └── migrations/           ← Drizzle SQL
│   ├── queue.ts                  ← BullMQ queue, Redis keys, channel helpers
│   ├── pricing.ts                ← env-driven per-token + per-image prices
│   └── system/metrics.ts         ← in-memory active-stream counter
├── worker/
│   ├── index.ts                  ← BullMQ Worker, concurrency 4, retry 3
│   ├── heartbeat.ts              ← SET worker:heartbeat EX 15 every 5s
│   ├── log.ts                    ← capped JSON log list in Redis
│   └── processors/{text,image}.ts
├── Dockerfile                    ← one image, three services
├── docker-compose.yml            ← postgres + redis + migrate + app + worker
└── .env.example                  ← copy to .env.local
```

## Common commands

```bash
# Install + local dev
pnpm install
pnpm dev                           # Next.js on :3000 (auto-reads .env.local)
pnpm exec tsx worker/index.ts      # worker (needs .env.local)
pnpm db:migrate                    # drizzle-kit migrate
pnpm db:generate                   # emit new SQL migration after schema edits

# Full stack, dockerised
docker compose up -d               # builds chat-ui-app:local on first run
docker compose logs -f app worker
docker compose down                # stop, keep data
docker compose down -v             # wipe postgres + redis volumes

# Checks
pnpm exec tsc --noEmit             # typecheck
pnpm exec next build               # production build (skips migrations; compose migrate service runs them)
pnpm test                          # Playwright E2E (requires running stack)
```

## Where to look first for…

| Task                                              | Start here                                      |
| ------------------------------------------------- | ----------------------------------------------- |
| Add a field to a Job / write a migration          | [`docs/postgres.md`](./docs/postgres.md)        |
| Change what flows through Redis / Pub/Sub         | [`docs/redis.md`](./docs/redis.md)              |
| Add a new job type, new processor, retry behaviour| [`docs/worker.md`](./docs/worker.md)            |
| Add or change an HTTP route                       | [`docs/api.md`](./docs/api.md)                  |
| UI surface (tabs, chat composer, dashboard)       | [`docs/ui.md`](./docs/ui.md)                    |
| Auth, cookies, guest user flow                    | [`docs/auth.md`](./docs/auth.md)                |
| Docker image, compose wiring, env                 | [`docs/docker.md`](./docs/docker.md)            |
| E2E tests                                         | [`docs/testing.md`](./docs/testing.md)          |
| Overall data flow / architecture decisions        | [`docs/architecture.md`](./docs/architecture.md)|

## Conventions & gotchas

- **`lib/db/jobs.ts` has NO `"server-only"`.** It's imported from both Next routes and the worker. Don't add the pragma.
- **Drizzle + `postgres` + raw `Date` in `sql\`\`` template literals breaks.** The driver throws `TypeError: Received an instance of Date` from `Buffer.byteLength`. Always assign Dates as plain column values in the `.set({...})` object. See `setJobStatus` for the pattern.
- **Always read `usage` from the AI SDK response for token counts.** Never estimate from prompt length. See `worker/processors/text.ts` and `lib/pricing.ts`.
- **Route segment exports (`export const dynamic`, `export const runtime`) are incompatible with `cacheComponents: true`** (our `next.config.ts`). Next 16 will fail the build. Instead, rely on dynamic APIs (`auth()`, `headers()`, `cookies()`) being called in the route — they implicitly mark it dynamic.
- **`worker/index.ts` loads `.env.local` via `dotenv` at the top.** `tsx` doesn't auto-load env files the way Next.js does. Keep the dotenv calls before any other import that reads `process.env`.
- **The `build` script (`package.json`) runs `tsx lib/db/migrate && next build`.** Inside the Dockerfile we call `pnpm exec next build` directly, because the DB isn't reachable at image-build time — migrations run as a separate `migrate` service in compose.
- **The template's `/api/chat` route and the `app/(chat)/`, `app/(auth)/login`, `app/(auth)/register` template pages still exist** but are not wired into our Tabs UI. Safe to delete later; we kept them to avoid touching template code we don't own.
- **Guest auth is the only auth.** No login UI is exposed. `proxy.ts` auto-creates a guest cookie on first visit. Cross-user isolation is enforced at the API layer by `session.user.id`.
- **pnpm is pinned to 10.32.1** (template's choice). `corepack enable && corepack prepare pnpm@10.32.1 --activate` if your global pnpm is older.

## PRD traceability

- [`prd-draft.md`](./prd-draft.md) — original product requirements.
- [`docs/action-plan.md`](./docs/action-plan.md) — phased build plan. This repo implements all 10 phases; check the bottom of each doc under `docs/` for which PRD/action-plan section it realises.
