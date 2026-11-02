/**
 * TypeScript SDK for the BuyPower MFB v2 Integration API.
 *
 *     const client = new BuyPower({ apiKey: process.env.BP_API_KEY!, businessId: process.env.BP_BUSINESS_ID! });
 *     const banks = await client.banking.listBanks();
 *
 * See https://docs.buypowermfb.net/docs/introduction.
 */
import { Transport, type ClientOptions } from "./client.js";
import { Banking } from "./banking.js";
import { InvoiceAccounts, ReservedAccounts } from "./accounts.js";
import { Collections } from "./collections.js";
import { Refunds } from "./refunds.js";
import { Revenue } from "./revenue.js";
import { Transactions } from "./transactions.js";
import { Transfers } from "./transfers.js";
import { Wallets } from "./wallets.js";
import { Webhooks } from "./webhooks.js";

/** The v2 API client. Safe to share across concurrent requests. */
export class BuyPower {
  readonly transfers: Transfers;
  readonly refunds: Refunds;
  readonly banking: Banking;
  readonly reservedAccounts: ReservedAccounts;
  readonly invoiceAccounts: InvoiceAccounts;
  readonly wallets: Wallets;
  readonly collections: Collections;
  readonly transactions: Transactions;
  readonly webhooks: Webhooks;
  readonly revenue: Revenue;
  private readonly transport: Transport;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey || !String(opts.businessId)) throw new Error("buypower: apiKey and businessId are required");
    this.transport = new Transport(opts);
    this.transfers = new Transfers(this.transport);
    this.refunds = new Refunds(this.transport);
    this.banking = new Banking(this.transport);
    this.reservedAccounts = new ReservedAccounts(this.transport);
    this.invoiceAccounts = new InvoiceAccounts(this.transport);
    this.wallets = new Wallets(this.transport);
    this.collections = new Collections(this.transport);
    this.transactions = new Transactions(this.transport);
    this.webhooks = new Webhooks(this.transport);
    this.revenue = new Revenue(this.transport);
  }

  /** Reads BP_API_KEY and BP_BUSINESS_ID from the environment (Node, Bun, Deno with --allow-env). */
  static fromEnv(opts: Partial<ClientOptions> = {}): BuyPower {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const apiKey = env.BP_API_KEY;
    const businessId = env.BP_BUSINESS_ID;
    if (!apiKey || !businessId) throw new Error("buypower: BP_API_KEY and BP_BUSINESS_ID must be set");
    return new BuyPower({ ...opts, apiKey, businessId });
  }

  /** The base URL this client calls. */
  get baseUrl(): string {
    return this.transport.baseUrl;
  }
}

export { LIVE_URL, SANDBOX_URL, VERSION, type ClientOptions, type Environment } from "./client.js";
export { BuyPowerError, ErrorCode, isNotFound, type FieldError } from "./errors.js";
export { hasMore, ngn, toKobo, type AccountParty, type Currency, type ListParams, type Metadata, type Money, type Page, type Pagination, type RequestOptions } from "./types.js";
export { fromCollection, fromWallet, type CollectionBalanceName, type CreateTransferRequest, type Transfer, type TransferAmount, type TransferSource } from "./transfers.js";
export { type CreateRefundRequest, type Refund, type RefundListParams } from "./refunds.js";
export { type Bank, type ResolvedAccount } from "./banking.js";
export { type BankAccount, type CreateInvoiceAccountRequest, type CreateReservedAccountRequest } from "./accounts.js";
export { type CreateWalletRequest, type Wallet, type WalletBalance } from "./wallets.js";
export { type CollectionAccount, type CollectionBalance } from "./collections.js";
export { TxStatus, TxType, type Direction, type Transaction, type TransactionAmount } from "./transactions.js";
export { type MerchantRevenue, type RevenueItem, type RevenueParams } from "./revenue.js";
export {
  InvalidSignatureError,
  PANBOX_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  WebhookEventType,
  computeSignature,
  constructEvent,
  refundOf,
  transactionOf,
  verifySignature,
  webhookHandler,
  type WebhookEvent,
  type WebhookRefund,
  type WebhookSubscription,
  type WebhookSubscriptionInput,
  type WebhookTopic,
  type WebhookTransaction,
} from "./webhooks.js";
