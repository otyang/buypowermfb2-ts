import type { Transport } from "./client.js";
import type { RequestOptions } from "./types.js";

/** A bank supported for transfers and account resolution. */
export interface Bank {
  code: string;
  name: string;
}

/** The holder of a bank account. */
export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string | null;
}

/** /v2/banking */
export class Banking {
  constructor(private readonly t: Transport) {}

  /** Supported banks. Cache the result; it changes rarely. */
  async listBanks(opts?: RequestOptions): Promise<Bank[]> {
    return (await this.t.list<Bank>({ method: "GET", path: "/v2/banking/banks" }, opts)).data;
  }

  /** The account name for a bank code and NUBAN. Call this before every transfer. */
  resolveAccount(bankCode: string, accountNumber: string, opts?: RequestOptions): Promise<ResolvedAccount> {
    return this.t.call({ method: "GET", path: "/v2/banking/accounts/resolve", query: { bankCode, accountNumber } }, opts);
  }
}
