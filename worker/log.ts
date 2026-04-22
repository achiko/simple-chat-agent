import type { Redis } from "ioredis";
import { LOG_LIST_KEY, LOG_LIST_MAX } from "@/lib/queue";

export async function pushLog(
  redis: Redis,
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra ?? {}),
  });
  try {
    await redis.lpush(LOG_LIST_KEY, line);
    await redis.ltrim(LOG_LIST_KEY, 0, LOG_LIST_MAX - 1);
  } catch (err) {
    console.error("[worker] log push failed", err);
  }
  const log =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  log(`[worker] ${message}`, extra ?? "");
}
