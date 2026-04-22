import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { Worker } from "bullmq";
import { getJob, setJobStatus } from "@/lib/db/jobs";
import {
  JOB_QUEUE_NAME,
  type JobPayload,
  createRedis,
  streamChannel,
} from "@/lib/queue";
import { startHeartbeat } from "./heartbeat";
import { pushLog } from "./log";
import { processImageJob } from "./processors/image";
import { processTextJob } from "./processors/text";

const connection = createRedis();
const publisher = createRedis();
const logger = createRedis();

const stopHeartbeat = startHeartbeat(logger);

const worker = new Worker<JobPayload>(
  JOB_QUEUE_NAME,
  async (bullJob) => {
    const { jobId } = bullJob.data;
    const row = await getJob(jobId);
    if (!row) {
      await pushLog(logger, "warn", "job.missing", { jobId });
      return;
    }
    const { job } = row;
    await setJobStatus({ id: job.id, status: "QUEUED" });
    try {
      if (job.type === "TEXT") {
        await processTextJob({ job, publisher, logger });
      } else if (job.type === "IMAGE") {
        await processImageJob({ job, logger });
      } else {
        throw new Error(`Unknown job type: ${job.type}`);
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await pushLog(logger, "error", "job.failed_attempt", {
        jobId: job.id,
        attempt: bullJob.attemptsMade + 1,
        maxAttempts: bullJob.opts.attempts ?? 1,
        error: message,
      });
      const attempt = bullJob.attemptsMade + 1;
      const max = bullJob.opts.attempts ?? 1;
      if (attempt >= max) {
        await setJobStatus({
          id: job.id,
          status: "FAILED",
          error: message,
        });
        try {
          await publisher.publish(
            streamChannel(job.id),
            JSON.stringify({ error: message, done: true })
          );
        } catch {}
      }
      throw err;
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  }
);

worker.on("ready", () => {
  void pushLog(logger, "info", "worker.ready");
});
worker.on("failed", (bullJob, err) => {
  void pushLog(logger, "error", "worker.failed", {
    jobId: bullJob?.data?.jobId,
    error: err.message,
  });
});
worker.on("completed", (bullJob) => {
  void pushLog(logger, "info", "worker.completed", {
    jobId: bullJob.data.jobId,
  });
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} — closing`);
  stopHeartbeat();
  await worker.close();
  await connection.quit();
  await publisher.quit();
  await logger.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
