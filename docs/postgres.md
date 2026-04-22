# PostgreSQL + Drizzle

Schema, migrations, and query patterns.

## Connection

- Driver: `postgres` (postgres-js) via `drizzle-orm/postgres-js`.
- URL: `POSTGRES_URL` env var. Default in compose: `postgres://postgres:postgres@postgres:5432/chatui`.
- Two entrypoints into the DB:
  - `lib/db/queries.ts` — has `"server-only"`. Template queries (chats, messages, users).
  - `lib/db/jobs.ts` — no pragma. Imported by both Next routes AND `worker/*`. Lazy singleton inside a `db()` function so `POSTGRES_URL` can be resolved after dotenv loads.

## Tables

| Table        | Source    | Purpose                                                   |
| ------------ | --------- | --------------------------------------------------------- |
| `User`       | template  | Users (incl. anonymous guests). `isAnonymous: boolean`.   |
| `Chat`       | template  | Chat sessions. Unused by our Tabs UI; kept for template.  |
| `Message_v2` | template  | Chat messages. Same as above.                             |
| `Vote_v2`    | template  | Message votes.                                            |
| `Document`   | template  | Template artefacts.                                       |
| `Suggestion` | template  | Template artefacts.                                       |
| `Stream`     | template  | Template resumable-stream metadata.                       |
| `Job`        | **ours**  | The execution-tracking overlay. One row per prompt.       |
| `Result`     | **ours**  | Final output, one-to-one with `Job`. Cascade delete.      |

## `Job`

Defined in `lib/db/schema.ts`.

```ts
export const JOB_TYPES = ["TEXT", "IMAGE"] as const;
export const JOB_STATUSES = [
  "PENDING", "QUEUED", "STARTED", "STREAMING",
  "COMPLETED", "FAILED", "CANCELLED",
] as const;

pgTable("Job", {
  id:             uuid primary key defaultRandom,
  userId:         uuid NOT NULL references User(id),
  prompt:         text NOT NULL,
  type:           varchar enum(JOB_TYPES) NOT NULL,
  status:         varchar enum(JOB_STATUSES) NOT NULL default 'PENDING',
  model:          text,
  inputTokens:    integer,
  outputTokens:   integer,
  totalTokens:    integer,
  estimatedCost:  numeric(12, 6),    // USD
  error:          text,
  createdAt:      timestamp default now NOT NULL,
  updatedAt:      timestamp default now NOT NULL,
  startedAt:      timestamp,
  completedAt:    timestamp,
})
```

### Status transitions

```
PENDING ─ enqueue ─▶ QUEUED ─ worker picks up ─▶ STARTED ─▶ STREAMING ─▶ COMPLETED
                                                                   │
                                                                   ├─▶ FAILED       (3 retries exhausted)
                                                                   └─▶ CANCELLED    (reserved; not used yet)
```

`PENDING → QUEUED` happens inside the worker handler (before dispatch to a processor) — not at enqueue time. That way a crashed worker leaves the row in `PENDING` rather than lying about queue state.

### Invariants

- `COMPLETED` row → `inputTokens`/`outputTokens`/`totalTokens`/`estimatedCost` populated for priced models (gpt-5, gpt-image-1). Enforced by `completeJob` writing them in one transaction with the status flip.
- `FAILED` row → `error` populated. Enforced by `setJobStatus({ status: "FAILED", error })`.
- `startedAt` is set **only** on the `STARTED` transition and never overwritten. Don't add coalesce logic that touches it from another state — see the Date-binding gotcha below.

## `Result`

```ts
pgTable("Result", {
  id:        uuid primary key defaultRandom,
  jobId:     uuid NOT NULL unique references Job(id) on delete cascade,
  output:    text NOT NULL,        // full text (TEXT) OR "data:image/png;base64,..." (IMAGE)
  createdAt: timestamp default now NOT NULL,
})
```

`jobId` is `UNIQUE` so `completeJob` uses `ON CONFLICT (jobId) DO UPDATE` — safe to re-run for idempotency if the final-write step is ever retried.

## Helpers (`lib/db/jobs.ts`)

| Function                          | Writes                                                             | Caller               |
| --------------------------------- | ------------------------------------------------------------------ | -------------------- |
| `createJob({userId,prompt,type})` | inserts a `PENDING` row                                            | `POST /api/jobs`     |
| `setJobStatus({id,status,error?})`| status + updatedAt; `startedAt` on STARTED; `completedAt` on terminal | worker               |
| `completeJob({id,output,...})`    | tx: set COMPLETED + tokens + cost + model + completedAt; upsert Result | worker               |
| `getJob(id)`                      | left-join Job + Result → `{ job, output }`                         | API + worker         |
| `listJobs(filter)`                | userId / type / status / limit / offset                            | `GET /api/jobs`      |

`setJobStatus` is idempotent — repeated `STARTED` calls don't move `startedAt` because the processor only issues it once, and we don't coalesce.

## Migrations

- `drizzle.config.ts` points at `./lib/db/schema.ts`, output `./lib/db/migrations`.
- Two migrations committed:
  - `0000_initial.sql` (from template) — User, Chat, Message_v2, Vote_v2, Document, Suggestion, Stream.
  - `0001_omniscient_stark_industries.sql` (ours) — `Job` + `Result` + FKs.
- Workflow:
  ```bash
  # edit lib/db/schema.ts
  pnpm db:generate          # emits SQL under lib/db/migrations/NNNN_*.sql
  # review + commit the SQL file
  pnpm db:migrate           # applies pending migrations
  ```
- In Docker, the `migrate` compose service runs `pnpm db:migrate` once at `docker compose up`, then exits; `app` and `worker` wait on it via `depends_on: service_completed_successfully`.

### Migration quirk

`pnpm db:generate` initially re-emitted the entire schema in `0001` because no snapshot exists for `0000_initial.sql`. We hand-trimmed the file down to just the `Job` + `Result` statements (both wrapped in `CREATE TABLE IF NOT EXISTS` for idempotency). If you regenerate, check the diff and trim again — or commit a snapshot.

## Gotchas

### Date binding + `sql\`\`` tag

Don't do this:

```ts
// ❌ Throws "TypeError: Received an instance of Date" from Buffer.byteLength
patch.startedAt = sql`coalesce(${jobs.startedAt}, ${now})`;
```

The `postgres` driver can't bind a raw `Date` as an inline parameter without a column type hint — it tries `Buffer.byteLength(date)` and crashes.

Do this:

```ts
// ✅ drizzle knows startedAt is a timestamp column; Date serialises fine
patch.startedAt = now;
```

If you need conditional update logic, handle it in JS (only set the field on the right state transition) rather than pushing it into SQL.

### Don't add `"server-only"` to `lib/db/jobs.ts`

The worker imports it. Adding the pragma will fail `tsc` in the worker and break docker builds.

## Realises

- PRD §4 (token tracking) — `Job.{inputTokens,outputTokens,totalTokens,estimatedCost,model}`.
- PRD §8 (jobs, results) — `Job`, `Result`.
- Action plan §6.
