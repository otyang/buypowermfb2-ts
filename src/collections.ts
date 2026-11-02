import type { Transport } from "./client.js";
import type { Currency, RequestOptions } from "./types.js";

// Field names follow what the API returns, which differs from openapi.json
// (it documents "type" and "available").

/** An account that virtual accounts of one type sweep into. */
export interface CollectionAccount {
  accountNumber: string;
  name: string | null;
  description: string | null;
  /** e.g. "collection.static", "collection.invoice". */
  accountType: string;
  bankName: string | null;
  bankCode: string | null;
}

/** A pooled balance you can transfer out of. */
export interface CollectionBalance extends CollectionAccount {
  currency: Currency | null;
  balance: {
    /** Available to transfer. */
    balance: number;
    blockedAmount: number;
  };
}

/** /v2/collections */
export class Collections {
  constructor(private readonly t: Transport) {}

  /** Your collection accounts. */
  async listAccounts(opts?: RequestOptions): Promise<CollectionAccount[]> {
    return (await this.t.list<CollectionAccount>({ method: "GET", path: "/v2/collections/accounts" }, opts)).data;
  }

  /** Your collection balances. */
  async balances(opts?: RequestOptions): Promise<CollectionBalance[]> {
    return (await this.t.list<CollectionBalance>({ method: "GET", path: "/v2/collections/balances" }, opts)).data;
  }
}
