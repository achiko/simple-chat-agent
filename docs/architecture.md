# Architecture

High-level system overview. For component internals see the sibling specs in this directory.

## Goals (from the PRD)

1. **Fast UX** — text tokens stream to the browser as they are produced.
2. **Reliable execution** — every prompt is a durable job with retries.
3. **Transparent cost** — real token counts + USD price per job, recorded atomically.
4. **Observable state** — queue depth, worker liveness, active streams, and a live log tail on a dedicated tab.

## Services

Four long-running containers + one one-shot:

| Service   | Image / command                       | Purpose                                         |
| --------- | ------------------------------------- | ----------------------------------------------- |
| postgres  | `postgres:16-alpine`                  | Durable store for users, jobs, results, chats.  |
| redis     | `redis:7-alpine`                      | BullMQ queue, Pub/Sub, heartbeat, log tail.     |
| migrate   | `chat-ui-app:local` → `pnpm db:migrate` | One-shot; runs Drizzle migrations, exits 0.   |
| app       | `chat-ui-app:local` → `pnpm start`    | Next.js 16 server on :3000 (UI + HTTP API).     |
| worker    | `chat-ui-app:local` → `pnpm exec tsx worker/index.ts` | BullMQ consumer; calls OpenAI.  |

`app` and `worker` share the same Docker image; compose picks the command. See [`docker.md`](./docker.md).

## Request flow

### Text job (streaming)

```
┌────────┐  POST /api/jobs {type:TEXT}        ┌──────────┐
│ Client │ ───────────────────────────────────▶│  Next.js │
└───┬────┘                                    │  app     │
    │                                         └────┬─────┘
    │                                              │ createJob → Job row PENDING
    │                                              │ enqueueJob → BullMQ
    │    GET /api/jobs/:id/stream  (SSE)           ▼
    │ ◀──────────────── event: delta ─────── ┌──────────┐
    │ ◀──────────────── event: done ─────────│  Redis   │
    │                                        │  (queue  │
    │                                        │  + pub/  │
    │                                        │  sub)    │
    │                                        └────┬─────┘
    │                                             │ BullMQ pops
    │                                             ▼
    │                                       ┌──────────┐   streamText
    │                                       │ Worker   │ ──────────▶  OpenAI gpt-5
    │                                       │          │ ◀────────── token deltas
    │                                       └────┬─────┘
    │                                            │ per delta:
    │                                            │   RPUSH job:{id}:chunks
    │                                            │   PUBLISH job:{id}:stream
    │                                            │ on finish:
    │                                            │   completeJob (tokens + cost)
    │                                            │   PUBLISH {done:true}
    │                                            ▼
    │                                       ┌──────────┐
    └──────────────────────────────────────▶│ Postgres │
                                            │ (Job,    │
                                            │  Result) │
                                            └──────────┘
```

The SSE route (`/api/jobs/:id/stream`) replays the persisted `job:{id}:chunks` list on connect, then subscribes to the pub/sub channel — so reconnects lose no tokens.

### Image job (no streaming)

```
Client ─ POST /api/jobs {type:IMAGE} ─▶ Next.js ─ createJob + enqueue ─▶ Redis
                                                                           │
                                                                           ▼
                                             Worker ─ generateImage ─▶ OpenAI gpt-image-1
                                                │
                                                │ completeJob(output = base64 data URL, cost)
                                                ▼
                                              Postgres
Client ◀── poll GET /api/jobs/:id every 2s ── Next.js
```

## Cross-cutting concerns

### Reconnectable streaming (PRD §14 streaming disconnects)

Two stores per text job in Redis:

- `job:{id}:chunks` — append-only list. The **source of truth** for replay.
- `job:{id}:stream` — pub/sub channel. A low-latency fanout hint; messages are best-effort.

On SSE connect the route reads the whole list, then subscribes. If the job is already terminal, it closes after replay.

### Token tracking (PRD §4, §14)

Processors read `usage.{inputTokens,outputTokens,totalTokens}` from the AI SDK response and compute USD cost via `lib/pricing.ts`. Cost is written in the **same transaction** that flips status to `COMPLETED` (`completeJob` in `lib/db/jobs.ts`). No `COMPLETED` row ever has null tokens/cost for the models we price.

### Retries (PRD §10)

BullMQ job options: `attempts: 3`, `backoff: { type: "exponential", delay: 1000 }`. The worker's try/catch only writes `FAILED` + error text on the **final** attempt, so earlier attempts don't clobber the row.

### Observability (PRD §5)

- `worker:heartbeat` — string timestamp, `EX 15`. Worker refreshes every 5s.
- `job-logs` — capped Redis list of JSON lines (`LPUSH` + `LTRIM 0 49`).
- `lib/system/metrics.ts` — in-memory counter in the Next.js process, incremented on SSE connect and decremented on disconnect.
- `/api/system/stats` aggregates all four signals + `queue.getJobCounts()`.

## Design decisions worth preserving

- **One image for app + worker.** Simpler than two images. Cost is a larger worker container; benefit is one build. See `docker.md`.
- **Route groups kept from template.** `app/(auth)` and `app/(chat)/api/*` are left in place even though the Tabs UI doesn't drive them, because ripping them out breaks imports (e.g. `app/(auth)/auth.ts` is used by every API route). The unused chat routes are inert.
- **`lib/db/jobs.ts` is worker-compatible.** Template's `lib/db/queries.ts` has `"server-only"` and can't be imported by the worker, so job helpers live in a parallel file. Don't merge them.
- **Custom SSE instead of `resumable-stream`.** The template ships `resumable-stream`, but our `chunks` list is already the replay source — wrapping adds complexity without value. We still have the `resumable-stream` dep in case tool-call streams need it later.

## What is NOT in scope (PRD §15)

- Multi-provider support (OpenAI only).
- Login / registration UI (guest-only).
- Per-user rate limiting.
- Cloud deployment (compose is for local + demo).
- Prompt moderation.
