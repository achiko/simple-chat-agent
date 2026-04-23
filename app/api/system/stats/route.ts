import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
import {
  LOG_LIST_KEY,
  LOG_LIST_MAX,
  WORKER_HEARTBEAT_KEY,
  createRedis,
  getJobQueue,
} from "@/lib/queue";
import { getActiveStreams } from "@/lib/system/metrics";

export const GET = withErrorHandler(async () => {
  const session = await auth();
  if (!session?.user?.id) throw ERRORS.unauthorized();

  const queue = getJobQueue();
  const redis = createRedis();
  try {
    const [counts, heartbeat, logs] = await Promise.all([
      queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      redis.get(WORKER_HEARTBEAT_KEY),
      redis.lrange(LOG_LIST_KEY, 0, LOG_LIST_MAX - 1),
    ]);
    const heartbeatMs = heartbeat ? Number(heartbeat) : null;
    const workerOnline =
      heartbeatMs != null && Date.now() - heartbeatMs < 15_000;

    return NextResponse.json({
      queue: counts,
      worker: {
        online: workerOnline,
        lastHeartbeat: heartbeatMs,
      },
      streams: {
        active: getActiveStreams(),
      },
      logs: logs.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      }),
    });
  } finally {
    await redis.quit();
  }
});
