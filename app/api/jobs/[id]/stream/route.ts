import { auth } from "@/app/(auth)/auth";
import { ERRORS, withErrorHandler } from "@/lib/api-errors";
import { getJob } from "@/lib/db/jobs";
import { chunksKey, createRedis, streamChannel } from "@/lib/queue";
import { decActiveStreams, incActiveStreams } from "@/lib/system/metrics";

export const GET = withErrorHandler(
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const session = await auth();
    if (!session?.user?.id) throw ERRORS.unauthorized();

    const { id } = await params;
    const row = await getJob(id);
    if (!row) throw ERRORS.notFound("Job");
    if (row.job.userId !== session.user.id) throw ERRORS.forbidden();
    if (row.job.type !== "TEXT") throw ERRORS.validation("Only TEXT jobs stream.");

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
          let parsedError: unknown;
          if (row.job.error) {
            try {
              parsedError = JSON.parse(row.job.error);
            } catch {
              parsedError = { code: "internal", message: row.job.error };
            }
          }
          send(
            "done",
            JSON.stringify({
              status: row.job.status,
              ...(parsedError ? { error: parsedError } : {}),
            })
          );
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
);
