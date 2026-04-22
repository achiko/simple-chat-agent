"use client";

import { useEffect, useState } from "react";
import type { JobType } from "@/lib/db/schema";

const TEXT_PHASES = ["Thinking…", "Generating response…", "Processing…"];
const IMAGE_PHASES = ["Thinking…", "Rendering image…", "Processing…"];

export function ThinkingIndicator({ type }: { type: JobType }) {
  const phases = type === "IMAGE" ? IMAGE_PHASES : TEXT_PHASES;
  const [i, setI] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setI((v) => (v + 1) % phases.length), 1600);
    return () => clearInterval(h);
  }, [phases.length]);

  return (
    <div
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm italic text-muted-foreground"
      role="status"
    >
      <span className="inline-flex gap-1">
        <span
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "300ms" }}
        />
      </span>
      <span className="animate-pulse">{phases[i]}</span>
    </div>
  );
}
