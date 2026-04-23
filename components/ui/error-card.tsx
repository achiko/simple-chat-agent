"use client";

import { cn } from "@/lib/utils";
import type { ErrorPayload } from "@/lib/api-errors";
import { Button } from "./button";

type ErrorCardProps = {
  error: ErrorPayload;
  action?: { label: string; onClick: () => void };
  className?: string;
  size?: "sm" | "md";
};

export function ErrorCard({
  error,
  action,
  className,
  size = "md",
}: ErrorCardProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 text-destructive",
        size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm",
        className
      )}
    >
      <div className="font-medium">{error.message}</div>
      {error.hint ? (
        <div className="mt-0.5 opacity-80">{error.hint}</div>
      ) : null}
      {error.code || error.detail ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">
            Details
          </summary>
          <div className="mt-1 font-mono text-xs opacity-70">
            <div>code: {error.code}</div>
            {error.detail ? (
              <div className="mt-0.5 break-all whitespace-pre-wrap">
                {error.detail}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      {action ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
