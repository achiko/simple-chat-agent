"use client";

import useSWR from "swr";
import { JobRow } from "@/components/job-row";
import type { Job } from "@/lib/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function HistoryTab() {
  const { data, isLoading, mutate } = useSWR<{ jobs: Job[] }>(
    "/api/jobs",
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
