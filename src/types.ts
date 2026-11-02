/** ISO currency code. Only NGN is honoured today. */
export type Currency = "NGN" | (string & {});

/** An amount in major units (naira, not kobo). */
export interface Money {
  value: number;
  currency?: Currency;
}

/** A naira Money value: `ngn(5000)` is ₦5,000.00. */
export function ngn(value: number): Money {
  return { value, currency: "NGN" };
}

/**
 * Rounds v to two decimal places, allowing only floating-point noise (a few
 * units in the last place) to be rounded away. A real third decimal place
 * throws, because BuyPower would otherwise round it silently.
 */
export function toKobo(v: number): number {
  const kobo = v * 100;
  const k = Math.round(kobo);
  if (!Number.isFinite(v) || Math.abs(kobo - k) > Math.max(1e-6, Math.abs(kobo) * 1e-13)) {
    throw new RangeError(`buypower: amount ${v} has more than two decimal places; BuyPower works in kobo, so round it first`);
  }
  return k / 100;
}

/** A counterparty bank account. */
export interface AccountParty {
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
}

/** Arbitrary key/value data stored with a resource. */
export type Metadata = Record<string, unknown>;

/** Returned in meta.pagination on list endpoints. */
export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** One page of a list response. `pagination` is null when the endpoint does not paginate. */
export interface Page<T> {
  data: T[];
  pagination: Pagination | null;
}

/** Paging parameters shared by v2 list endpoints. Omitted values use the server defaults (page 1, 15 per page, max 100). */
export interface ListParams {
  page?: number;
  pageSize?: number;
}

/** Options for a single API call. */
export interface RequestOptions {
  /** Cancels the call. */
  signal?: AbortSignal;
  /** Idempotency-Key header (honoured on refunds). */
  idempotencyKey?: string;
  /** x-request-id header, which support can use to trace a call. */
  requestId?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

/** Whether a page has further pages. */
export function hasMore(page: Page<unknown>): boolean {
  return page.pagination !== null && page.pagination.page < page.pagination.totalPages;
}
