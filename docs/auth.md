# Authentication

Guest-only. No login or registration UI is exposed in the Tabs shell. Everything runs on an automatically-provisioned anonymous `User` row.

## Components (all from template, mostly unchanged)

| File                                     | Role                                                      |
| ---------------------------------------- | --------------------------------------------------------- |
| `app/(auth)/auth.ts`                     | NextAuth config + Credentials providers                   |
| `app/(auth)/auth.config.ts`              | `basePath: "/api/auth"`, `trustHost: true`, pages config  |
| `app/(auth)/api/auth/[...nextauth]/route.ts` | NextAuth HTTP handlers (GET + POST)                   |
| `app/(auth)/api/auth/guest/route.ts`     | `/api/auth/guest?redirectUrl=...` — creates a guest user and redirects |
| `proxy.ts`                               | Next.js middleware (Vercel renamed `middleware` → `proxy`) |
| `lib/db/queries.ts` → `createGuestUser`  | INSERT a `User` with random email + `isAnonymous: true`   |
| `lib/constants.ts` → `guestRegex`        | Matches the guest email pattern                           |

## Request lifecycle

```
Every request hits proxy.ts (see matcher below).

1. /ping → 200 "pong"     (Playwright uses this for readiness)
2. /api/auth/** → pass-through (NextAuth handles it)
3. Everything else:
   token = getToken({ req, secret, secureCookie: <derived from URL scheme> })

   - No token → redirect to /api/auth/guest?redirectUrl=<original>
     → that handler creates a guest User, sets the session cookie,
       redirects back to the original URL.
   - Has token + guest → continue.
   - Has token + not-guest + on /login or /register → redirect to /.
```

Matcher:

```ts
["/", "/chat/:id", "/api/:path*", "/login", "/register",
 "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"]
```

## The `secureCookie` fix

### The bug

Original `proxy.ts` (from template):

```ts
secureCookie: !isDevelopmentEnvironment    // true when NODE_ENV === "production"
```

When the app runs inside the Docker container, `NODE_ENV=production`, so the middleware tried to read the `__Secure-authjs.session-token` cookie. But NextAuth only **sets** the `__Secure-` prefix when the origin is HTTPS. In our compose setup we serve HTTP on `localhost:3000`, so NextAuth writes `authjs.session-token` (no prefix). Middleware couldn't find it, redirected every request to `/api/auth/guest`, which created infinite guest users and looped. API calls (POST /api/jobs, etc.) returned redirects that curl parsed as JSON errors.

### The fix (`proxy.ts`)

Derive from the actual request scheme:

```ts
const isHttps =
  request.nextUrl.protocol === "https:" ||
  request.headers.get("x-forwarded-proto") === "https";
const token = await getToken({ req, secret, secureCookie: isHttps });
```

- HTTPS (production behind a TLS terminator): `secureCookie: true`, reads `__Secure-authjs.session-token`. NextAuth sets the same.
- HTTP (local docker, `next dev`): `secureCookie: false`, reads `authjs.session-token`. NextAuth sets the same.
- `x-forwarded-proto` support means this still works behind a reverse proxy / load balancer that terminates TLS and forwards HTTP to the container.

## Cookie shape

- `authjs.session-token` (or `__Secure-` variant) — JWT encrypted with `AUTH_SECRET`. Contains `{ id, type: "guest" | "regular", ...defaultJWT }`.
- `authjs.callback-url` — bookkeeping, not auth.
- HttpOnly, SameSite=Lax (NextAuth defaults).

## Server-side usage

```ts
import { auth } from "@/app/(auth)/auth";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // use session.user.id
}
```

All our `app/api/**` handlers follow this shape. `auth()` reads the request cookie (via `cookies()` internally), which is what makes the route dynamic under cacheComponents — so we don't need `export const dynamic = "force-dynamic"`.

## Environment

- `AUTH_SECRET` — required. 32-byte random; `openssl rand -base64 32`.
- `AI_GATEWAY_API_KEY` — optional, unused on the hot path but referenced by template config.

## Threat model / caveats

- Guest users are **trivially spoofable**. Anyone can claim any `userId` if they grab a cookie. Good enough for a local demo + single-user dev; not for prod.
- No rate limiting on `POST /api/jobs` (PRD §15 explicitly excludes). An abusive client could spam the worker.
- `trustHost: true` means NextAuth accepts any `Host` header. Fine for dev, tighten for prod.

## Realises

- PRD §15 (auth out of MVP; we keep the template's guest mode because ripping it out costs more than it saves).
- Action plan §2 ("we keep the template's Auth.js guest-user flow; never show a login UI").
