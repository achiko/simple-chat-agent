import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/app/(auth)/auth";
import { ChatTab, type InitialMessage } from "@/components/chat-tab";
import type { ErrorPayload } from "@/lib/api-errors";
import { getJobsWithOutputsBySession, getSession } from "@/lib/db/sessions";

export default function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatSessionLoader params={params} />
    </Suspense>
  );
}

function ChatFallback() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl items-center justify-center px-4 text-muted-foreground">
      Loading chat…
    </div>
  );
}

async function ChatSessionLoader({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/guest");
  }

  const row = await getSession(sessionId);
  if (!row) {
    notFound();
  }
  if (row.userId !== session.user.id) {
    notFound();
  }

  const jobs = await getJobsWithOutputsBySession(sessionId);

  const initialMessages: InitialMessage[] = jobs.flatMap(({ job, output }) => {
    const user: InitialMessage = {
      id: `${job.id}-user`,
      role: "user",
      type: job.type,
      text: job.prompt,
    };
    const assistant: InitialMessage = {
      id: `${job.id}-assistant`,
      role: "assistant",
      type: job.type,
      text: job.type === "TEXT" ? (output ?? "") : "",
      image: job.type === "IMAGE" && output ? output : undefined,
      status: job.status,
      error: parseStoredError(job.error),
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      totalTokens: job.totalTokens,
      estimatedCost:
        job.estimatedCost == null ? null : Number(job.estimatedCost),
      jobId: job.id,
    };
    return [user, assistant];
  });

  return (
    <ChatTab
      initialMessages={initialMessages}
      initialSessionId={sessionId}
      key={sessionId}
    />
  );
}

function parseStoredError(raw: string | null): ErrorPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.code === "string" &&
      typeof parsed.message === "string"
    ) {
      return parsed as ErrorPayload;
    }
  } catch {}
  return { code: "internal", message: raw };
}
