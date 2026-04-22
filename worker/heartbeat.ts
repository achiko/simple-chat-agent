import type { Redis } from "ioredis";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queue";

export function startHeartbeat(redis: Redis, intervalMs = 5000) {
  async function tick() {
    try {
      await redis.set(
        WORKER_HEARTBEAT_KEY,
        String(Date.now()),
        "EX",
        15
      );
    } catch (err) {
      console.error("[worker] heartbeat failed", err);
    }
  }
  void tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
