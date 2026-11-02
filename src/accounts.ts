import { listAll, seg, type Transport } from "./client.js";
import type { Currency, ListParams, Metadata, Money, Page, RequestOptions } from "./types.js";

/** A reserved or invoice virtual account. */
export interface BankAccount {
  reference: string;
  accountNumber: string;
  accountName: string;
  bankCode: string | null;
  bankName: string | null;
  type: string | null;
  description: string | null;
  currency: Currency | null;
  metadata: Metadata | null;
  createdAt: string | null;
}

/** Body of POST /v2/accounts/reserved. At least one of bvn or nin is required. */
export interface CreateReservedAccountRequest {
  reference: string;
  name: string;
  description: string;
  /** Default "static". */
  type?: "static" | "savings" | "static-custom";
  /** 11 digits. */
  bvn?: string;
  /** 11 digits. */
  nin?: string;
  /** 10 digits. */
  preferredAccountNumber?: string;
  metadata?: Metadata;
}

/** /v2/accounts/reserved */
export class ReservedAccounts {
  constructor(private readonly t: Transport) {}

  /** Creates a static virtual account. Retried only when reference is set. */
  create(req: CreateReservedAccountRequest, opts?: RequestOptions): Promise<BankAccount> {
    return this.t.call({ method: "POST", path: "/v2/accounts/reserved", body: req, retryable: !!req.reference }, opts);
  }

  /** One page of reserved accounts. */
  list(params: ListParams = {}, opts?: RequestOptions): Promise<Page<BankAccount>> {
    return this.t.list({ method: "GET", path: "/v2/accounts/reserved", query: { ...params } }, opts);
  }

  /** Every reserved account. */
  listAll(params?: ListParams, opts?: RequestOptions): AsyncGenerator<BankAccount> {
    return listAll(params, (p, o) => this.list(p, o), opts);
  }

  /** Balance of one reserved account. The spec leaves the payload untyped. */
  balance(reference: string, opts?: RequestOptions): Promise<unknown> {
    return this.t.call({ method: "GET", path: `/v2/accounts/reserved/${seg(reference)}/balance` }, opts);
  }

  /** Changes a reserved account's name. */
  rename(reference: string, name: string, opts?: RequestOptions): Promise<BankAccount> {
    return this.t.call({ method: "PATCH", path: `/v2/accounts/reserved/${seg(reference)}`, body: { name }, retryable: true }, opts);
  }
}

/** Body of POST /v2/accounts/invoices. */
export interface CreateInvoiceAccountRequest {
  reference: string;
  name: string;
  email: string;
  description: string;
  amount: Money;
  /** ISO-8601, e.g. new Date(Date.now() + 86_400_000).toISOString(). */
  expiresAt: string;
  metadata?: Metadata;
}

/** /v2/accounts/invoices */
export class InvoiceAccounts {
  constructor(private readonly t: Transport) {}

  /** Creates a one-time account for a fixed amount. Retried only when reference is set. */
  create(req: CreateInvoiceAccountRequest, opts?: RequestOptions): Promise<BankAccount> {
    return this.t.call({ method: "POST", path: "/v2/accounts/invoices", body: req, retryable: !!req.reference }, opts);
  }

  /** One page of invoice accounts. */
  list(params: ListParams = {}, opts?: RequestOptions): Promise<Page<BankAccount>> {
    return this.t.list({ method: "GET", path: "/v2/accounts/invoices", query: { ...params } }, opts);
  }

  /** Every invoice account. */
  listAll(params?: ListParams, opts?: RequestOptions): AsyncGenerator<BankAccount> {
    return listAll(params, (p, o) => this.list(p, o), opts);
  }
}
