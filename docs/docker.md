# Docker

One Dockerfile, one compose file, five services (one of which is a one-shot).

## `Dockerfile`

Single file, three stages, produces `chat-ui-app:local`:

```
base     node:20-alpine + corepack pnpm@10.32.1, WORKDIR /app
  │
deps     COPY package.json + pnpm-lock, `pnpm install --frozen-lockfile`
  │
builder  COPY src, `pnpm exec next build`  ← explicitly NOT `pnpm build`
  │
runner   NODE_ENV=production
         COPY from builder: node_modules, .next, public, package.json,
                            lock, next.config, tsconfig, drizzle.config,
                            lib, worker
         EXPOSE 3000
         CMD ["pnpm", "start"]
```

### Why `pnpm exec next build` instead of `pnpm build`?

The `build` script in `package.json` is `tsx lib/db/migrate && next build`. That works for Vercel (where `POSTGRES_URL` points at a live managed DB at build time) but not for a Docker build on a dev laptop — the builder container can't reach Postgres. We run migrations as a separate compose service at deploy time instead.

### Why include `worker/` in the runner stage?

So the same image can run either service. Compose overrides `CMD`:

```yaml
app:    command: ["pnpm", "start"]
worker: command: ["pnpm", "exec", "tsx", "worker/index.ts"]
migrate: command: ["pnpm", "db:migrate"]
```

Trade-off: the worker image carries `.next/` artifacts it doesn't need, and the app image carries `tsx` (a devDep). Acceptable for this MVP. A production build would split into two images or use standalone Next output.

### `tsx` availability

`tsx` is a devDep, but we install with the default (no `--prod`) so it's present in `node_modules`. The migrate service uses `pnpm db:migrate` → `npx tsx lib/db/migrate.ts`. If you ever switch to `pnpm install --prod` in the builder, move `tsx` to `dependencies`.

## `docker-compose.yml`

```
x-common-env: &common-env
  NODE_ENV: production
  POSTGRES_URL: postgres://postgres:postgres@postgres:5432/chatui
  REDIS_URL:    redis://redis:6379

services:
  postgres   (postgres:16-alpine, healthcheck, :5432, named volume)
  redis      (redis:7-alpine,     healthcheck, :6379, named volume)
  migrate    (chat-ui-app:local, command: pnpm db:migrate, restart: "no")
             depends_on: postgres: service_healthy
  app        (chat-ui-app:local, command: pnpm start, :3000)
             depends_on:
               migrate: service_completed_successfully
               redis:   service_healthy
  worker     (chat-ui-app:local, command: pnpm exec tsx worker/index.ts)
             depends_on:
               migrate: service_completed_successfully
               redis:   service_healthy

volumes: postgres_data, redis_data
```

All three app-layer services:

- share `POSTGRES_URL`, `REDIS_URL`, `NODE_ENV` via the YAML anchor;
- load `AUTH_SECRET`, `OPENAI_API_KEY`, pricing env, etc. from `env_file: .env.local`.

### Start order

```
postgres ─healthy─▶ migrate ─exited 0─▶ app
                                    └─▶ worker
redis    ─healthy─▶ app, worker
```

`service_completed_successfully` is a compose v2 feature — if migrate fails, neither app nor worker starts. If migrate is already past (volume persisted from previous run), `pnpm db:migrate` is a no-op so the dependency resolves quickly.

### Shared image — build it once

`migrate.build.context: .` is the only service with a `build:` block; `app` and `worker` reference `image: chat-ui-app:local` only. So `docker compose up` builds the image via the `migrate` service, then reuses it for the other two. To force a rebuild:

```bash
docker compose build migrate
# or
docker build -t chat-ui-app:local .
docker compose up -d --force-recreate app worker
```

## `.dockerignore`

Excludes `node_modules/`, `.next/`, `.git/`, `.env*` (except `.env.example`), test artefacts, OS cruft, and docker override files. Keeps image build fast and avoids accidentally COPYing secrets.

## Operational recipes

```bash
# Fresh boot (first time or after schema change)
docker compose up -d                     # builds image if missing
docker compose logs -f app worker

# Rebuild after code change
docker compose build migrate
docker compose up -d --force-recreate app worker

# Run ONE migration against the live DB without a full recreate
docker compose run --rm migrate

# Wipe everything (DB + queue)
docker compose down -v

# Ad-hoc psql
docker exec -it chat-ui-postgres-1 psql -U postgres -d chatui

# Ad-hoc redis-cli
docker exec -it chat-ui-redis-1 redis-cli
```

## Environment

The `.env.example` documents every variable; copy to `.env.local` and fill in secrets before `docker compose up`.

| Variable                         | Required? | Used by         | Notes                                   |
| -------------------------------- | --------- | --------------- | --------------------------------------- |
| `AUTH_SECRET`                    | yes       | app, NextAuth   | 32-byte random                          |
| `OPENAI_API_KEY`                 | yes       | worker          | gpt-5 + gpt-image-1 direct              |
| `AI_GATEWAY_API_KEY`             | no        | app (template)  | unused on hot path                      |
| `POSTGRES_URL`                   | yes       | all DB callers  | compose overrides to internal hostname  |
| `REDIS_URL`                      | yes       | app + worker    | compose overrides to internal hostname  |
| `BLOB_READ_WRITE_TOKEN`          | no        | template        | unused                                  |
| `GPT5_INPUT_PRICE_PER_1M`        | no        | pricing         | default 1.25                            |
| `GPT5_OUTPUT_PRICE_PER_1M`       | no        | pricing         | default 10                              |
| `GPT_IMAGE_1_PRICE_PER_IMAGE`    | no        | pricing         | default 0.04                            |
| `OPENAI_TEXT_MODEL`              | no        | worker          | default `gpt-5`                         |
| `OPENAI_IMAGE_MODEL`             | no        | worker          | default `gpt-image-1`                   |
| `OPENAI_IMAGE_SIZE`              | no        | worker          | default `1024x1024`                     |
| `WORKER_CONCURRENCY`             | no        | worker          | default 4                               |

## Gotchas

- **`env_file` does not do variable substitution.** `${AUTH_SECRET}` inline in `environment:` reads from the shell, not `.env.local`. We use `env_file` + plain `environment:` overrides for things compose needs to know about (hostnames).
- **Compose warns about undefined vars in override form.** Harmless; ignore unless you see `variable is not set` for something you actually need.
- **`service_healthy` ≠ zero startup time.** Postgres takes ~3–5s on first boot to accept connections even though the image starts in under a second. Migrate handles this via `depends_on: service_healthy`.
- **Volumes persist across `docker compose down`.** Use `down -v` to reset DB + queue state. Forgetting this is the #1 cause of "migration fails because the table already exists" surprises when iterating on the schema.
- **Rosetta + Apple Silicon:** both images are manifest-list multi-arch (`linux/amd64`, `linux/arm64`), so no emulation warnings on M-series.

## Realises

- PRD §6 (services: app, worker, redis, postgres).
- Action plan §11 (single Dockerfile, one compose file running all services).
