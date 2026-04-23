import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  // Match proxy.ts: detect HTTPS from the actual request, not NODE_ENV, so
  // the cookie name (authjs.session-token vs __Secure-authjs.session-token)
  // lines up with whatever NextAuth wrote at signIn time.
  const isHttps =
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: isHttps,
  });

  if (token) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
