import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  type ChatSession,
  chatSession,
  type Job,
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

export async function createSession(input: {
  userId: string;
  title: string;
}): Promise<ChatSession> {
  const [row] = await db()
    .insert(chatSession)
    .values({ userId: input.userId, title: input.title })
    .returning();
  return row;
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const rows = await db()
    .select()
    .from(chatSession)
    .where(eq(chatSession.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSessionsForUser(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<ChatSession[]> {
  return await db()
    .select()
    .from(chatSession)
    .where(eq(chatSession.userId, userId))
    .orderBy(desc(chatSession.updatedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function touchSession(id: string): Promise<void> {
  await db()
    .update(chatSession)
    .set({ updatedAt: new Date() })
    .where(eq(chatSession.id, id));
}

export async function getJobsWithOutputsBySession(
  sessionId: string
): Promise<{ job: Job; output: string | null }[]> {
  const rows = await db()
    .select({ job: jobs, output: results.output })
    .from(jobs)
    .leftJoin(results, eq(results.jobId, jobs.id))
    .where(eq(jobs.sessionId, sessionId))
    .orderBy(asc(jobs.createdAt));
  return rows;
}
