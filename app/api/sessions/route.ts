import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
import { createSession, listSessionsForUser } from "@/lib/db/sessions";

const createSessionSchema = z.object({
  firstPrompt: z.string().min(1).max(10_000),
});

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) {
    return cleaned;
  }
  return `${cleaned.slice(0, 60)}…`;
}

export const POST = withErrorHandler(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) throw ERRORS.unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw ERRORS.invalidJson();
  }

  const parsed = createSessionSchema.parse(body);

  const created = await createSession({
    userId: session.user.id,
    title: deriveTitle(parsed.firstPrompt),
  });

  return NextResponse.json({ session: created }, { status: 201 });
});

export const GET = withErrorHandler(async () => {
  const session = await auth();
  if (!session?.user?.id) throw ERRORS.unauthorized();

  const rows = await listSessionsForUser(session.user.id, { limit: 100 });
  return NextResponse.json({ sessions: rows });
});
