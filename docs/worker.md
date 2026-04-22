# Worker

The `worker/` directory is a separate Node process (not Next.js). It consumes the BullMQ `jobs` queue and calls OpenAI via the AI SDK.

## Entrypoint (`worker/index.ts`)

```
worker/index.ts  ← top
  ├─ loadEnv('.env.local')   (dotenv, BEFORE any import that reads process.env)
  ├─ create 3 Redis connections: { connection, publisher, logger }
  ├─ startHeartbeat(logger) every 5s
  ├─ new Worker(JOB_QUEUE_NAME, handler, { connection, concurrency: 4 })
  └─ SIGINT/SIGTERM → shutdown: stop heartbeat, worker.close(), redis quits
```

Three Redis connections because roles don't mix:

- `connection` — BullMQ polling/blocking commands. Must have `maxRetriesPerRequest: null`.
- `publisher` — `RPUSH` chunks + `PUBLISH` deltas + control messages.
- `logger` — heartbeat `SET` and log-list `LPUSH`/`LTRIM`.

(ioredis doesn't allow issuing regular commands on a connection that's in subscriber mode, but none of these are subscribers — the split is about ownership clarity and avoiding head-of-line blocking on long BullMQ blocking ops.)

## Handler

```ts
async (bullJob) => {
  const { jobId } = bullJob.data;
  const row = await getJob(jobId);
  if (!row) { pushLog warn "job.missing"; return; }        // silently drop if deleted
  const { job } = row;

  await setJobStatus({ id: job.id, status: "QUEUED" });    // row was PENDING

  try {
    if (job.type === "TEXT")  await processTextJob({ job, publisher, logger });
    else if (job.type === "IMAGE") await processImageJob({ job, logger });
    else throw new Error(`Unknown job type: ${job.type}`);
  } catch (err) {
    // Only persist FAILED on the FINAL attempt.
    if (attemptsMade + 1 >= opts.attempts) {
      await setJobStatus({ id: job.id, status: "FAILED", error: err.message });
      publisher.publish(streamChannel(job.id), '{"error":"...","done":true}');
    }
    throw err;                                             // let BullMQ retry or bury
  }
}
```

### Why `QUEUED` is set **inside** the handler

- An enqueue crash before the row hits `QUEUED` leaves the row in `PENDING`, which is obviously wrong (vs. `QUEUED` lying about queue state).
- After `enqueueJob` returns, we're optimistic — the row stays `PENDING` until a worker picks it up. Short window, but consistent.

### Retry semantics

- BullMQ settings: `attempts: 3`, `backoff: exponential 1s` → attempts run at t, t+1s, t+3s (ish).
- We only persist `FAILED` + publish the sentinel on the **final** attempt. Earlier attempts leave the row as-is (likely `STARTED` or `STREAMING`), so the dashboard's log tail is the source of truth for inter-attempt visibility (`job.failed_attempt` entries).

## Text processor (`worker/processors/text.ts`)

```ts
TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-5";

await setJobStatus(STARTED);
await setJobStatus(STREAMING);
pushLog info "text.start";

const result = streamText({ model: openai(TEXT_MODEL), prompt });
let full = "";
for await (const delta of result.textStream) {
  full += delta;
  await publisher.rpush(chunksKey, delta);
  await publisher.publish(streamChannel, delta);
}

const usage = await result.usage;                            // always read real usage
const cost = estimateTextCost({ model, inputTokens, outputTokens });

await completeJob({ id, output: full, inputTokens, outputTokens, totalTokens, cost, model });
await publisher.publish(streamChannel, '{"done":true}');
await publisher.expire(chunksKey, 24*3600);                  // GC old chunks
```

- `STARTED` → `STREAMING` both fire before the first token — the PRD distinguishes them but the boundary is conceptually instant; kept for status traceability.
- The chunks list is expired after 24h (not deleted) so History replay works in the interim. Long-term replay should fall back to `Result.output` — see TODOs.

## Image processor (`worker/processors/image.ts`)

```ts
IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
IMAGE_SIZE  = process.env.OPENAI_IMAGE_SIZE  ?? "1024x1024";

await setJobStatus(STARTED);
const result = await generateImage({ model: openai.image(IMAGE_MODEL), prompt, size });
const output = `data:image/png;base64,${result.images[0].base64}`;
const cost   = estimateImageCost({ model, size });
await completeJob({ id, output, cost, model });
```

- No streaming; client polls `/api/jobs/:id` every 2s from `components/chat-tab`.
- Output stored as a `data:` URI so the gallery can render it without a CDN or blob-storage layer. Downside: rows are multi-MB of text in Postgres. Acceptable for MVP.

## Adding a new job type

1. Add to `JOB_TYPES` in `lib/db/schema.ts`. `pnpm db:generate` won't write SQL for an enum-as-varchar change (we store as text) — no migration needed.
2. Create `worker/processors/<type>.ts` following the text/image shape: set status, do the work, `completeJob`.
3. Update the handler's `if/else` in `worker/index.ts` to dispatch.
4. If the UI needs to submit it, update `components/chat-tab` (or create a new tab) and the zod schema in `POST /api/jobs`.

## Observability

Every worker action pushes a structured JSON log line to the `job-logs` Redis list via `pushLog(logger, level, message, extra)`. Events emitted today:

| Event                  | level | where                                  |
| ---------------------- | ----- | -------------------------------------- |
| `worker.ready`         | info  | BullMQ `ready` event                   |
| `job.missing`          | warn  | `getJob(id)` returned null             |
| `text.start`           | info  | text processor start                   |
| `text.stream_failed`   | error | in-stream throw (re-thrown for retry)  |
| `text.complete`        | info  | text processor success                 |
| `image.start`          | info  | image processor start                  |
| `image.complete`       | info  | image processor success                |
| `job.failed_attempt`   | error | caught in handler, before rethrow      |
| `worker.failed`        | error | BullMQ `failed` event                  |
| `worker.completed`     | info  | BullMQ `completed` event               |

## Running the worker

- **Locally:** `pnpm exec tsx worker/index.ts` (reads `.env.local` via dotenv).
- **Docker:** `docker compose up -d worker` (shares the `chat-ui-app:local` image; CMD overridden to `pnpm exec tsx worker/index.ts`).

## Gotchas

- **dotenv must load BEFORE any import that reads `process.env`.** We use top-of-file `loadEnv({ path: ".env.local" })` then `loadEnv()` for fallbacks. Moving it below other imports breaks the worker — `lib/queue.ts` throws `REDIS_URL not set`.
- **Don't catch and swallow.** The handler must `throw err` after logging, so BullMQ triggers the retry + backoff. A silent return marks the job "completed" from BullMQ's POV and skips retry.
- **Concurrency 4 is safe for OpenAI** at current rate limits. Bump via `WORKER_CONCURRENCY` env var if you scale up.

## Realises

- PRD §3.2 (async job lifecycle).
- PRD §9 (worker responsibilities).
- PRD §10 (retry + exponential backoff).
- Action plan phases 2, 4, 5, 6, 9.
