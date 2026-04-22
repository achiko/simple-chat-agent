# UI

Route-based tab shell with four pages. No client-side tab state — the URL is the source of truth.

## Layout

`app/layout.tsx` wraps everything in:

- `ThemeProvider` (next-themes, class-based)
- `SessionProvider` (next-auth/react; required by any `useSession` hook)
- `TooltipProvider` (radix)
- `<TabsNav />` sticky top bar
- `<Toaster />` (sonner, top-center)
- `<main>` containing the page

`components/tabs-nav.tsx` is a thin client component: a list of four `<Link>`s that highlight the active tab by matching `usePathname()`. Exact-match for `/`, prefix-match for the others.

## Chat tab — `/` → `components/chat-tab/index.tsx`

The primary interaction surface.

### Composer

- `Textarea` + `TypeToggle` (Text | Image) + Send button.
- Enter submits, Shift+Enter newlines.
- Disabled while `busy` (exactly one in-flight request per composer).

### Submit flow

```
onSubmit()
  ├─ append user bubble to local state
  ├─ POST /api/jobs { prompt, type }
  │    → receive { job }
  ├─ append empty assistant bubble (status=STREAMING)
  └─ branch on job.type:
       TEXT  → consumeTextStream(jobId, assistantId, setMessages)
       IMAGE → pollForCompletion(jobId, assistantId, setMessages)
```

### `consumeTextStream`

- Opens `EventSource('/api/jobs/{id}/stream')`.
- `event: delta` → append the JSON-parsed string to the assistant bubble's `text`.
- `event: done` → close, then fetch `/api/jobs/{id}` once to populate final tokens + cost + error.
- `onerror` → close (defensive; the server emits `done` on all terminal paths).

### `pollForCompletion`

- Fires `GET /api/jobs/{id}` every 2s, up to 120 tries (4 min ceiling).
- Updates local message with `status`, `output` (→ `image` or `text`), `error`, `estimatedCost`.
- Stops on `COMPLETED | FAILED | CANCELLED`. On `FAILED`, shows a sonner toast.

### Bubble rendering

- User: primary bg, right-aligned.
- Assistant (normal): muted bg, left-aligned.
- Assistant (FAILED): destructive bg + border, error text shown below the bubble.
- If message has `image`, render `<img>` above the text block.
- If token/cost metadata is present, a footer line shows `in X · out Y · total Z · $0.00123`.

## History tab — `/history` → `components/history-tab/index.tsx`

- SWR-polled (`refreshInterval: 3000`) list of the user's jobs via `GET /api/jobs`.
- Each row renders prompt, type pill, status pill, timestamp, tokens if present, cost if present.
- FAILED rows have destructive styling + inline error text.
- TEXT rows get a "Replay" link pointing at `/api/jobs/{id}/stream` — the raw SSE stream opens in a new tab. (Good enough for debugging; swap to an in-app replay viewer when UX allows.)

## Gallery tab — `/gallery` → `components/gallery-tab/index.tsx`

- SWR-polled list filtered server-side: `?type=IMAGE&status=COMPLETED&limit=100`.
- Grid of `GalleryCard`s. Each card fetches `/api/jobs/{id}` (a nested SWR hook) to pull the base64 data URL from `Result.output` — we don't embed the base64 in the list payload to keep that response fast.
- Renders the image via `<img src={dataUrl}>`, prompt as caption, cost.

## System tab — `/system` → `components/system-tab/index.tsx`

- SWR-polled `/api/system/stats` every 2s.
- Five stat cards: Waiting, Active, Completed, Failed (destructive when non-zero), Streams.
- Worker status line with a green/red dot plus "last heartbeat Ns ago".
- Log panel: last 50 JSON log lines in monospace, colour-coded by level. Scrollable, capped height.

## Design system

Uses the template's shadcn setup — CVA variants, `cn()` helper in `lib/utils.ts`, Tailwind 4 tokens from `app/globals.css`. Components we actually render from:

| Component                    | Used in                                           |
| ---------------------------- | ------------------------------------------------- |
| `Button`                     | chat-tab composer, history refresh, etc.          |
| `Textarea`                   | chat-tab composer                                 |
| `Toaster` (sonner)           | root layout, errors surfaced via `toast.error()`  |
| `cn()` / CVA                 | all custom components                             |

The template's sidebar + chat shell (`components/chat/*`, `components/ai-elements/*`) is **not** mounted. Left in the tree for now to avoid touching template code. Safe to prune later.

## State management

- **No global store.** Each tab manages its own state via `useState` + SWR. The app has no cross-tab shared state that needs Redux/Zustand/etc.
- **Session.** `useSession()` is available but we don't currently read it in UI — the API enforces auth server-side.

## Gotchas

- **`<img>` warnings are accepted intentionally** for data URL images — Next/Image wants a remote pattern, which doesn't apply to inline base64. Keep the `eslint-disable-next-line @next/next/no-img-element` comments.
- **SSE + HMR**: sometimes dev-mode hot reloads orphan an EventSource and the metric counter leaks. Reload the tab if `streams.active` seems too high locally. Production builds handle `cancel()` correctly.
- **Turbopack + globals.css**: the `@import "tailwindcss"` at the top of `app/globals.css` is required. Tailwind 4 uses the PostCSS plugin from `@tailwindcss/postcss` (wired in `postcss.config.mjs`).

## Realises

- PRD §13 (four tabs: Chat, History, Gallery, System).
- PRD §3.5 (results display with prompt, status, tokens, cost).
- Action plan phase 7 + 8.
