# Redis

One Redis instance serves four distinct jobs: BullMQ queue, job chunk persistence, pub/sub fanout, and observability (heartbeat + log tail).

## Connection

- URL: `REDIS_URL`. Default in compose: `redis://redis:6379`.
- Driver: `ioredis`.
- `lib/queue.ts` exposes `createRedis()` which always returns a **new** connection with `maxRetriesPerRequest: null` (required by BullMQ). Call sites that need subscriber semantics must create their own connection — one connection can't be both a subscriber and a publisher in Redis.

## Keys used

| Key                   | Type          | Who writes                              | Who reads                        | TTL          |
| --------------------- | ------------- | --------------------------------------- | -------------------------------- | ------------ |
| `bull:jobs:*`         | BullMQ        | `lib/queue.ts` (producer) + worker      | worker, `/api/system/stats`      | BullMQ mgmt  |
| `job:{id}:chunks`     | LIST          | worker text processor (`RPUSH`)         | SSE route (`LRANGE` on connect)  | 24h (`EXPIRE`) |
| `job:{id}:stream`     | Pub/Sub chan  | worker text processor (`PUBLISH`)       | SSE route (`SUBSCRIBE`)          | n/a          |
| `worker:heartbeat`    | STRING        | `worker/heartbeat.ts` (every 5s)        | `/api/system/stats`              | `EX 15`      |
| `job-logs`            | LIST (cap 50) | `worker/log.ts` (`LPUSH` + `LTRIM 0 49`)| `/api/system/stats`              | n/a          |

Constants defined in `lib/queue.ts`:

```ts
export const JOB_QUEUE_NAME = "jobs";
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const LOG_LIST_KEY = "job-logs";
export const LOG_LIST_MAX = 50;
export function streamChannel(jobId) { return `job:${jobId}:stream`; }
export function chunksKey(jobId)     { return `job:${jobId}:chunks`; }
```

## BullMQ queue

Defined in `lib/queue.ts`.

```ts
new Queue("jobs", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },  // 1s, 2s, 4s
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});
```

- Payload type: `{ jobId: string }`. Everything else lives in Postgres.
- `enqueueJob(jobId)` uses `{ jobId }` as both the `name` option (for human-readable logs) and as the BullMQ **job id**, so a retry from Postgres (e.g. a manual re-enqueue) won't create duplicate entries — BullMQ rejects duplicate IDs.
- Queue events (`QueueEvents`) are exposed via `getQueueEvents()` but not currently wired into the UI. Available for future work (e.g. progress bars).

## Text streaming protocol

Per text job, the worker emits two parallel streams:

1. **Persisted chunks** — `RPUSH job:{id}:chunks <delta>` for every AI SDK `textStream` delta. This is the **source of truth** for replay.
2. **Live pub/sub** — `PUBLISH job:{id}:stream <delta>` for the same delta, plus a terminal `PUBLISH job:{id}:stream '{"done":true}'` (or `'{"error":"...","done":true}'` on failure).

On `COMPLETED`, the chunks list is `EXPIRE`d at 24h so Redis doesn't grow unbounded. History replay of a job older than 24h falls back to reading `Result.output` in one shot (not yet implemented — see TODOs).

SSE route (`/api/jobs/:id/stream`) flow:

```
1. Auth + ownership check.
2. LRANGE job:{id}:chunks 0 -1  → emit each as `event: delta`.
3. If row status is terminal     → emit `event: done` with the status, close.
4. Otherwise SUBSCRIBE job:{id}:stream:
     - plain string message     → `event: delta`
     - JSON with `done: true`   → `event: done`, close, quit redis conns.
5. On client disconnect `cancel()` quits the subscriber + reader and decs the metric.
```

### Why two streams?

- Pub/Sub is **at most once**. Subscribers that connect mid-stream miss earlier messages.
- A persisted list alone can't deliver deltas with sub-second latency without polling.
- Combining them gets us: live latency for in-flight consumers, durability for late/reconnecting ones. The PRD §14 calls out both disconnect recovery and pub/sub drops as risks — this pattern addresses both.

## Worker heartbeat

`worker/heartbeat.ts`:

```ts
await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 15);
```

Called on startup and every 5s. The `/api/system/stats` route reads it and returns `online: Date.now() - lastHeartbeat < 15_000`. If the worker dies, the key expires within 15s and the dashboard flips to offline.

**Single-worker assumption.** This is a single string key, not a set keyed by worker id. Running multiple worker containers is fine (they share the BullMQ queue) but all of them stomp the same heartbeat — "online" means **at least one** worker is alive. Upgrade to a set if per-worker liveness ever matters.

## Log tail

`worker/log.ts`:

```ts
await redis.lpush(LOG_LIST_KEY, JSON.stringify({ ts, level, message, ...extra }));
await redis.ltrim(LOG_LIST_KEY, 0, LOG_LIST_MAX - 1);
```

Levels: `"info" | "warn" | "error"`. Also mirrored to `console.{log,warn,error}`. `/api/system/stats` does `LRANGE job-logs 0 49` and `JSON.parse` each line (with a fallback `{raw}` for anything it can't parse).

## Active-streams counter

**Not in Redis.** Lives in `lib/system/metrics.ts` as a process-local int stashed on `globalThis.__chatUiMetrics`. The dashboard shows SSE connection count **for this Next.js process only**. If you horizontally scale Next, this becomes misleading — move to Redis (`INCR`/`DECR streams:active`) when that happens.

## Gotchas

- **BullMQ requires `maxRetriesPerRequest: null`.** If you create an ioredis connection with the default (20), BullMQ emits a warning and can drop commands during Redis restarts.
- **Pub/Sub + regular commands on the same connection → ioredis errors.** The SSE route creates two connections on purpose: one for `SUBSCRIBE`, one for the `LRANGE` replay.
- **`await redis.quit()` in a request's finally block is important** — otherwise connections leak and ioredis eventually hits its file descriptor limit under load. The `/api/system/stats` route creates a fresh connection per request and quits it in `finally`; the SSE route quits both connections in the `cancel` handler and the `done` path.
- **Pub/Sub delivery is best-effort.** Never treat it as durable — always pair with a persisted store for anything a client must see.

## Realises

- PRD §3.3 (SSE + Redis Pub/Sub flow).
- PRD §11 (`job:{jobId}:stream` channel).
- PRD §5 (queue stats, worker heartbeat, log tail).
- PRD §14 (streaming disconnect + pub/sub drop mitigations).
- Action plan §5 (architecture diagram) and §8 phases 2, 4, 8.
