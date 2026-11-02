/** Error codes returned in the "status" field of an error envelope. */
export const ErrorCode = {
  Validation: "validation-error",
  Unauthorized: "unauthorized-error",
  Forbidden: "forbidden",
  NotFound: "not-found",
  Conflict: "conflict-error",
  Server: "server-error",
  Database: "database-error",
  Gateway: "gateway-error",
} as const;

/** A field-level validation problem. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Thrown for any non-2xx response.
 *
 *     try { ... } catch (err) {
 *       if (err instanceof BuyPowerError && err.code === ErrorCode.Validation) { ... }
 *     }
 */
export class BuyPowerError extends Error {
  override readonly name = "BuyPowerError";
  /** HTTP status code. */
  readonly status: number;
  /** Machine-readable code, e.g. "validation-error". */
  readonly code: string;
  /** Field-level details for validation failures (often empty: the API puts them in `message`). */
  readonly errors: FieldError[];
  /** x-request-id response header, if any. */
  readonly requestId: string | undefined;
  /** Raw response body. */
  readonly body: string;
  /** @internal Retry-After in milliseconds, 0 when absent. */
  readonly retryAfterMs: number;

  constructor(status: number, body: string, headers: Headers) {
    let code = "";
    let message = "";
    let errors: FieldError[] = [];
    try {
      const parsed = JSON.parse(body) as { status?: string; message?: string; errors?: FieldError[] | null };
      code = parsed.status ?? "";
      message = parsed.message ?? "";
      errors = parsed.errors ?? [];
    } catch {
      // Not JSON (e.g. an HTML page from a proxy): keep the HTTP status only.
    }
    message ||= `HTTP ${status}`;
    super(`buypower: ${status} ${code}: ${message}${errors.map((e) => `; ${e.field} ${e.message}`).join("")}`);
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.requestId = headers.get("x-request-id") ?? undefined;
    this.body = body;
    const retryAfter = Number(headers.get("retry-after"));
    this.retryAfterMs = Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
  }

  /** Whether retrying may succeed (429 / 5xx). For money-moving calls, reconcile before retrying a 502. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Whether err is a 404 from the API. */
export function isNotFound(err: unknown): boolean {
  return err instanceof BuyPowerError && err.status === 404;
}
