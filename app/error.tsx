"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page] boundary caught", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <ErrorCard
          error={{
            code: error.digest ?? "page.crash",
            message: "This page hit an error.",
            hint: "Try again, or return to the home screen.",
            detail: error.message,
          }}
          action={{ label: "Try again", onClick: reset }}
        />
        <div>
          <Button asChild variant="outline" size="sm">
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
