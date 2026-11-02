import { listAll, seg, type Transport } from "./client.js";
import type { Currency, ListParams, Metadata, Page, RequestOptions } from "./types.js";

/** An account that keeps its own balance. */
export interface Wallet {
  reference: string;
  accountNumber: string;
  accountName: string;
  bankCode: string | null;
  bankName: string | null;
  type: string | null;
  currency: Currency | null;
  balance: number;
  createdAt: string | null;
}

/** The balance of one wallet. */
export interface WalletBalance {
  reference: string;
  accountNumber: string;
  balance: number;
  currency: Currency | null;
}

/** Body of POST /v2/wallets. At least one of bvn or nin is required. */
export interface CreateWalletRequest {
  name: string;
  /** Generated if omitted. */
  reference?: string;
  description?: string;
  bvn?: string;
  nin?: string;
  /** 10 digits, optional. */
  accountNumber?: string;
  metadata?: Metadata;
}

/** /v2/wallets */
export class Wallets {
  constructor(private readonly t: Transport) {}

  /** Creates a wallet. Creates are idempotent on reference, so they are retried only when it is set. */
  create(req: CreateWalletRequest, opts?: RequestOptions): Promise<Wallet> {
    return this.t.call({ method: "POST", path: "/v2/wallets", body: req, retryable: !!req.reference }, opts);
  }

  /** One page of wallets with balances. */
  list(params: ListParams = {}, opts?: RequestOptions): Promise<Page<Wallet>> {
    return this.t.list({ method: "GET", path: "/v2/wallets", query: { ...params } }, opts);
  }

  /** Every wallet. */
  listAll(params?: ListParams, opts?: RequestOptions): AsyncGenerator<Wallet> {
    return listAll(params, (p, o) => this.list(p, o), opts);
  }

  /** A wallet by your reference or its account number. */
  get(reference: string, opts?: RequestOptions): Promise<Wallet> {
    return this.t.call({ method: "GET", path: `/v2/wallets/${seg(reference)}` }, opts);
  }

  /** A wallet's balance. */
  balance(reference: string, opts?: RequestOptions): Promise<WalletBalance> {
    return this.t.call({ method: "GET", path: `/v2/wallets/${seg(reference)}/balance` }, opts);
  }
}
