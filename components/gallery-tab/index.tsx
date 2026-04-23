"use client";

import useSWR from "swr";
import { ErrorCard } from "@/components/ui/error-card";
import { notifyError, readApiError, toAppError } from "@/lib/client-errors";
import type { Job } from "@/lib/db/schema";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw await readApiError(res);
  return res.json();
};

export function GalleryTab() {
  const { data, error, isLoading, mutate } = useSWR<{ jobs: Job[] }>(
    "/api/jobs?type=IMAGE&status=COMPLETED&limit=100",
    fetcher,
    {
      refreshInterval: 4000,
      onError: (err) => notifyError(toAppError(err)),
    }
  );
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold">Gallery</h1>
      {error && !data ? (
        <ErrorCard
          error={toAppError(error).payload}
          action={{ label: "Retry", onClick: () => void mutate() }}
        />
      ) : null}
      {isLoading && !error ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {data?.jobs.map((job) => (
          <GalleryCard key={job.id} job={job} />
        ))}
      </div>
      {data && data.jobs.length === 0 ? (
        <div className="text-muted-foreground">No images yet.</div>
      ) : null}
    </div>
  );
}

function GalleryCard({ job }: { job: Job }) {
  const { data } = useSWR<{ job: Job; output: string | null }>(
    `/api/jobs/${job.id}`,
    fetcher
  );
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      {data?.output ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={job.prompt}
          src={data.output}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
          loading image…
        </div>
      )}
      <div className="p-2">
        <div className="truncate text-xs" title={job.prompt}>
          {job.prompt}
        </div>
        {job.estimatedCost != null ? (
          <div className="mt-1 text-xs text-muted-foreground">
            ${Number(job.estimatedCost).toFixed(5)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
