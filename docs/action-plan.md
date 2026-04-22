# Action Plan — Next.js AI Chat Agent (V1.1 Full)

Derived from `prd-draft.md`. Single-source build roadmap.

**Base template (mandatory):** [`vercel/chatbot`](https://github.com/vercel/chatbot). We fork its scaffold and extend it with the PRD's queue/worker/dashboard requirements rather than building from scratch.

## 1. Objective

Build a full-stack AI platform that:
- Accepts chat-style prompts (Text or Image).
- Processes every request as a **job** through a BullMQ queue + worker (PRD §3.2).
- Streams text token-by-token over SSE, fed by Redis Pub/Sub, with reconnect support.
- Generates images asynchronously via OpenAI, surfacing them in a gallery.
- Persists full job history, token usage, and cost in Postgres.
- Exposes a live **System** dashboard for queue, worker, and stream observability.

MVP excludes multi-provider support (PRD §15). Auth is "out of scope" in the PRD, but the Vercel template ships Auth.js with a **guest mode** that creates anonymous users — we keep it (cheaper than ripping out) and never show a login UI.

## 2. What the Vercel template already gives us

The following requirements are **already satisfied** by the template and need no net-new work:

| Concern | Provided by template |
|---|---|
| Next.js 15 App Router + TS | ✅ `next`, React Server Components |
| Styling / UI kit | ✅ Tailwind + shadcn/ui + Radix + `lucide-react` |
| Chat UI scaffolding | ✅ messages, streaming bubble, markdown rendering (`streamdown`) |
| AI provider abstraction | ✅ `ai` + `@ai-sdk/react` + `@ai-sdk/provider` (Vercel AI Gateway) |
| **Reconnectable streaming** | ✅ `resumable-stream` + `redis` already wired |
| DB client + migrations | ✅ `drizzle-orm` + `drizzle-kit` (`db:generate`, `db:migrate`, `db:push`, `db:studio`) |
| Auth | ✅ `next-auth` with guest-user flow |
| File storage | ✅ `@vercel/blob` (we won't need it for MVP) |
| Tests | ✅ Playwright configured (`pnpm test`) |
| Lint / format | ✅ Biome via `ultracite` |
| Toasts, SWR, theming | ✅ `sonner`, `swr`, `next-themes` |
| Package manager | ✅ pnpm (pinned `10.32.1`) |

**Stack-changing consequences vs. the prior draft:**

- **ORM is Drizzle, not Prisma.** We adopt it — fighting the template to swap ORMs is pure cost.
- **OpenAI access goes through AI SDK**, not the raw `openai` SDK. `streamText({ model: openai('gpt-5'), ... })` for text; `experimental_generateImage({ model: openai.image('gpt-image-1'), ... })` for images.
- **Resumable streaming is already solved** — we wrap the worker's Redis Pub/Sub output in a `resumable-stream` producer so the existing client-side reconnect "just works."

## 3. What the template does NOT give us (the gap)

The template streams **directly from the API route** to the client. The PRD requires a **queue + worker** for both text and image (PRD §3.2, §3.3, §3.4). So we:

1. **Intercept the chat API route** — instead of calling `streamText` inline, enqueue a BullMQ job and return a stream that waits on Redis Pub/Sub output produced by the worker.
2. **Add a `worker/` process** — a separate Node service run by Docker Compose that consumes the queue and does the OpenAI calls.
3. **Add image generation** — a new prompt-type selector + worker processor + gallery tab.
4. **Add token + cost tracking** — persist `usage` returned by AI SDK on every job.
5. **Add a System dashboard** — new `/system` tab + `/api/system/stats` route backed by BullMQ + Redis introspection.
6. **Add Docker Compose** — local Postgres + Redis so we don't depend on Neon / Upstash during development.

## 4. Confirmed Stack (final)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript (from template) |
| Styling / UI | Tailwind + shadcn/ui + Radix (from template) |
| ORM / DB | **Drizzle** + PostgreSQL 16 |
| Queue / Pub/Sub | BullMQ + Redis 7 (same Redis for queue, Pub/Sub, resumable-stream backplane) |
| AI | AI SDK (`ai`) + `@ai-sdk/openai` — `gpt-5` (text streaming), `gpt-image-1` (images) |
| Resumable streams | `resumable-stream` (from template) |
| Auth | `next-auth` guest mode (from template) — no login UI built |
| Tests | Playwright (from template) |
| Runtime | Node 20+, pnpm 10.32.1 |
| Orchestration | Docker Compose (`app`, `worker`, `redis`, `postgres`) |

## 5. Architecture

```
┌────────┐  POST /api/chat ──▶ enqueue job               ┌────────────┐
│ Client │                                               │ BullMQ     │
│ React  │  GET /api/jobs/:id/stream  (resumable-stream) │  Queue     │
└───┬────┘          ▲                                    └─────┬──────┘
    │ AI SDK        │ SSE                                      │
    │ useChat /     │                                          ▼
    │ EventSource   │                                    ┌────────────┐
    ▼               │                                    │  Worker    │
 ┌──────────────────┴────────────┐       publish chunks  │  (Node)    │
 │  Next.js API (App Router)     │◀──────────────────────┤ AI SDK ───▶│ OpenAI
 │  — chat route enqueues        │   Redis Pub/Sub       │ streamText │ gpt-5
 │  — stream route subscribes    │    + resumable-stream │ generate-  │ gpt-image-1
 │  — system stats route         │                       │ Image      │
 └──────────────┬────────────────┘                       └─────┬──────┘
                │ Drizzle                                      │
                ▼                                              ▼
          ┌──────────┐                              final result, usage, cost
          │ Postgres │◀─────────────────────────────────────────
          └──────────┘
```

## 6. Data Model (Drizzle)

Extend the template's existing schema in `lib/db/schema.ts` with:

`jobs`
- `id` (uuid, pk) · `user_id` (fk → template's `user` table) · `prompt` (text) · `type` enum `TEXT | IMAGE`
- `status` enum `PENDING | QUEUED | STARTED | STREAMING | COMPLETED | FAILED | CANCELLED`
- `input_tokens`, `output_tokens`, `total_tokens` (int, nullable until completion)
- `estimated_cost` (numeric) · `model` (text) · `error` (text, nullable)
- `created_at`, `updated_at`, `started_at`, `completed_at` (timestamps)

`results`
- `id` (uuid, pk) · `job_id` (fk → `jobs.id`, unique) · `output` (text — full text for text jobs, URL / base64 for images)

Migration via `pnpm db:generate && pnpm db:migrate` (scripts already in template).

> We intentionally keep the template's existing `chat`, `message`, `user` tables — the Chat tab still reads from them for conversation continuity. `jobs` is the execution-tracking overlay (History / Gallery / System all read from it).

## 7. API Surface

Adapt / add these routes inside the template's `app/` tree:

| Method | Route | Purpose | Status vs. template |
|---|---|---|---|
| POST | `/api/chat` | **Modified:** instead of inline `streamText`, create a `jobs` row (`PENDING`), enqueue BullMQ, return a `resumable-stream` tied to `job:{id}:stream`. | modified |
| POST | `/api/jobs` | Alias for creating image (and any non-chat-message) jobs. Validate (`zod`), insert row, enqueue. | new |
| GET | `/api/jobs` | Paginated list, filter by `type` / `status`. | new |
| GET | `/api/jobs/:id` | Job + result. | new |
| GET | `/api/jobs/:id/stream` | SSE wrapper around `resumable-stream` for History-tab replay. | new |
| GET | `/api/system/stats` | Queue counts, worker heartbeat, active streams, recent logs. | new |

All inputs validated with `zod` (already a template dep).

## 8. Phased Build

Each phase: **Goal → Tasks → Exit criteria**. Order is chosen so each phase produces a runnable slice.

### Phase 0 — Clone and boot the Vercel template (½ day)
- **Goal:** template runs locally against our own Postgres + Redis.
- **Tasks:**
  - `git clone https://github.com/vercel/chatbot chat-ui-app` into a sibling dir, then merge its contents into our repo (preserving `prd-draft.md` and `docs/`).
  - `pnpm install`.
  - Write `docker-compose.yml` with `postgres:16`, `redis:7`, `app`, `worker` services (worker container started with a placeholder command in this phase).
  - Build `Dockerfile` (multi-stage Next build) and `worker.Dockerfile` (tsx runtime for `worker/index.ts`).
  - Create `.env.local` with `POSTGRES_URL`, `REDIS_URL`, `AUTH_SECRET`, `OPENAI_API_KEY` (Vercel AI Gateway can proxy OpenAI, but for local we point AI SDK directly at OpenAI using `@ai-sdk/openai`).
  - `pnpm db:migrate` against the local Postgres.
  - Verify default chat works end-to-end against OpenAI using template's existing pipeline.
- **Exit:** `docker compose up` boots all four services; default chat page renders; sending a message streams a response (template's direct-streaming path, still unmodified).

### Phase 1 — Extend Drizzle schema (½ day)
- **Goal:** `jobs` + `results` tables live alongside template tables.
- **Tasks:**
  - Add `jobsTable` and `resultsTable` to `lib/db/schema.ts` per §6.
  - `pnpm db:generate` → commit new migration.
  - `pnpm db:migrate`.
  - Add `lib/db/queries.ts` helpers: `createJob`, `setJobStatus`, `listJobs`, `getJob`.
- **Exit:** migration applied; helpers pass a basic smoke check.

### Phase 2 — Queue + worker skeleton (1 day)
- **Goal:** worker consumes BullMQ jobs and drives lifecycle transitions on a no-op job.
- **Tasks:**
  - `pnpm add bullmq ioredis`.
  - `lib/queue.ts` — BullMQ `Queue` (`jobs`) + `QueueEvents`, typed payload `{ jobId: string }`.
  - `worker/index.ts` — BullMQ `Worker`, concurrency = 4, dispatches to `processors/text.ts` or `processors/image.ts` by `type`.
  - `worker/heartbeat.ts` — `SET worker:heartbeat <ts> EX 15` every 5s.
  - Retry config: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }` (PRD §10).
  - Add `worker` service entry to `docker-compose.yml` with the real command (`tsx watch worker/index.ts` in dev).
- **Exit:** enqueuing a placeholder job walks `PENDING → QUEUED → STARTED → COMPLETED` and a row is updated accordingly.

### Phase 3 — Core jobs API (½ day)
- **Goal:** create / read jobs via HTTP.
- **Tasks:** implement `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id` using the Drizzle helpers from Phase 1.
- **Exit:** `curl` round-trips succeed; rows are created and BullMQ picks them up.

### Phase 4 — Text streaming through the queue (2 days — critical path)
- **Goal:** chat messages flow Client → Queue → Worker → Redis → Client, token-by-token, with reconnect.
- **Tasks:**
  - **Worker `processors/text.ts`**: call `streamText({ model: openai('gpt-5'), prompt })` from AI SDK. For every text delta: `RPUSH job:{id}:chunks <delta>` **and** `PUBLISH job:{id}:stream <delta>`.
  - On finish: persist full text to `results`, store `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens` + computed cost, set status `COMPLETED`, publish `{done:true}`.
  - **API `POST /api/chat`** (modify template route): keep template's request parsing + auth; instead of calling `streamText` inline, insert a `jobs` row (`type: TEXT`, `PENDING`) and enqueue BullMQ. Return a `createResumableStreamContext` stream that subscribes to `job:{id}:stream` and replays the `job:{id}:chunks` list on reconnect.
  - **Client:** no changes needed — template's `useChat` hook consumes the response exactly as before.
  - **New `GET /api/jobs/:id/stream`**: SSE variant of the same resumable source, for the History tab to re-watch a completed/in-flight job.
- **Exit:** submit a chat message → tokens stream live (indistinguishable from template's direct path). Kill the browser tab mid-stream and reopen History → replay completes without data loss.

### Phase 5 — Image generation (1 day)
- **Goal:** async image job visible in a new Gallery tab.
- **Tasks:**
  - Add a **type selector** (`Text | Image`) to the chat composer.
  - For `Image` submissions, client POSTs to `/api/jobs` (not `/api/chat`).
  - **Worker `processors/image.ts`**: `experimental_generateImage({ model: openai.image('gpt-image-1'), prompt, size: '1024x1024' })`. Persist URL/base64 to `results.output`; mark `COMPLETED`.
  - Client polls `GET /api/jobs/:id` every 2s until terminal.
- **Exit:** image prompt → gallery card appears with image + prompt + cost.

### Phase 6 — Token tracking + cost (½ day)
- **Goal:** every completed job carries real tokens + cost.
- **Tasks:**
  - `lib/pricing.ts`: per-model price table (input/output per 1M tokens for `gpt-5`; per-image by size for `gpt-image-1`), sourced from env.
  - Always consume the AI SDK response's `usage` object — never estimate from prompt length (mitigates PRD §14 token-miscalc risk).
  - Compute cost and write inside the same transaction that flips status to `COMPLETED`.
- **Exit:** no `COMPLETED` row has null tokens or cost.

### Phase 7 — Tabs UI (1.5 days)
- **Goal:** PRD's four tabs: Chat / History / Gallery / System.
- **Tasks:**
  - Replace template's default layout shell with a `Tabs` component (shadcn) containing all four tabs.
  - **Chat** — template's chat UI, now fed by the queued pipeline from Phase 4 (plus Phase 5's type selector).
  - **History** — reverse-chronological `jobs` list; filters by `type`/`status`; red state for `FAILED` with error text; row click opens `/api/jobs/:id/stream` replay for text.
  - **Gallery** — grid of `COMPLETED` image jobs (prompt + cost).
  - **System** — see Phase 8.
- **Exit:** all four tabs work end-to-end against real backend.

### Phase 8 — System dashboard (1 day)
- **Goal:** live observability.
- **Tasks:**
  - `GET /api/system/stats` returns:
    - Queue counts via `queue.getJobCounts('waiting', 'active', 'completed', 'failed')`.
    - Worker online/offline derived from `worker:heartbeat` TTL presence.
    - Active stream count — in-memory counter in the Next.js process, incremented on SSE/stream connect and decremented on disconnect.
    - Last 50 log lines — worker pushes each log event to a capped Redis list via `LPUSH job-logs` + `LTRIM job-logs 0 49`.
  - System tab polls the route via SWR every 2s.
- **Exit:** enqueue 10 jobs → `waiting` climbs and drains live; log tail scrolls.

### Phase 9 — Retry + error handling (½ day)
- **Goal:** failures are persistent and visible.
- **Tasks:**
  - BullMQ retry already configured (Phase 2). On final failure worker sets `FAILED` and writes `error`.
  - UI surfaces failures in Chat (red bubble with error + `sonner` toast) and History.
- **Exit:** a forced OpenAI 5xx shows 3 retries in logs, then a `FAILED` row with error text in History.

### Phase 10 — Playwright E2E (1 day)
- `tests/chat.spec.ts` — submit text prompt, assert streaming deltas arrive, final tokens + cost render.
- `tests/image.spec.ts` — submit image prompt, wait for completion, assert gallery card.
- `tests/history.spec.ts` — forced failure appears with error; replay streams historical chunks.
- `tests/dashboard.spec.ts` — enqueue 5 jobs, assert counters update.
- CI script: `pnpm test` (template's existing Playwright setup) against `docker compose up`.
- **Exit:** all four specs green.

## 9. Target directory layout

Starting from the template, we add the **bold** items:

```
chat-ui/
├── docker-compose.yml                       (new)
├── Dockerfile                               (new)
├── worker.Dockerfile                        (new)
├── app/                                     (from template — tabs layout edited)
│   ├── (chat)/...                           (template's chat routes)
│   ├── (tabs)/{history,gallery,system}/page.tsx   ← new
│   └── api/
│       ├── chat/route.ts                    (modified: enqueues jobs)
│       ├── jobs/route.ts                    ← new
│       ├── jobs/[id]/route.ts               ← new
│       ├── jobs/[id]/stream/route.ts        ← new
│       └── system/stats/route.ts            ← new
├── components/                              (from template + new tab components)
│   ├── history/*                            ← new
│   ├── gallery/*                            ← new
│   ├── system/*                             ← new
│   └── chat/type-selector.tsx               ← new
├── lib/
│   ├── db/schema.ts                         (modified: + jobs, results)
│   ├── db/queries.ts                        (modified: + job helpers)
│   ├── queue.ts                             ← new
│   └── pricing.ts                           ← new
├── worker/                                  ← new (entire dir)
│   ├── index.ts
│   ├── heartbeat.ts
│   └── processors/{text,image}.ts
└── tests/
    ├── chat.spec.ts                         (from template — adapted)
    ├── image.spec.ts                        ← new
    ├── history.spec.ts                      ← new
    └── dashboard.spec.ts                    ← new
```

## 10. Risks (PRD §14) and mitigations

| Risk | Mitigation |
|---|---|
| Streaming disconnect / tab reload | Template's `resumable-stream` + our `job:{id}:chunks` Redis list: SSE endpoint replays persisted chunks on connect before subscribing to live Pub/Sub. |
| Queue overload | Worker concurrency cap + BullMQ rate limiter; System dashboard surfaces `waiting` backlog early. |
| Token miscalculation | Always read AI SDK's `usage` field; never estimate from prompt length. |
| Redis Pub/Sub message loss | `job:{id}:chunks` append-only list is the source of truth; Pub/Sub is a low-latency fanout hint. |
| Template drift / ORM mismatch | We adopt Drizzle (template's choice) instead of Prisma to keep migrations, tooling, and AI SDK helpers aligned. |

## 11. Milestones

- **M1 — Infra + CRUD:** Phases 0–3.
- **M2 — Streaming via queue:** Phase 4.
- **M3 — Images + cost:** Phases 5–6.
- **M4 — UX + observability:** Phases 7–8.
- **M5 — Hardening:** Phases 9–10.

Rough estimate: **~8 focused engineer-days** (template shaves ~1–2 days off the original estimate by providing chat UI, auth, resumable streams, and tooling for free).

## 12. Out of scope (PRD §15)

Authentication UI (guest-only), multi-provider support, cloud deployment, per-user rate limiting, prompt moderation.

## 13. Verification (end-to-end)

1. `docker compose up` — all four services healthy.
2. Open `http://localhost:3000` → Chat tab, submit a text prompt → tokens stream live → final message shows input/output tokens and USD cost.
3. Submit an image prompt → System tab shows `active = 1` during generation → Gallery tab shows finished image with cost.
4. Kill the worker container mid-text-stream → API marks the job `FAILED` after retries; History shows it with error text.
5. Reopen History on a completed text job → replay streams historical chunks via `resumable-stream`.
6. `pnpm test` — all four Playwright specs pass.
