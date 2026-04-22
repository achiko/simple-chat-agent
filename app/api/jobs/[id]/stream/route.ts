import { auth } from "@/app/(auth)/auth";
import { getJob } from "@/lib/db/jobs";
import { chunksKey, createRedis, streamChannel } from "@/lib/queue";
import { incActiveStreams, decActiveStreams } from "@/lib/system/metrics";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 });
  }

  const { id } = await params;
  const row = await getJob(id);
  if (!row) {
    return new Response("not found", { status: 404 });
  }
  if (row.job.userId !== session.user.id) {
    return new Response("forbidden", { status: 403 });
  }
  if (row.job.type !== "TEXT") {
    return new Response("only text jobs can be streamed", { status: 400 });
  }

  const encoder = new TextEncoder();
  const subscriber = createRedis();
  const reader = createRedis();

  incActiveStreams();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      };

      // Replay persisted chunks first.
      try {
        const chunks = await reader.lrange(chunksKey(id), 0, -1);
        for (const chunk of chunks) {
          send("delta", JSON.stringify(chunk));
        }
      } catch (err) {
        console.error("[sse] replay failed", err);
      }

      // If job already terminal, close after replay.
      if (
        row.job.status === "COMPLETED" ||
        row.job.status === "FAILED" ||
        row.job.status === "CANCELLED"
      ) {
        send("done", JSON.stringify({ status: row.job.status }));
        controller.close();
        await reader.quit();
        await subscriber.quit();
        decActiveStreams();
        return;
      }

      await subscriber.subscribe(streamChannel(id));
      subscriber.on("message", (_channel, message) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed && typeof parsed === "object" && "done" in parsed) {
            send("done", message);
            controller.close();
            void subscriber.quit();
            void reader.quit();
            decActiveStreams();
            return;
          }
        } catch {
          // Plain text delta.
        }
        send("delta", JSON.stringify(message));
      });
    },
    cancel() {
      void subscriber.quit();
      void reader.quit();
      decActiveStreams();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
