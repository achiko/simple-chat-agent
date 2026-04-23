import { toast } from "sonner";
import { AppError, type ErrorPayload, ERRORS } from "./api-errors";

export { AppError, ERRORS };
export type { ErrorPayload };

export async function readApiError(res: Response): Promise<AppError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return new AppError(res.status, {
      code: `http.${res.status}`,
      message: res.statusText || "Request failed.",
    });
  }
  const payload = extractPayload(body);
  if (payload) return new AppError(res.status, payload);
  return new AppError(res.status, {
    code: `http.${res.status}`,
    message: res.statusText || "Request failed.",
  });
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return ERRORS.internal(err.message);
  return ERRORS.internal(String(err));
}

export function parseErrorPayload(value: unknown): ErrorPayload | null {
  if (typeof value === "string") {
    try {
      return extractPayload(JSON.parse(value));
    } catch {
      return { code: "internal", message: value };
    }
  }
  return extractPayload(value);
}

function extractPayload(value: unknown): ErrorPayload | null {
  if (!value || typeof value !== "object") return null;
  const maybe = (value as { error?: unknown }).error;
  const candidate = maybe ?? value;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as ErrorPayload).code === "string" &&
    typeof (candidate as ErrorPayload).message === "string"
  ) {
    return candidate as ErrorPayload;
  }
  return null;
}

type NotifyOptions = {
  action?: { label: string; onClick: () => void };
};

export function notifyError(err: AppError, opts: NotifyOptions = {}): void {
  const { payload } = err;
  let action = opts.action;
  if (!action && payload.code === "auth.stale_session") {
    action = { label: "Refresh", onClick: () => window.location.reload() };
  }
  toast.error(payload.message, {
    description: payload.hint,
    duration: 8000,
    action,
  });
}
