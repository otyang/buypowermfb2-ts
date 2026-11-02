import { paginate, seg, type Transport } from "./client.js";
import type { Metadata, Money, Page, RequestOptions } from "./types.js";

/** Body of POST /v2/refunds. */
export interface CreateRefundRequest {
  /** Reference of the original confirmed collection. */
  transactionReference: string;
  amount: Money;
  /** 3–255 characters. */
  reason: string;
  /** Up to 500 characters. */
  note?: string;
  metadata?: Metadata;
}

/** A full or partial reversal of a collection. */
export interface Refund {
  reference: string;
  transactionReference: string;
  amount: Money;
  status: string;
  reason: string | null;
  note: string | null;
  type: string | null;
  strategy: string | null;
  comment: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

/** Filters for GET /v2/refunds. Note refunds page with `size`, not `pageSize`. */
export interface RefundListParams {
  page?: number;
  size?: number;
  status?: string;
  transactionReference?: string;
}

/** /v2/refunds */
export class Refunds {
  constructor(private readonly t: Transport) {}

  /**
   * Initiates a refund (202 Accepted). An Idempotency-Key is generated per call
   * unless you pass one; persist your own if you need retries across restarts.
   */
  create(req: CreateRefundRequest, opts: RequestOptions = {}): Promise<Refund> {
    return this.t.call(
      { method: "POST", path: "/v2/refunds", body: req, retryable: true },
      { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() },
    );
  }

  /** One page of refunds. */
  list(params: RefundListParams = {}, opts?: RequestOptions): Promise<Page<Refund>> {
    return this.t.list({ method: "GET", path: "/v2/refunds", query: { ...params } }, opts);
  }

  /** Every refund matching params, across all pages. */
  listAll(params: RefundListParams = {}, opts?: RequestOptions): AsyncGenerator<Refund> {
    const size = params.size ?? 100;
    return paginate((page) => this.list({ ...params, page, size }, opts));
  }

  /** A refund by its reference. */
  get(refundReference: string, opts?: RequestOptions): Promise<Refund> {
    return this.t.call({ method: "GET", path: `/v2/refunds/${seg(refundReference)}` }, opts);
  }
}
