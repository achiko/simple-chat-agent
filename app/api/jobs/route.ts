import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createJob, listJobs } from "@/lib/db/jobs";
import { JOB_STATUSES, JOB_TYPES } from "@/lib/db/schema";
import { getSession, touchSession } from "@/lib/db/sessions";
import { enqueueJob } from "@/lib/queue";

const createJobSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  type: z.enum(JOB_TYPES),
  model: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

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

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (parsed.data.sessionId) {
    const owned = await getSession(parsed.data.sessionId);
    if (!owned) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    if (owned.userId !== session.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const job = await createJob({
    userId: session.user.id,
    prompt: parsed.data.prompt,
    type: parsed.data.type,
    model: parsed.data.model,
    sessionId: parsed.data.sessionId,
  });

  if (parsed.data.sessionId) {
    await touchSession(parsed.data.sessionId);
  }

  await enqueueJob(job.id);

  return NextResponse.json({ job }, { status: 201 });
}

const listQuerySchema = z.object({
  type: z.enum(JOB_TYPES).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  sessionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const rows = await listJobs({
    userId: session.user.id,
    type: parsed.data.type,
    status: parsed.data.status,
    sessionId: parsed.data.sessionId,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });

  return NextResponse.json({ jobs: rows });
}
