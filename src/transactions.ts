import { listAll, seg, type Transport } from "./client.js";
import type { AccountParty, Currency, ListParams, Page, RequestOptions } from "./types.js";

/** Transaction types. */
export const TxType = {
  Collection: "COLLECTION",
  Transfer: "TRANSFER",
  Refund: "REFUND",
  Withdrawal: "WITHDRAWAL",
  Adjustment: "ADJUSTMENT",
} as const;

/** Transaction statuses, also used by transfers. Confirmed and Unresolved are final. */
export const TxStatus = {
  Pending: "PENDING",
  Authorized: "AUTHORIZED",
  Submitted: "SUBMITTED",
  Confirmed: "CONFIRMED",
  Unresolved: "UNRESOLVED",
  Rejected: "REJECTED",
  RefundInitiated: "REFUND_INITIATED",
  Refunded: "REFUNDED",
  RefundedPartially: "REFUNDED_PARTIALLY",
} as const;
export type TxStatus = (typeof TxStatus)[keyof typeof TxStatus] | (string & {});

export type Direction = "INFLOW" | "OUTFLOW";

/** A transaction's money fields. */
export interface TransactionAmount {
  value: number;
  /** Platform fee; null when none applies. */
  fee: number | null;
  stampDuty?: number;
  transactionFee?: number;
  settlementAmount?: number;
  total?: number;
  currency: Currency;
}

/** A collection, transfer, refund, withdrawal or adjustment. */
export interface Transaction {
  reference: string;
  accountExchangeReference?: string | null;
  sessionId: string | null;
  type: (typeof TxType)[keyof typeof TxType] | (string & {});
  status: TxStatus;
  direction: Direction | null;
  amount: TransactionAmount;
  source: AccountParty;
  destination: AccountParty;
  narration: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** /v2/transactions */
export class Transactions {
  constructor(private readonly t: Transport) {}

  /** One page of transactions. */
  list(params: ListParams = {}, opts?: RequestOptions): Promise<Page<Transaction>> {
    return this.t.list({ method: "GET", path: "/v2/transactions", query: { ...params } }, opts);
  }

  /** Every transaction. */
  listAll(params?: ListParams, opts?: RequestOptions): AsyncGenerator<Transaction> {
    return listAll(params, (p, o) => this.list(p, o), opts);
  }

  /** A transaction by reference or numeric id. The source of truth for reconciliation. */
  get(reference: string, opts?: RequestOptions): Promise<Transaction> {
    return this.t.call({ method: "GET", path: `/v2/transactions/${seg(reference)}` }, opts);
  }
}
