import type { Job } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export function JobRow({ job }: { job: Job }) {
  const failed = job.status === "FAILED";
  const completed = job.status === "COMPLETED";
  return (
    <div
      className={cn(
        "rounded-md border border-l-4 p-3",
        failed
          ? "border-destructive/40 border-l-destructive bg-destructive/5"
          : completed
            ? "border-l-green-500 bg-card"
            : "bg-card"
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{job.prompt}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded border px-1.5 py-0.5">{job.type}</span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5",
                failed ? "border-destructive text-destructive" : "",
                completed ? "border-green-500 text-green-600" : ""
              )}
            >
              {job.status}
            </span>
            <span>{new Date(job.createdAt).toLocaleString()}</span>
            {job.totalTokens == null ? null : (
              <span>tokens {job.totalTokens}</span>
            )}
            {job.estimatedCost == null ? null : (
              <span>${Number(job.estimatedCost).toFixed(5)}</span>
            )}
          </div>
          {job.error ? (
            <div className="mt-1 text-xs text-destructive">{job.error}</div>
          ) : null}
        </div>
        {job.type === "TEXT" ? (
          <a
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
            href={`/api/jobs/${job.id}/stream`}
            rel="noreferrer"
            target="_blank"
          >
            Replay
          </a>
        ) : null}
      </div>
    </div>
  );
}
