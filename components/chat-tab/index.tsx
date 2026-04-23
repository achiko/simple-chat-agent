"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Textarea } from "@/components/ui/textarea";
import type { ErrorPayload } from "@/lib/api-errors";
import {
  AppError,
  ERRORS,
  notifyError,
  parseErrorPayload,
  readApiError,
  toAppError,
} from "@/lib/client-errors";
import type { ChatSession, Job, JobType } from "@/lib/db/schema";
import { ThinkingIndicator } from "./thinking-indicator";

type Role = "user" | "assistant";
type Message = {
  id: string;
  role: Role;
  type: JobType;
  text: string;
  /** Image data URL for IMAGE results. */
  image?: string;
  status?: Job["status"];
  error?: ErrorPayload | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  /** Set on assistant messages that correspond to a real DB Job. Used to reconnect in-flight jobs on rehydrate. */
  jobId?: string;
};

export type InitialMessage = Message;

const NON_TERMINAL: Job["status"][] = [
  "PENDING",
  "QUEUED",
  "STARTED",
  "STREAMING",
];

export function ChatTab({
  initialSessionId,
  initialMessages,
}: {
  initialSessionId?: string;
  initialMessages?: InitialMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [type, setType] = useState<JobType>("TEXT");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);
  const creatingSessionRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reconnect to any in-flight jobs when loading an existing session.
  useEffect(() => {
    if (!initialMessages) return;
    for (const m of initialMessages) {
      if (
        m.role !== "assistant" ||
        !m.jobId ||
        !m.status ||
        !NON_TERMINAL.includes(m.status)
      ) {
        continue;
      }
      if (m.type === "TEXT") {
        void consumeTextStream(m.jobId, m.id, setMessages);
      } else {
        void pollForCompletion(m.jobId, m.id, setMessages);
      }
    }
  }, [initialMessages]);

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

    const firstPrompt = !sessionIdRef.current;
    try {
      // Lazily create a session on the very first prompt.
      if (!sessionIdRef.current) {
        if (!creatingSessionRef.current) {
          creatingSessionRef.current = (async () => {
            const res = await fetch("/api/sessions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ firstPrompt: prompt }),
            });
            if (!res.ok) throw await readApiError(res);
            const { session } = (await res.json()) as {
              session: ChatSession;
            };
            return session.id;
          })();
        }
        const id = await creatingSessionRef.current;
        sessionIdRef.current = id;
        creatingSessionRef.current = null;
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          type,
          sessionId: sessionIdRef.current,
        }),
      });
      if (!res.ok) throw await readApiError(res);
      const { job } = (await res.json()) as { job: Job };

      // On the first prompt of a new session, hand off to the canonical
      // /chat/[sessionId] route. The server component rehydrates the
      // just-inserted job, and the reconnect-on-mount effect re-opens SSE
      // (stream replays any chunks already persisted). Clear the optimistic
      // user bubble AND the sessionId ref first — next.config
      // `cachedNavigations: true` preserves this "/" route tree, so any
      // state we leave behind bleeds back when the user hits "+ New chat".
      if (firstPrompt) {
        const newSessionId = sessionIdRef.current;
        sessionIdRef.current = null;
        setMessages([]);
        router.replace(`/chat/${newSessionId}`);
        return;
      }

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          type: job.type,
          text: "",
          status: job.status,
          jobId: job.id,
        },
      ]);

      if (job.type === "TEXT") {
        await consumeTextStream(job.id, assistantId, setMessages);
      } else {
        await pollForCompletion(job.id, assistantId, setMessages);
      }
    } catch (err) {
      const appErr = toAppError(err);
      // Drop the optimistic user bubble so resubmitting after a guest-session
      // refresh doesn't double-render the prompt.
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      notifyError(appErr);
    } finally {
      setBusy(false);
    }
  }, [busy, input, router, type]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col px-4">
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
  const isAssistant = message.role === "assistant";
  const failed = message.status === "FAILED";
  const isWorking =
    isAssistant &&
    !message.text &&
    !message.image &&
    !!message.status &&
    (NON_TERMINAL.includes(message.status) || message.status === "PENDING");

  if (isWorking) {
    return <ThinkingIndicator type={message.type} />;
  }

  if (failed && message.error) {
    return (
      <div className="max-w-[80%]">
        <ErrorCard error={message.error} size="sm" />
      </div>
    );
  }
  const base =
    message.role === "user"
      ? "ml-auto bg-primary text-primary-foreground"
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
      <div className="whitespace-pre-wrap">{message.text}</div>
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
  let doneReceived = false;
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
      doneReceived = true;
      es.close();
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          error?: unknown;
          done?: boolean;
          status?: Job["status"];
        };
        const errorPayload = parseErrorPayload(payload.error);
        if (errorPayload) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, status: "FAILED", error: errorPayload }
                : m
            )
          );
          notifyError(new AppError(0, errorPayload));
        }
      } catch {}
      // Fetch final stats.
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.ok) {
          const data = (await res.json()) as { job: Job };
          const errorPayload = parseErrorPayload(data.job.error);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    status: data.job.status,
                    error: errorPayload,
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
      if (doneReceived) {
        resolve();
        return;
      }
      const err = ERRORS.streamDisconnected();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, status: "FAILED", error: err.payload } : m
        )
      );
      notifyError(err, {
        action: {
          label: "Retry",
          onClick: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, status: "STREAMING", error: null }
                  : m
              )
            );
            void consumeTextStream(jobId, assistantId, setMessages);
          },
        },
      });
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
    const errorPayload = parseErrorPayload(job.error);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              text: job.type === "TEXT" ? (output ?? m.text) : m.text,
              image: job.type === "IMAGE" ? (output ?? undefined) : undefined,
              status: job.status,
              error: errorPayload,
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
        notifyError(
          new AppError(
            0,
            errorPayload ?? {
              code: "job.failed",
              message: "The job failed.",
            }
          )
        );
      }
      return;
    }
  }
}
