import { openai } from "@ai-sdk/openai";
import { experimental_generateImage as generateImage } from "ai";
import type { Redis } from "ioredis";
import { ERRORS } from "@/lib/api-errors";
import { completeJob, setJobStatus } from "@/lib/db/jobs";
import type { Job } from "@/lib/db/schema";
import { estimateImageCost } from "@/lib/pricing";
import { pushLog } from "../log";

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const IMAGE_SIZE =
  (process.env.OPENAI_IMAGE_SIZE as `${number}x${number}` | undefined) ??
  "1024x1024";

export async function processImageJob(params: {
  job: Job;
  logger: Redis;
}): Promise<void> {
  const { job, logger } = params;
  if (!process.env.OPENAI_API_KEY) throw ERRORS.aiKeyMissing();
  await setJobStatus({ id: job.id, status: "STARTED" });
  await pushLog(logger, "info", "image.start", { jobId: job.id });

  const result = await generateImage({
    model: openai.image(IMAGE_MODEL),
    prompt: job.prompt,
    size: IMAGE_SIZE,
  });

  const image = result.images?.[0] ?? result.image;
  if (!image) {
    throw new Error("generateImage returned no image");
  }
  const base64 = image.base64;
  const output = `data:image/png;base64,${base64}`;

  const estimatedCost = estimateImageCost({
    model: IMAGE_MODEL,
    size: IMAGE_SIZE,
  });

  await completeJob({
    id: job.id,
    output,
    estimatedCost,
    model: IMAGE_MODEL,
  });

  await pushLog(logger, "info", "image.complete", {
    jobId: job.id,
    estimatedCost,
  });
}
