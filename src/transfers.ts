import type { Transport } from "./client.js";
import type { AccountParty, Currency, Metadata, Money, RequestOptions } from "./types.js";
import type { TxStatus } from "./transactions.js";

/** A pooled collection balance. */
export type CollectionBalanceName = "reserved" | "reserved-custom" | "invoice";

/** Where a transfer draws money from. Build one with fromCollection or fromWallet. */
export type TransferSource =
  | { type: "collection"; balance: CollectionBalanceName }
  | { type: "wallet"; accountNumber: string };

/** Draw from a pooled collection balance. */
export function fromCollection(balance: CollectionBalanceName): TransferSource {
  return { type: "collection", balance };
}

/** Draw from a specific wallet account. */
export function fromWallet(accountNumber: string): TransferSource {
  return { type: "wallet", accountNumber };
}

/** Body of POST /v2/transfers. */
export interface CreateTransferRequest {
  source: TransferSource;
  destination: { bankCode: string; accountNumber: string };
  amount: Money;
  /** Statement narration, max 50 characters. */
  narration?: string;
  /** Your idempotent client reference. Strongly recommended: reuse it when you retry after reconciling. */
  reference?: string;
  metadata?: Metadata;
}

/** What a transfer debits. */
export interface TransferAmount {
  /** Sent to the beneficiary. */
  value: number;
  /** Your own fee, if any. */
  transactionFee: number;
  /** value + stampDuty + transactionFee. */
  total: number;
  currency: Currency;
}

/** An outbound payout. */
export interface Transfer {
  reference: string;
  accountExchangeReference: string | null;
  sessionId: string | null;
  /** A transaction status, e.g. "AUTHORIZED". See "Transfer statuses" in the README. */
  status: TxStatus;
  amount: TransferAmount;
  stampDuty: number;
  source?: AccountParty | null;
  destination: AccountParty;
  narration: string | null;
  initiatedAt: string | null;
}

/** /v2/transfers */
export class Transfers {
  constructor(private readonly t: Transport) {}

  /**
   * Initiates a transfer. The returned status is usually AUTHORIZED; wait for the
   * transfer.* webhook or poll transactions.get.
   *
   * Never retried by the SDK: on a timeout or 502 the money may still move, so check
   * transactions.get(reference) before retrying yourself with the same reference.
   */
  create(req: CreateTransferRequest, opts?: RequestOptions): Promise<Transfer> {
    return this.t.call({ method: "POST", path: "/v2/transfers", body: req }, opts);
  }
}
