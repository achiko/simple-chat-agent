"use client";

import useSWR from "swr";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Filters = { type?: string; status?: string };

export function HistoryTab() {
  const qs = new URLSearchParams();
  const { data, isLoading, mutate } = useSWR<{ jobs: Job[] }>(
    `/api/jobs?${qs.toString()}`,
    fetcher,
    { refreshInterval: 3000 }
  );
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">History</h1>
        <button
          type="button"
          onClick={() => void mutate()}
          className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      {isLoading ? <div className="text-muted-foreground">Loading…</div> : null}
      <div className="space-y-2">
        {data?.jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
        {data && data.jobs.length === 0 ? (
          <div className="text-muted-foreground">No jobs yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const failed = job.status === "FAILED";
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        failed ? "border-destructive/40 bg-destructive/5" : "bg-card"
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{job.prompt}</div>
          <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
            <span className="rounded border px-1.5 py-0.5">{job.type}</span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5",
                failed ? "border-destructive text-destructive" : ""
              )}
            >
              {job.status}
            </span>
            <span>{new Date(job.createdAt).toLocaleString()}</span>
            {job.totalTokens != null ? (
              <span>tokens {job.totalTokens}</span>
            ) : null}
            {job.estimatedCost != null ? (
              <span>${Number(job.estimatedCost).toFixed(5)}</span>
            ) : null}
          </div>
          {job.error ? (
            <div className="mt-1 text-xs text-destructive">{job.error}</div>
          ) : null}
        </div>
        {job.type === "TEXT" ? (
          <a
            href={`/api/jobs/${job.id}/stream`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            Replay
          </a>
        ) : null}
      </div>
    </div>
  );
}
