# Testing

Playwright E2E, single project, Chromium only. Fast and opinionated: no unit tests, no page-object layer, no fixtures beyond re-exporting Playwright's `test`/`expect`.

## Config

`playwright.config.ts`:

- `testDir: ./tests`, matcher `/e2e/.*.test.ts`.
- `baseURL = http://localhost:${PORT || 3000}`.
- `webServer`: `pnpm dev`, waits for `/ping`. `reuseExistingServer: true` outside CI — so if you already have `pnpm dev` running, Playwright reuses it instead of spawning a second.
- Workers: 2. Fully parallel.
- Retries: 0 (CI will want 1–2).
- Timeout: 240s per test (AI jobs are slow).

## What we test (`tests/e2e/*.test.ts`)

| File                | Scenario                                                      |
| ------------------- | ------------------------------------------------------------- |
| `chat.test.ts`      | Submit text prompt; stream appears; token + cost render after finish. |
| `image.test.ts`     | Submit image prompt; image renders in chat bubble; appears on `/gallery`. |
| `history.test.ts`   | Enqueue via API (`request.post("/api/jobs")`); row appears on `/history`; reaches terminal state. |
| `dashboard.test.ts` | Enqueue N jobs via API; assert `/system`'s Completed counter strictly increases. |

No login step — the proxy middleware auto-provisions a guest on first visit (`page.goto("/")`). `request` contexts inherit the browser's cookie jar, so API-level enqueues authenticate as the same guest.

## Fixtures & helpers

- `tests/fixtures.ts` — just `export { expect, test } from "@playwright/test"`. Add fixtures here when the app has meaningful shared setup.
- `tests/helpers.ts` — `generateRandomTestUser()`, `generateTestMessage()`. Unused by our specs today; left from the template for future use.

The template shipped `tests/pages/chat.ts` (page object) and `tests/prompts/` (mock prompt fixtures). Both were removed — they referenced sidebar chat components we deleted.

## Running

```bash
# Full stack required: postgres, redis, app, worker.
docker compose up -d
pnpm test                    # all specs
pnpm test tests/e2e/chat.test.ts   # single spec
pnpm exec playwright test --headed  # see the browser
pnpm exec playwright show-report    # open last HTML report
```

On CI the dev server is spawned by Playwright itself (`webServer.command = "pnpm dev"`). Locally, bring up `docker compose` first — the dev server will reuse the existing compose DB/Redis.

## What we DON'T test

- Unit tests are absent by design. The PRD prioritises E2E.
- Worker unit tests — the processors are thin wrappers around the AI SDK and are covered implicitly by the E2E specs.
- Auth flows (login/register) — there is no login UI.

## Gotchas

- **Specs need a real OpenAI key.** The tests hit `POST /api/jobs` which enqueues real work. Without `OPENAI_API_KEY`, every job walks the retry+FAIL path and the specs time out. Use a cheap model override (`OPENAI_TEXT_MODEL=gpt-4o-mini`) if budget matters.
- **Image specs are slow** (~30–60s per image). The 240s timeout accommodates this. Don't tighten it.
- **`expect.poll`** is used in `dashboard.test.ts` because counters update eventually, not synchronously.
- **`webServer.reuseExistingServer: true` can mask broken starts.** If `pnpm dev` crashed in another terminal but Playwright "reused" it, tests will hang. Check `docker compose logs app` first.

## Realises

- PRD §12 (Playwright coverage of submit / streaming / completion / failure / dashboard).
- Action plan phase 10.
