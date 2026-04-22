/**
 * Job-row helpers shared by the Next.js app and the worker process.
 * No "server-only" pragma — the worker imports this directly.
 */
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  type Job,
  type JobStatus,
  type JobType,
  jobs,
  results,
} from "./schema";

let cached: ReturnType<typeof drizzle> | null = null;
function db() {
  if (!cached) {
    const url = process.env.POSTGRES_URL;
    if (!url) {
      throw new Error("POSTGRES_URL not set");
    }
    cached = drizzle(postgres(url));
  }
  return cached;
}

export async function createJob(input: {
  userId: string;
  prompt: string;
  type: JobType;
  model?: string | null;
}): Promise<Job> {
  const [row] = await db()
    .insert(jobs)
    .values({
      userId: input.userId,
      prompt: input.prompt,
      type: input.type,
      model: input.model ?? null,
      status: "PENDING",
    })
    .returning();
  return row;
}

export async function setJobStatus(input: {
  id: string;
  status: JobStatus;
  error?: string | null;
}): Promise<void> {
  const now = new Date();
  const patch: Record<string, unknown> = {
    status: input.status,
    updatedAt: now,
  };
  // startedAt is set once on the STARTED transition and never overwritten.
  if (input.status === "STARTED") {
    patch.startedAt = now;
  }
  if (
    input.status === "COMPLETED" ||
    input.status === "FAILED" ||
    input.status === "CANCELLED"
  ) {
    patch.completedAt = now;
  }
  if (input.error !== undefined) {
    patch.error = input.error;
  }
  await db().update(jobs).set(patch).where(eq(jobs.id, input.id));
}

export async function completeJob(input: {
  id: string;
  output: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  model?: string | null;
}): Promise<void> {
  const d = db();
  await d.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(jobs)
      .set({
        status: "COMPLETED",
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        estimatedCost:
          input.estimatedCost != null ? String(input.estimatedCost) : null,
        model: input.model ?? null,
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(jobs.id, input.id));
    await tx
      .insert(results)
      .values({ jobId: input.id, output: input.output })
      .onConflictDoUpdate({
        target: results.jobId,
        set: { output: input.output },
      });
  });
}

export async function getJob(
  id: string
): Promise<{ job: Job; output: string | null } | null> {
  const rows = await db()
    .select({
      job: jobs,
      output: results.output,
    })
    .from(jobs)
    .leftJoin(results, eq(results.jobId, jobs.id))
    .where(eq(jobs.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return { job: rows[0].job, output: rows[0].output };
}

export type ListJobsFilter = {
  userId?: string;
  type?: JobType;
  status?: JobStatus;
  limit?: number;
  offset?: number;
};

export async function listJobs(filter: ListJobsFilter = {}): Promise<Job[]> {
  const clauses = [] as ReturnType<typeof eq>[];
  if (filter.userId) clauses.push(eq(jobs.userId, filter.userId));
  if (filter.type) clauses.push(eq(jobs.type, filter.type));
  if (filter.status) clauses.push(eq(jobs.status, filter.status));
  const where = clauses.length > 0 ? and(...clauses) : undefined;
  return await db()
    .select()
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);
}
