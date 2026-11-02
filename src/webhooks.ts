import type { Transport } from "./client.js";
import type { Currency, Metadata, RequestOptions } from "./types.js";
import type { Direction, TxStatus } from "./transactions.js";

export type WebhookTopic = "general" | "collections" | "transfers" | "settlements" | "refunds";

/** Event types delivered in WebhookEvent.type. */
export const WebhookEventType = {
  InvoicePaid: "invoice.paid",
  StaticAccountTransactionCreated: "static_account.transaction.created",
  TransferPending: "transfer.pending",
  TransferPaid: "transfer.paid",
  TransferFailed: "transfer.failed",
  RefundInitiated: "refund.initiated",
  RefundCompleted: "refund.completed",
  RefundPartiallyCompleted: "refund.partially_completed",
  RefundFailed: "refund.failed",
} as const;

/** Webhook delivery headers. */
export const SIGNATURE_HEADER = "x-buypower-signature";
/** Identical value to SIGNATURE_HEADER (alias). */
export const PANBOX_SIGNATURE_HEADER = "x-panbox-signature";

/** A topic → URL mapping. */
export interface WebhookSubscription {
  topic: WebhookTopic;
  url: string | null;
  payloadVersion?: string | null;
  enabled?: boolean;
}

/** Registers one endpoint for a topic. */
export interface WebhookSubscriptionInput {
  url: string;
  topic?: WebhookTopic;
  /** Defaults to "2" in this SDK (the server default is "1"). */
  payloadVersion?: "1" | "2";
}

/** /v2/webhooks */
export class Webhooks {
  constructor(private readonly t: Transport) {}

  /** Webhook subscriptions. */
  async listSubscriptions(opts?: RequestOptions): Promise<WebhookSubscription[]> {
    return (await this.t.list<WebhookSubscription>({ method: "GET", path: "/v2/webhooks/subscriptions" }, opts)).data;
  }

  /**
   * Creates or updates subscriptions by topic. Subscriptions are per environment.
   * The response is discarded: the server returns raw database rows that echo the
   * webhook secret. Read the result back with listSubscriptions.
   */
  async upsertSubscriptions(subs: WebhookSubscriptionInput[], opts?: RequestOptions): Promise<void> {
    if (subs.length === 0) throw new Error("buypower: at least one subscription is required");
    const body = subs.map((s) => ({ ...s, payloadVersion: s.payloadVersion ?? "2" }));
    await this.t.call({ method: "PUT", path: "/v2/webhooks/subscriptions", body, retryable: true }, opts);
  }
}

/** Thrown when a webhook signature does not match. */
export class InvalidSignatureError extends Error {
  override readonly name = "InvalidSignatureError";
  constructor() {
    super("buypower: invalid webhook signature");
  }
}

/** The v2 webhook envelope. */
export interface WebhookEvent {
  /** evt_…, stable across retries: de-duplicate on it. */
  id: string;
  /** e.g. "transfer.paid". */
  type: string;
  /** Always "2". */
  version: string;
  created: string;
  data: unknown;
}

/** The data of collections and transfers events. */
export interface WebhookTransaction {
  transactionId: number;
  transactionReference: string;
  accountExchangeReference: string | null;
  sessionId: string | null;
  accountNumber: string;
  accountType: string;
  amount: number;
  fee: number;
  stampDuty: number;
  settlementAmount: number;
  transactionFee: number;
  totalAmount: number;
  transactionType: "collection" | "payout";
  sourceAccountName: string | null;
  sourceAccountNumber: string | null;
  sourceBankName: string | null;
  sourceBankCode: string | null;
  destinationAccountNumber: string | null;
  destinationAccountName: string | null;
  destinationBankName: string | null;
  destinationBankCode: string | null;
  type: Direction;
  /** CONFIRMED and UNRESOLVED are final. */
  status: TxStatus;
  narration: string | null;
  name: string | null;
  metadata: Metadata;
  createdAt: string;
  updatedAt: string;
}

/** The data of refunds events. */
export interface WebhookRefund {
  event: string;
  reference: string;
  transactionReference: string;
  amount: number;
  currency: Currency;
  status: string;
  reason: string | null;
  customerNote: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

/** The data of invoice.*, static_account.* and transfer.* events. */
export function transactionOf(e: WebhookEvent): WebhookTransaction {
  return e.data as WebhookTransaction;
}

/** The data of refund.* events. */
export function refundOf(e: WebhookEvent): WebhookRefund {
  return e.data as WebhookRefund;
}

const encoder = new TextEncoder();

function toBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === "string" ? encoder.encode(body) : body;
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** The hex HMAC-SHA256 of body keyed by secret. */
export async function computeSignature(body: string | Uint8Array, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), toBytes(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Checks signature against the raw request body in constant time. */
export async function verifySignature(body: string | Uint8Array, signature: string | null | undefined, secret: string): Promise<boolean> {
  const hex = (signature ?? "").trim();
  if (!secret || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return false;
  const sig = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, toBytes(body));
}

/**
 * Verifies the signature over the raw body and parses the v2 envelope.
 * Always pass the unmodified bytes you received, never re-serialised JSON.
 */
export async function constructEvent(body: string | Uint8Array, signature: string | null | undefined, secret: string): Promise<WebhookEvent> {
  if (!(await verifySignature(body, signature, secret))) throw new InvalidSignatureError();
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  let event: WebhookEvent;
  try {
    event = JSON.parse(text) as WebhookEvent;
  } catch (err) {
    throw new Error(`buypower: decode webhook: ${(err as Error).message}`);
  }
  if (event.version !== "2") {
    throw new Error(`buypower: unsupported webhook payload version ${JSON.stringify(event.version)}; subscribe with payloadVersion "2"`);
  }
  return event;
}

/**
 * A fetch-style handler (Request → Response) for Bun, Deno, Cloudflare Workers,
 * Next.js route handlers and anything else built on the Fetch API. It answers 401
 * on a bad signature, 400 with the reason on a bad payload, 500 if fn throws (so
 * the delivery is retried) and 200 otherwise. Keep fn fast; queue heavy work.
 */
export function webhookHandler(secret: string, fn: (event: WebhookEvent) => Promise<void> | void): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response(null, { status: 405 });
    const body = new Uint8Array(await req.arrayBuffer());
    const signature = req.headers.get(SIGNATURE_HEADER) ?? req.headers.get(PANBOX_SIGNATURE_HEADER);
    let event: WebhookEvent;
    try {
      event = await constructEvent(body, signature, secret);
    } catch (err) {
      if (err instanceof InvalidSignatureError) return new Response(null, { status: 401 });
      return new Response((err as Error).message, { status: 400 }); // shows in BuyPower's delivery log
    }
    try {
      await fn(event);
    } catch {
      return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 200 });
  };
}
