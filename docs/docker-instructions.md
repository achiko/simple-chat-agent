# Docker Instructions

Operational runbook: how to run, rebuild, reset, and troubleshoot the stack locally with Docker. For the architecture / design rationale (why the Dockerfile looks like it does, why one image serves three services, etc.), see [`docker.md`](./docker.md).

## Prerequisites

- Docker Desktop (or equivalent) running. Compose v2 syntax is used throughout.
- A populated `.env.local` in the repo root. Copy from `.env.example`:
  ```bash
  cp .env.example .env.local
  ```
  Fill in at minimum `AUTH_SECRET` and `OPENAI_API_KEY`. Everything else has a sensible default.

## Services

`docker compose up` brings up five services defined in `docker-compose.yml`:

| Service    | Image                | Purpose                                      | Port  |
| ---------- | -------------------- | -------------------------------------------- | ----- |
| `postgres` | `postgres:16-alpine` | Primary database                             | 5432  |
| `redis`    | `redis:7-alpine`     | BullMQ queue + pub/sub + log tail            | 6379  |
| `migrate`  | `chat-ui-app:local`  | One-shot: runs Drizzle migrations, then exits | —    |
| `app`      | `chat-ui-app:local`  | Next.js server                               | 3000  |
| `worker`   | `chat-ui-app:local`  | BullMQ worker (text + image processors)      | —     |

Start order is enforced by `depends_on`:

```
postgres (healthy) ──▶ migrate (exit 0) ──┬─▶ app
                                          └─▶ worker
redis    (healthy) ──▶ app, worker
```

## Common workflows

### First-time boot

```bash
docker compose up -d
docker compose logs -f app worker        # watch it come up; Ctrl-C to detach
```

Open http://localhost:3000. A guest session cookie is set automatically on first visit.

### Check status

```bash
docker compose ps                        # service status + health
docker compose logs -f <service>         # tail logs
docker compose logs --since 5m worker    # last 5 min of worker logs
```

### Stop / start without losing data

```bash
docker compose stop                      # stop containers, keep volumes + images
docker compose start                     # resume
```

### Rebuild after a code change

The `migrate` service is the only one with a `build:` block, so it's the one that triggers image builds:

```bash
docker compose build migrate             # rebuilds chat-ui-app:local
docker compose up -d --force-recreate app worker
```

Or in one shot (rebuilds and recreates everything that changed):

```bash
docker compose up -d --build
```

### Run only migrations

Against the already-running DB, without touching `app` / `worker`:

```bash
docker compose run --rm migrate
```

### Shell into a running service

```bash
docker exec -it chat-ui-app-1    sh
docker exec -it chat-ui-worker-1 sh
docker exec -it chat-ui-postgres-1 psql -U postgres -d chatui
docker exec -it chat-ui-redis-1   redis-cli
```

## Resetting to a fresh copy

Three levels, from lightest to heaviest. Pick the minimum that fixes your problem.

### 1. Reset DB + queue state only (keep image)

Fastest way to clear chat history, job rows, and Redis queue without a rebuild:

```bash
docker compose down -v                   # -v removes named volumes
docker compose up -d
```

`migrate` will re-run on the empty DB and re-create the schema.

### 2. Force-rebuild the image (keep DB)

Use when you changed code but the image didn't pick it up:

```bash
docker compose build --no-cache migrate
docker compose up -d --force-recreate
```

### 3. Full wipe — "like a fresh copy"

Nuke everything related to this project (containers, volumes, image, build cache) and rebuild from scratch. **This deletes all local chat data.**

```bash
# 1. Stop and remove containers + volumes (DB, queue)
docker compose down -v

# 2. Remove the project image
docker rmi chat-ui-app:local

# 3. (optional) Drop this project's build cache
docker builder prune -f --filter label=com.docker.compose.project=chat-ui

# 4. Rebuild from scratch and start
docker compose build --no-cache
docker compose up -d
```

Verify:

```bash
docker compose ps                        # all healthy / up
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # expect 200 (after redirect) or 307
docker compose logs migrate | grep "Migrations completed"
docker compose logs worker  | grep "worker.ready"
```

## Environment variables at runtime

The compose file layers env in this order (later wins):

1. `x-common-env` YAML anchor — sets `NODE_ENV`, `POSTGRES_URL`, `REDIS_URL` to the compose-internal hostnames (`postgres:5432`, `redis:6379`).
2. `env_file: .env.local` — brings in `AUTH_SECRET`, `OPENAI_API_KEY`, pricing envs, etc.
3. `environment:` block — re-applies the anchor so the compose hostnames always win over anything in `.env.local`.

If you're running the worker directly on the host (not in Docker), `POSTGRES_URL` must point at `localhost:5432`, not `postgres:5432`.

See [`docker.md`](./docker.md) for the full env var table.

## Troubleshooting

**`migrate` exits non-zero with connection refused.**
Postgres wasn't healthy yet. `depends_on: service_healthy` should prevent this — if it still happens, check `docker compose logs postgres` for a crash. On Apple Silicon the first pull can take extra time; retry `docker compose up -d`.

**App or worker exits immediately.**
Usually a missing env var. Check logs:
```bash
docker compose logs app
docker compose logs worker
```
Common culprits: missing `AUTH_SECRET`, missing `OPENAI_API_KEY`, bad `POSTGRES_URL`.

**"relation already exists" on migrate.**
Schema drift between your migrations folder and the volume's state. Easiest fix: `docker compose down -v && docker compose up -d` to re-run migrations on an empty DB. For production-ish data you'd reconcile with `drizzle-kit` instead.

**App returns 307 on `/`.**
Expected. The proxy middleware issues a redirect to set the guest auth cookie on first visit. Follow the redirect (`curl -L`) or just open the URL in a browser.

**Port 3000 / 5432 / 6379 already in use.**
Another local service is bound. Either stop the other service, or change the host-side port in `docker-compose.yml` (e.g. `"3001:3000"`).

**Image build fails on `pnpm install` with lockfile mismatch.**
You modified `package.json` without regenerating `pnpm-lock.yaml`. Run `pnpm install` locally to refresh the lockfile, then rebuild.

**Worker is running but jobs stay `queued`.**
Check the worker log for `worker.ready`. If it's missing, the BullMQ connection to Redis failed — verify `REDIS_URL` and that the `redis` service is healthy.

## Cleanup checklist

If you're done with the project and want to reclaim disk space **only for chat-ui** (leaves unrelated images / volumes alone):

```bash
docker compose down -v
docker rmi chat-ui-app:local
docker builder prune -f --filter label=com.docker.compose.project=chat-ui
```

To see what's still around after cleanup:

```bash
docker ps -a        --filter name=chat-ui
docker images       chat-ui-app
docker volume ls    --filter name=chat-ui
```

All three should return empty.
