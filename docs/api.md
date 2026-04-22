# HTTP API

All routes are App Router handlers. Auth is enforced via `await auth()` inside each handler and session-scoped to `session.user.id`. Cross-user access returns 403.

## Our routes

### `POST /api/jobs`

Create and enqueue a job.

**Body** (zod-validated in `app/api/jobs/route.ts`):

```ts
{
  prompt: string (1..10_000),
  type: "TEXT" | "IMAGE",
  model?: string,                // optional override; processor defaults win
}
```

**Responses**:

- `201` → `{ job: Job }` (the newly inserted row in `PENDING`).
- `400` → invalid JSON or schema violation (`{ error, issues }`).
- `401` → no session.

**Side effect:** inserts row, then `enqueueJob(job.id)` → BullMQ. The BullMQ job ID equals the Postgres row ID so a duplicate POST (same row ID) won't create two queue entries.

### `GET /api/jobs`

List the caller's jobs, newest first.

**Query** (zod, all optional):

```ts
{ type?, status?, limit?: 1..200, offset?: 0.. }
```

**Response**: `{ jobs: Job[] }`, ordered by `createdAt DESC`.

### `GET /api/jobs/:id`

**Response**: `{ job: Job, output: string | null }` — `output` is joined from `Result` (null until the job completes).

- `404` if not found.
- `403` if the job belongs to a different user.

### `GET /api/jobs/:id/stream`  (SSE)

Text-only. Replays persisted chunks, then subscribes to the pub/sub channel. See [`redis.md`](./redis.md#text-streaming-protocol) for the protocol.

**Events emitted** (both as `data:` JSON):

- `event: delta` — `data: "<string>"` — a single token delta.
- `event: done` — `data: { done: true }` or `{ error, done: true }` or `{ status: "COMPLETED" | "FAILED" | "CANCELLED" }` (on terminal-before-subscribe).

**Responses**:

- `200` with `content-type: text/event-stream`.
- `400` if job is not `TEXT`.
- `403`/`404` as above.

**Side effects:** increments `lib/system/metrics.activeStreams` on connect; decrements on `cancel()` or terminal `done`.

### `GET /api/system/stats`

**Response**:

```ts
{
  queue:    { waiting, active, completed, failed, delayed, paused },
  worker:   { online: boolean, lastHeartbeat: number | null },
  streams:  { active: number },           // this Next process only
  logs:     Array<{ ts, level, message, ...extra } | { raw: string }>,
}
```

`online` is derived from `Date.now() - lastHeartbeat < 15_000`. Auth required (guest token is fine).

## Template routes (kept, mostly unused)

| Route                                  | Status                                            |
| -------------------------------------- | ------------------------------------------------- |
| `POST /api/chat`                       | Template's direct streaming route. Not used.     |
| `GET /api/chat/[id]/stream`            | Template's resumable-stream endpoint. Not used.  |
| `POST /api/files/upload`               | Vercel Blob upload. Not used.                    |
| `GET /api/history`                     | Template chat history. Not used.                 |
| `GET/POST /api/messages`               | Template messages. Not used.                     |
| `GET /api/models`                      | Template model list. Not used.                   |
| `GET/POST /api/vote`, `/suggestions`, `/document` | Template artefacts. Not used.        |
| `GET/POST /api/auth/[...nextauth]`     | Auth.js handlers. **USED** (required by all API routes). |
| `POST /api/auth/guest`                 | Auto-creates a guest user. **USED** by the middleware redirect. |

Safe to delete later; we kept them because `app/(auth)/auth.ts` and `lib/db/queries.ts` import types/helpers that many of these routes reference. Ripping them out = retest the auth flow.

## Conventions

- Dynamic marker is **implicit**. Do NOT add `export const dynamic = "force-dynamic"` or `export const runtime = "nodejs"` — `next.config.ts` has `cacheComponents: true`, which rejects those exports. Calling `await auth()` (which reads cookies) is enough for Next to infer dynamic.
- Always validate input with zod; `z.enum(JOB_TYPES)` / `z.enum(JOB_STATUSES)` keep SQL and HTTP enums in sync.
- Never trust the client's `userId`. Use `session.user.id` for all ownership checks.
- Prefer `NextResponse.json(...)` over `Response.json(...)` for consistency with Next types.

## Error handling

- Structured errors from the template (`ChatbotError`) are used only in template routes. Our routes return plain `{ error: string }` JSON with appropriate status codes.
- Validation errors return `{ error: "invalid body", issues }` with `issues` from zod. Don't leak internal errors to the client.

## Realises

- PRD §7 (API surface).
- Action plan §7 and phases 3, 4, 5, 8.
