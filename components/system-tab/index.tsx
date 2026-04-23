"use client";

import { useState } from "react";
import useSWR from "swr";
import { JobRow } from "@/components/job-row";
import { ErrorCard } from "@/components/ui/error-card";
import { notifyError, readApiError, toAppError } from "@/lib/client-errors";
import type { Job } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw await readApiError(res);
  return res.json();
};

type Stats = {
  queue: Record<string, number>;
  worker: { online: boolean; lastHeartbeat: number | null };
  streams: { active: number };
  logs: Array<{ ts?: string; level?: string; message?: string; raw?: string }>;
};

type Filter = "COMPLETED" | "FAILED" | null;

export function SystemTab() {
  const { data, error, isLoading, mutate } = useSWR<Stats>(
    "/api/system/stats",
    fetcher,
    {
      refreshInterval: 2000,
      onError: (err) => notifyError(toAppError(err)),
    }
  );
  const [filter, setFilter] = useState<Filter>(null);
  const { data: jobsData, isLoading: jobsLoading } = useSWR<{ jobs: Job[] }>(
    filter ? `/api/jobs?status=${filter}&limit=50` : null,
    fetcher,
    {
      refreshInterval: 5000,
      onError: (err) => notifyError(toAppError(err)),
    }
  );
  const toggle = (next: Exclude<Filter, null>) =>
    setFilter((cur) => (cur === next ? null : next));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <h1 className="text-lg font-semibold">System</h1>
      {error && !data ? (
        <ErrorCard
          error={toAppError(error).payload}
          action={{ label: "Retry", onClick: () => void mutate() }}
        />
      ) : null}
      {isLoading && !data && !error ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : null}
      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Waiting" value={data.queue.waiting ?? 0} />
            <StatCard label="Active" value={data.queue.active ?? 0} />
            <StatCard
              label="Completed"
              value={data.queue.completed ?? 0}
              selected={filter === "COMPLETED"}
              tone="success"
              onClick={() => toggle("COMPLETED")}
            />
            <StatCard
              label="Failed"
              value={data.queue.failed ?? 0}
              selected={filter === "FAILED"}
              tone="destructive"
              onClick={() => toggle("FAILED")}
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
          {filter ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {filter === "COMPLETED" ? "Completed" : "Failed"} jobs
                </h2>
                <button
                  type="button"
                  onClick={() => setFilter(null)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  Clear filter
                </button>
              </div>
              {jobsLoading && !jobsData ? (
                <div className="text-muted-foreground text-sm">Loading…</div>
              ) : null}
              <div className="space-y-2">
                {jobsData?.jobs.map((job) => (
                  <JobRow job={job} key={job.id} />
                ))}
                {jobsData && jobsData.jobs.length === 0 ? (
                  <div className="text-muted-foreground text-sm">
                    No {filter.toLowerCase()} jobs.
                  </div>
                ) : null}
              </div>
              {jobsData && jobsData.jobs.length >= 50 ? (
                <div className="text-xs text-muted-foreground">
                  Showing latest 50. See the History tab for the full list.
                </div>
              ) : null}
            </section>
          ) : null}
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
  selected,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "success";
  selected?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  const destructive = tone === "destructive" && value > 0;
  const base = cn(
    "rounded-md border p-3 text-left transition-colors",
    destructive ? "border-destructive/40 bg-destructive/5" : "",
    clickable
      ? "cursor-pointer hover:bg-muted focus:outline-none focus-visible:ring-2"
      : "",
    selected && tone === "success" ? "ring-2 ring-green-500" : "",
    selected && tone === "destructive" ? "ring-2 ring-destructive" : ""
  );
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={base}
      >
        <div className="text-xs text-muted-foreground">
          {label}
          {selected ? " · filtering" : ""}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
      </button>
    );
  }
  return (
    <div className={base}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
