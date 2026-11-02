import { BuyPowerError } from "./errors.js";
import type { ListParams, Page, Pagination, RequestOptions } from "./types.js";
import { hasMore, toKobo } from "./types.js";

export const VERSION = "0.1.0";
export const LIVE_URL = "https://api.buypowermfb.net";
export const SANDBOX_URL = "https://api-sandbox.buypowermfb.net";

export type Environment = "live" | "sandbox";

export interface ClientOptions {
  /** Your API key (sk_live_… or sk_test_…). */
  apiKey: string;
  /** Your numeric Business ID. */
  businessId: string | number;
  /**
   * Live or sandbox. Also sends x-api-environment so the server resolves the same one.
   * Default: inferred from the key prefix (sk_live_ → live, otherwise sandbox).
   */
  environment?: Environment;
  /** Overrides the base URL (e.g. a proxy or tests). */
  baseUrl?: string;
  /** Retries on network errors, 429 and 5xx for retry-safe calls. Default 2; 0 disables. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation. Default: the global fetch. */
  fetch?: typeof fetch;
  /** Appended to the User-Agent header where the runtime allows setting it. */
  userAgent?: string;
}

/** @internal */
export interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Marks a non-GET request as safe to retry, e.g. a POST carrying a client reference or an Idempotency-Key. */
  retryable?: boolean;
}

interface Envelope {
  status: string;
  message: string;
  data: unknown;
  meta?: { pagination?: Pagination } | null;
}

/** @internal Shared HTTP plumbing used by every service. */
export class Transport {
  readonly baseUrl: string;
  /** @internal Base retry delay in ms; lowered in tests. */
  retryBaseMs = 500;
  private readonly token: string;
  private readonly environment: Environment | undefined;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: ClientOptions) {
    this.token = `${opts.apiKey}:${opts.businessId}`;
    this.environment = opts.environment;
    const env = opts.environment ?? (opts.apiKey.startsWith("sk_live_") ? "live" : "sandbox");
    this.baseUrl = (opts.baseUrl ?? (env === "live" ? LIVE_URL : SANDBOX_URL)).replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = `buypowermfb2-ts/${VERSION}${opts.userAgent ? ` ${opts.userAgent}` : ""}`;
  }

  /** Performs a request and returns envelope.data. */
  async call<T>(req: ApiRequest, opts: RequestOptions = {}): Promise<T> {
    const env = await this.send(req, opts);
    return env.data as T;
  }

  /** Performs a request whose data is a list. The spec declares some list payloads as a single object, so both shapes are accepted. */
  async list<T>(req: ApiRequest, opts: RequestOptions = {}): Promise<Page<T>> {
    const env = await this.send(req, opts);
    const data = env.data == null ? [] : Array.isArray(env.data) ? (env.data as T[]) : [env.data as T];
    return { data, pagination: env.meta?.pagination ?? null };
  }

  private async send(req: ApiRequest, opts: RequestOptions): Promise<Envelope> {
    const url = new URL(this.baseUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.environment) headers["x-api-environment"] = this.environment;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.requestId) headers["x-request-id"] = opts.requestId;
    Object.assign(headers, opts.headers);
    // Request amounts are sent rounded to the kobo; see toKobo.
    const body = req.body === undefined ? undefined : JSON.stringify(req.body, (key, value: unknown) =>
      key === "amount" && typeof value === "object" && value !== null && typeof (value as { value?: unknown }).value === "number"
        ? { ...value, value: toKobo((value as { value: number }).value) }
        : value,
    );

    const retryable = req.method === "GET" || req.retryable === true;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(req.method, url, headers, body, opts.signal);
      } catch (err) {
        if (!retryable || attempt >= this.maxRetries || !shouldRetry(err, opts.signal)) throw err;
        await sleep(this.backoff(attempt, err), opts.signal);
      }
    }
  }

  private async once(method: string, url: URL, headers: Record<string, string>, body: string | undefined, signal?: AbortSignal): Promise<Envelope> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    if (res.status >= 400) throw new BuyPowerError(res.status, text, res.headers);
    try {
      return JSON.parse(text) as Envelope;
    } catch (err) {
      throw new Error(`buypower: decode response (HTTP ${res.status}): ${(err as Error).message}`);
    }
  }

  private backoff(attempt: number, err: unknown): number {
    if (err instanceof BuyPowerError && err.retryAfterMs > 0) return err.retryAfterMs;
    const d = Math.min(this.retryBaseMs * 2 ** Math.min(attempt, 10), 30_000);
    return d + Math.random() * (d / 4);
  }
}

function shouldRetry(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false; // the caller cancelled
  if (err instanceof BuyPowerError) return err.retryable;
  // fetch rejects with TypeError on network failure and TimeoutError on our per-attempt timeout.
  return err instanceof TypeError || (err instanceof DOMException && err.name === "TimeoutError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Walks every page starting at page 1, yielding each item. */
export async function* paginate<T>(fetchPage: (page: number) => Promise<Page<T>>): AsyncGenerator<T> {
  for (let page = 1; ; page++) {
    const p = await fetchPage(page);
    yield* p.data;
    if (p.data.length === 0 || !hasMore(p)) return;
  }
}

/** Walks every page of a ListParams-paged endpoint, 100 per page by default. */
export function listAll<T>(
  params: ListParams | undefined,
  list: (params: ListParams, opts?: RequestOptions) => Promise<Page<T>>,
  opts?: RequestOptions,
): AsyncGenerator<T> {
  const pageSize = params?.pageSize ?? 100;
  return paginate((page) => list({ page, pageSize }, opts));
}

export function seg(s: string): string {
  return encodeURIComponent(s);
}
