import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { Redis } from "ioredis";
import { ERRORS } from "@/lib/api-errors";
import { completeJob, setJobStatus } from "@/lib/db/jobs";
import type { Job } from "@/lib/db/schema";
import { estimateTextCost } from "@/lib/pricing";
import { chunksKey, streamChannel } from "@/lib/queue";
import { pushLog } from "../log";

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-5";

export async function processTextJob(params: {
  job: Job;
  publisher: Redis;
  logger: Redis;
}): Promise<void> {
  const { job, publisher, logger } = params;
  const channel = streamChannel(job.id);
  const listKey = chunksKey(job.id);

  if (!process.env.OPENAI_API_KEY) throw ERRORS.aiKeyMissing();

  await setJobStatus({ id: job.id, status: "STARTED" });
  await setJobStatus({ id: job.id, status: "STREAMING" });
  await pushLog(logger, "info", "text.start", { jobId: job.id });

  const result = streamText({
    model: openai(TEXT_MODEL),
    prompt: job.prompt,
  });

  let full = "";
  try {
    for await (const delta of result.textStream) {
      full += delta;
      await publisher.rpush(listKey, delta);
      await publisher.publish(channel, delta);
    }
  } catch (err) {
    await pushLog(logger, "error", "text.stream_failed", {
      jobId: job.id,
      error: (err as Error).message,
    });
    throw err;
  }

  const usage = await result.usage;
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  const totalTokens = usage?.totalTokens ?? null;
  const estimatedCost =
    inputTokens != null && outputTokens != null
      ? estimateTextCost({ model: TEXT_MODEL, inputTokens, outputTokens })
      : null;

  await completeJob({
    id: job.id,
    output: full,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    model: TEXT_MODEL,
  });

  await publisher.publish(channel, JSON.stringify({ done: true }));
  await publisher.expire(listKey, 60 * 60 * 24);

  await pushLog(logger, "info", "text.complete", {
    jobId: job.id,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
  });
}
