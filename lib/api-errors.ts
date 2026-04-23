import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorPayload = {
  code: string;
  message: string;
  hint?: string;
  detail?: string;
};

export class AppError extends Error {
  readonly status: number;
  readonly payload: ErrorPayload;

  constructor(status: number, payload: ErrorPayload, cause?: unknown) {
    super(payload.message, { cause });
    this.status = status;
    this.payload = payload;
    this.name = "AppError";
  }
}

export const ERRORS = {
  validation: (detail: string) =>
    new AppError(400, {
      code: "validation",
      message: "Your input wasn't accepted.",
      hint: "Check the request and try again.",
      detail,
    }),
  invalidJson: () =>
    new AppError(400, {
      code: "validation.json",
      message: "The request body wasn't valid JSON.",
    }),
  unauthorized: () =>
    new AppError(401, {
      code: "auth.unauthorized",
      message: "You're signed out.",
      hint: "Refresh the page to sign in as a guest.",
    }),
  staleSession: (detail?: string) =>
    new AppError(409, {
      code: "auth.stale_session",
      message: "Your session is out of date.",
      hint: "Refresh the page to start a new guest session.",
      detail,
    }),
  forbidden: () =>
    new AppError(403, {
      code: "auth.forbidden",
      message: "You don't have access to this resource.",
    }),
  notFound: (what: string) =>
    new AppError(404, {
      code: "not_found",
      message: `${what} wasn't found.`,
    }),
  aiKeyMissing: () =>
    new AppError(500, {
      code: "ai.key_missing",
      message: "The AI provider isn't configured.",
      hint: "Set OPENAI_API_KEY in .env.local and restart the worker.",
    }),
  streamDisconnected: () =>
    new AppError(0, {
      code: "stream.disconnected",
      message: "Lost connection to the stream.",
      hint: "Retry to reconnect.",
    }),
  internal: (detail?: string) =>
    new AppError(500, {
      code: "internal",
      message: "Something went wrong on the server.",
      hint: "Try again in a moment.",
      detail,
    }),
};

type PgLike = {
  code?: string;
  constraint_name?: string;
  detail?: string;
  message?: string;
};

function isPostgresError(err: unknown): err is PgLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as PgLike).code === "string"
  );
}

function isAiKeyError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 5) return false;
  const anyErr = err as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  if (typeof anyErr.name === "string" && /LoadAPIKeyError/i.test(anyErr.name)) {
    return true;
  }
  const msg = typeof anyErr.message === "string" ? anyErr.message : "";
  if (/api key is missing/i.test(msg)) return true;
  if (isAiKeyError(anyErr.cause, depth + 1)) return true;
  if (Array.isArray(anyErr.errors)) {
    for (const inner of anyErr.errors) {
      if (isAiKeyError(inner, depth + 1)) return true;
    }
  }
  return false;
}

export function mapToAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.join(".") ?? "";
    const detail = path ? `${path}: ${first?.message}` : first?.message;
    return ERRORS.validation(detail ?? "Invalid input.");
  }

  if (isPostgresError(err)) {
    if (err.code === "23503" && (err.constraint_name ?? "").includes("User_id_fk")) {
      return ERRORS.staleSession(err.detail);
    }
  }

  if (isAiKeyError(err)) return ERRORS.aiKeyMissing();

  const detail =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : undefined;
  return ERRORS.internal(detail);
}

function clearGuestCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "authjs.session-token=; Path=/; Max-Age=0; SameSite=Lax"
  );
  headers.append(
    "set-cookie",
    "__Secure-authjs.session-token=; Path=/; Max-Age=0; SameSite=Lax; Secure"
  );
  return headers;
}

export function errorResponse(err: unknown): NextResponse {
  const mapped = mapToAppError(err);

  if (mapped.payload.code === "internal") {
    console.error("[api] unhandled error", err);
  } else if (mapped.payload.code === "auth.stale_session") {
    console.warn("[api] stale session", mapped.payload.detail ?? "");
  }

  const init: ResponseInit = { status: mapped.status || 500 };
  if (mapped.payload.code === "auth.stale_session") {
    init.headers = clearGuestCookieHeaders();
  }

  return NextResponse.json({ error: mapped.payload }, init);
}

type RouteArgs = [Request, ...unknown[]];

export function withErrorHandler<A extends RouteArgs, R extends Response>(
  fn: (...args: A) => Promise<R> | R
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
