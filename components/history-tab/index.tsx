"use client";

import useSWR from "swr";
import { JobRow } from "@/components/job-row";
import { ErrorCard } from "@/components/ui/error-card";
import { notifyError, toAppError } from "@/lib/client-errors";
import type { Job } from "@/lib/db/schema";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const { readApiError } = await import("@/lib/client-errors");
    throw await readApiError(res);
  }
  return res.json();
};

export function HistoryTab() {
  const { data, error, isLoading, mutate } = useSWR<{ jobs: Job[] }>(
    "/api/jobs",
    fetcher,
    {
      refreshInterval: 3000,
      onError: (err) => notifyError(toAppError(err)),
    }
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
      {error && !data ? (
        <ErrorCard
          error={toAppError(error).payload}
          action={{ label: "Retry", onClick: () => void mutate() }}
        />
      ) : null}
      {isLoading && !error ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : null}
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
