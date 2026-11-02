import type { Pagination, RequestOptions } from "./types.js";
import type { Transport } from "./client.js";

/** An inclusive range of days. Dates are read in Africa/Lagos time; a "YYYY-MM-DD" string is sent as is. */
export interface RevenueParams {
  from: Date | string;
  to: Date | string;
  page?: number;
  pageSize?: number;
}

/** One fee charge or reversal. */
export interface RevenueItem {
  reference: string;
  transactionType: "collection" | "payout";
  entryType: "CHARGE" | "REVERSAL";
  principalAmount: number;
  transactionFee: number;
  createdAt: string;
}

/** Fee revenue for a period. */
export interface MerchantRevenue {
  period: { from: string; to: string; timezone: string };
  totalRevenue: number;
  collectionRevenue: number;
  payoutRevenue: number;
  transactionCount: number;
  items: RevenueItem[];
  pagination: Pagination | null;
}

/** Lagos is UTC+1 with no daylight saving. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** @internal */
export function lagosDate(d: Date | string): string {
  return typeof d === "string" ? d : new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** /v2/revenue */
export class Revenue {
  constructor(private readonly t: Transport) {}

  /** Revenue from the transaction fees you charge. Fees reversed on failed payouts are netted out. */
  get(params: RevenueParams, opts?: RequestOptions): Promise<MerchantRevenue> {
    return this.t.call({
      method: "GET",
      path: "/v2/revenue",
      query: { from: lagosDate(params.from), to: lagosDate(params.to), page: params.page, pageSize: params.pageSize },
    }, opts);
  }
}
