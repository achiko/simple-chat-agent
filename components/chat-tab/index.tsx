"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Job, JobType } from "@/lib/db/schema";

type Role = "user" | "assistant";
type Message = {
  id: string;
  role: Role;
  type: JobType;
  text: string;
  /** Image data URL for IMAGE results. */
  image?: string;
  status?: Job["status"];
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
};

export function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [type, setType] = useState<JobType>("TEXT");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      type,
      text: prompt,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, type }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      const { job } = (await res.json()) as { job: Job };
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          type: job.type,
          text: "",
          status: job.status,
        },
      ]);

      if (job.type === "TEXT") {
        await consumeTextStream(job.id, assistantId, setMessages);
      } else {
        await pollForCompletion(job.id, assistantId, setMessages);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to submit: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, input, type]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.25rem)] w-full max-w-3xl flex-col px-4">
      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <div className="pt-20 text-center text-muted-foreground">
            Ask anything. Switch to <span className="font-medium">Image</span>{" "}
            to generate a picture.
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="sticky bottom-0 space-y-2 border-t bg-background py-3">
        <div className="flex items-center gap-2">
          <TypeToggle value={type} onChange={setType} />
          <div className="text-xs text-muted-foreground">
            {type === "TEXT"
              ? "Streams token-by-token via queue + worker."
              : "Generates an image asynchronously."}
          </div>
        </div>
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Your prompt"
            disabled={busy}
            className="min-h-[3rem]"
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || !input.trim()}
          >
            {busy ? "Working…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TypeToggle({
  value,
  onChange,
}: {
  value: JobType;
  onChange: (v: JobType) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {(["TEXT", "IMAGE"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={
            value === t
              ? "bg-primary px-3 py-1 text-xs text-primary-foreground"
              : "bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          }
        >
          {t === "TEXT" ? "Text" : "Image"}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const failed = message.status === "FAILED";
  const base =
    message.role === "user"
      ? "ml-auto bg-primary text-primary-foreground"
      : failed
        ? "bg-destructive/10 text-destructive border border-destructive/30"
        : "bg-muted";
  return (
    <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${base}`}>
      {message.type === "IMAGE" && message.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt="generated"
          src={message.image}
          className="max-w-full rounded"
        />
      ) : null}
      <div className="whitespace-pre-wrap">
        {message.text || (message.status === "STREAMING" ? "…" : "")}
      </div>
      {message.error ? (
        <div className="mt-1 text-xs">{message.error}</div>
      ) : null}
      {message.role === "assistant" &&
      (message.totalTokens != null || message.estimatedCost != null) ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {message.inputTokens != null
            ? `in ${message.inputTokens} · `
            : ""}
          {message.outputTokens != null
            ? `out ${message.outputTokens} · `
            : ""}
          {message.totalTokens != null ? `total ${message.totalTokens}` : ""}
          {message.estimatedCost != null
            ? ` · $${message.estimatedCost.toFixed(5)}`
            : ""}
        </div>
      ) : null}
    </div>
  );
}

async function consumeTextStream(
  jobId: string,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  const url = `/api/jobs/${jobId}/stream`;
  const es = new EventSource(url);
  await new Promise<void>((resolve) => {
    es.addEventListener("delta", (ev) => {
      try {
        const chunk = JSON.parse((ev as MessageEvent).data) as string;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: m.text + chunk, status: "STREAMING" }
              : m
          )
        );
      } catch {}
    });
    es.addEventListener("done", async (ev) => {
      es.close();
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          error?: string;
          done?: boolean;
          status?: Job["status"];
        };
        if (payload.error) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, status: "FAILED", error: payload.error }
                : m
            )
          );
          toast.error(payload.error);
        }
      } catch {}
      // Fetch final stats.
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.ok) {
          const data = (await res.json()) as { job: Job };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    status: data.job.status,
                    error: data.job.error ?? null,
                    inputTokens: data.job.inputTokens,
                    outputTokens: data.job.outputTokens,
                    totalTokens: data.job.totalTokens,
                    estimatedCost:
                      data.job.estimatedCost != null
                        ? Number(data.job.estimatedCost)
                        : null,
                  }
                : m
            )
          );
        }
      } catch {}
      resolve();
    });
    es.onerror = () => {
      es.close();
      resolve();
    };
  });
}

async function pollForCompletion(
  jobId: string,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) continue;
    const { job, output } = (await res.json()) as {
      job: Job;
      output: string | null;
    };
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              text: job.type === "TEXT" ? (output ?? m.text) : m.text,
              image: job.type === "IMAGE" ? (output ?? undefined) : undefined,
              status: job.status,
              error: job.error ?? null,
              estimatedCost:
                job.estimatedCost != null ? Number(job.estimatedCost) : null,
            }
          : m
      )
    );
    if (
      job.status === "COMPLETED" ||
      job.status === "FAILED" ||
      job.status === "CANCELLED"
    ) {
      if (job.status === "FAILED") {
        toast.error(job.error ?? "Job failed");
      }
      return;
    }
  }
}
