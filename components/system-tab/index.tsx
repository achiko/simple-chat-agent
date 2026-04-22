"use client";

import useSWR from "swr";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Stats = {
  queue: Record<string, number>;
  worker: { online: boolean; lastHeartbeat: number | null };
  streams: { active: number };
  logs: Array<{ ts?: string; level?: string; message?: string; raw?: string }>;
};

export function SystemTab() {
  const { data, isLoading } = useSWR<Stats>("/api/system/stats", fetcher, {
    refreshInterval: 2000,
  });
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <h1 className="text-lg font-semibold">System</h1>
      {isLoading && !data ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : null}
      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Waiting" value={data.queue.waiting ?? 0} />
            <StatCard label="Active" value={data.queue.active ?? 0} />
            <StatCard label="Completed" value={data.queue.completed ?? 0} />
            <StatCard
              label="Failed"
              value={data.queue.failed ?? 0}
              tone={data.queue.failed ? "destructive" : undefined}
            />
            <StatCard label="Streams" value={data.streams.active} />
          </section>
          <section className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "inline-block size-2 rounded-full",
                  data.worker.online ? "bg-green-500" : "bg-red-500"
                )}
              />
              <span className="font-medium">
                Worker {data.worker.online ? "online" : "offline"}
              </span>
              {data.worker.lastHeartbeat ? (
                <span className="text-xs text-muted-foreground">
                  last heartbeat{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - data.worker.lastHeartbeat) / 1000
                    )
                  )}
                  s ago
                </span>
              ) : null}
            </div>
          </section>
          <section className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">
              Recent log events
            </div>
            <div className="max-h-96 overflow-y-auto p-3 font-mono text-xs">
              {data.logs.length === 0 ? (
                <div className="text-muted-foreground">No logs yet.</div>
              ) : null}
              {data.logs.map((log, i) => (
                <div
                  key={`${log.ts ?? i}-${i}`}
                  className={cn(
                    "border-b border-border/40 py-1 last:border-0",
                    log.level === "error"
                      ? "text-destructive"
                      : log.level === "warn"
                        ? "text-amber-600"
                        : ""
                  )}
                >
                  {log.raw ? (
                    log.raw
                  ) : (
                    <>
                      <span className="text-muted-foreground">{log.ts}</span>{" "}
                      <span className="uppercase">{log.level}</span>{" "}
                      {log.message}{" "}
                      <span className="text-muted-foreground">
                        {JSON.stringify(
                          Object.fromEntries(
                            Object.entries(log).filter(
                              ([k]) =>
                                k !== "ts" && k !== "level" && k !== "message"
                            )
                          )
                        )}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        tone === "destructive" ? "border-destructive/40 bg-destructive/5" : ""
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
