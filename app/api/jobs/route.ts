import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
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

export const POST = withErrorHandler(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) throw ERRORS.unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw ERRORS.invalidJson();
  }

  const parsed = createJobSchema.parse(body);

  if (parsed.sessionId) {
    const owned = await getSession(parsed.sessionId);
    if (!owned) throw ERRORS.notFound("Session");
    if (owned.userId !== session.user.id) throw ERRORS.forbidden();
  }

  const job = await createJob({
    userId: session.user.id,
    prompt: parsed.prompt,
    type: parsed.type,
    model: parsed.model,
    sessionId: parsed.sessionId,
  });

  if (parsed.sessionId) {
    await touchSession(parsed.sessionId);
  }

  await enqueueJob(job.id);

  return NextResponse.json({ job }, { status: 201 });
});

const listQuerySchema = z.object({
  type: z.enum(JOB_TYPES).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  sessionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const GET = withErrorHandler(async (request: Request) => {
  const session = await auth();
  if (!session?.user?.id) throw ERRORS.unauthorized();

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.parse(
    Object.fromEntries(searchParams.entries())
  );

  const rows = await listJobs({
    userId: session.user.id,
    type: parsed.type,
    status: parsed.status,
    sessionId: parsed.sessionId,
    limit: parsed.limit,
    offset: parsed.offset,
  });

  return NextResponse.json({ jobs: rows });
});
