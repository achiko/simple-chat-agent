/**
 * BullMQ queue used by the Next.js app (producer) and the worker (consumer).
 */
import { Queue, QueueEvents } from "bullmq";
import IORedis, { type Redis } from "ioredis";

export const JOB_QUEUE_NAME = "jobs";

export type JobPayload = {
  jobId: string;
};

let queueSingleton: Queue<JobPayload> | null = null;
let eventsSingleton: QueueEvents | null = null;
let sharedConnection: Redis | null = null;

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL not set");
  }
  return url;
}

export function createRedis(): Redis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null });
}

function connection(): Redis {
  if (!sharedConnection) {
    sharedConnection = createRedis();
  }
  return sharedConnection;
}

export function getJobQueue(): Queue<JobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<JobPayload>(JOB_QUEUE_NAME, {
      connection: connection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return queueSingleton;
}

export function getQueueEvents(): QueueEvents {
  if (!eventsSingleton) {
    eventsSingleton = new QueueEvents(JOB_QUEUE_NAME, {
      connection: connection(),
    });
  }
  return eventsSingleton;
}

export async function enqueueJob(jobId: string): Promise<void> {
  await getJobQueue().add("job", { jobId }, { jobId });
}

/** Redis channel a worker publishes text deltas on. */
export function streamChannel(jobId: string): string {
  return `job:${jobId}:stream`;
}

/** Redis list where every text delta is persisted (append-only source of truth). */
export function chunksKey(jobId: string): string {
  return `job:${jobId}:chunks`;
}

/** Redis key for worker liveness heartbeat. */
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";

/** Redis list holding the last N worker log lines. */
export const LOG_LIST_KEY = "job-logs";
export const LOG_LIST_MAX = 50;
