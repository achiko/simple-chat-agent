import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const created = await createSession({
    userId: session.user.id,
    title: deriveTitle(parsed.data.firstPrompt),
  });

  return NextResponse.json({ session: created }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await listSessionsForUser(session.user.id, { limit: 100 });
  return NextResponse.json({ sessions: rows });
}
