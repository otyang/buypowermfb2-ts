// Tests against the real BuyPower sandbox. They are skipped unless credentials
// are set, so `npm test` stays offline. See "Testing" in the README.
//
//   BP_API_KEY, BP_BUSINESS_ID   sandbox credentials (sk_test_ keys only)
//   BP_SANDBOX_WRITE=1           also create accounts, transfers and refunds
//   BP_WEBHOOK_URL               public URL (e.g. a cloudflared tunnel) that forwards to BP_WEBHOOK_PORT
//   BP_WEBHOOK_SECRET            webhook secret from the dashboard
//   BP_WEBHOOK_PORT              local port for the test receiver (default 9990)

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test, type TestContext } from "node:test";
import { BuyPower, BuyPowerError, ErrorCode, TxStatus, TxType, fromCollection, isNotFound, ngn, transactionOf, webhookHandler, type BankAccount, type WebhookEvent } from "../src/index.js";

const env = process.env;
const apiKey = env.BP_API_KEY ?? "";
const businessId = env.BP_BUSINESS_ID ?? "";

const noCreds = !apiKey || !businessId ? "set BP_API_KEY and BP_BUSINESS_ID to run sandbox tests" : false;
const noWrite = noCreds || (env.BP_SANDBOX_WRITE === "1" ? false : "set BP_SANDBOX_WRITE=1 to run tests that create sandbox data");
const noWebhook =
  noWrite || (env.BP_WEBHOOK_URL && env.BP_WEBHOOK_SECRET ? false : "set BP_WEBHOOK_URL (a tunnel to BP_WEBHOOK_PORT) and BP_WEBHOOK_SECRET to run the webhook test");

function sandboxClient(): BuyPower {
  if (!apiKey.startsWith("sk_test_")) throw new Error("sandbox tests only run with an sk_test_ key");
  return new BuyPower({ apiKey, businessId, environment: "sandbox" });
}

/** Keeps runs from different people and machines apart. */
function uniqueRef(prefix: string): string {
  return `sdk-test-${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Skips when err matches a server issue we have reported, so the test starts
 * passing by itself once BuyPower fixes it. Returns true when it skipped.
 */
function skipKnownIssue(t: TestContext, err: unknown, substr: string, why: string): boolean {
  if (err instanceof Error && err.message.includes(substr)) {
    t.skip(`known sandbox issue: ${why}`);
    return true;
  }
  return false;
}

async function attempt<T>(p: Promise<T>): Promise<[T, undefined] | [undefined, unknown]> {
  try {
    return [await p, undefined];
  } catch (err) {
    return [undefined, err];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("sandbox reads", { skip: noCreds }, () => {
  const c = noCreds ? undefined! : sandboxClient();

  test("listBanks", async () => {
    const banks = await c.banking.listBanks();
    assert.ok(banks.length > 0 && banks[0]?.code);
  });

  test("resolveAccount", async () => {
    const acc = await c.banking.resolveAccount("058", "0123456789");
    assert.ok(acc.accountName);
  });

  test("collections", async () => {
    const accounts = await c.collections.listAccounts();
    assert.ok(accounts.length > 0 && accounts[0]?.accountType, JSON.stringify(accounts));
    const bals = await c.collections.balances();
    assert.ok(bals.length > 0 && bals[0]?.accountNumber, JSON.stringify(bals));
  });

  test("transactions.listAll walks exactly the reported total", async () => {
    const first = await c.transactions.list({ pageSize: 1 });
    assert.ok(first.pagination);
    const pageSize = first.pagination.total > 20 ? 100 : 1; // one item per page exercises paging; keep big accounts fast
    let n = 0;
    for await (const _ of c.transactions.listAll({ pageSize })) n++;
    assert.equal(n, first.pagination.total);
  });

  test("a missing transaction is a 404", async () => {
    const [, err] = await attempt(c.transactions.get(uniqueRef("missing")));
    assert.ok(isNotFound(err), String(err));
  });

  test("lists", async () => {
    await c.reservedAccounts.list();
    await c.invoiceAccounts.list();
    await c.wallets.list();
    await c.refunds.list();
  });

  test("webhook subscriptions", async () => {
    const subs = await c.webhooks.listSubscriptions();
    assert.ok(subs.length > 0);
  });

  test("revenue", async () => {
    const now = new Date();
    const rev = await c.revenue.get({ from: new Date(now.getTime() - 7 * 86_400_000), to: now });
    assert.equal(rev.period.timezone, "Africa/Lagos");
  });
});

async function createReservedAccount(c: BuyPower): Promise<BankAccount> {
  const acct = await c.reservedAccounts.create({ reference: uniqueRef("res"), name: "SDK Test", description: "sdk sandbox test", bvn: "12345678901" });
  assert.ok(acct.accountNumber, JSON.stringify(acct));
  return acct;
}

/**
 * Sends ₦100. The sandbox simulates upstream 502s, so on a 502 it reconciles
 * first and retries once with the same reference, as the docs advise.
 * Returns false when it skipped.
 */
async function sandboxTransfer(t: TestContext, c: BuyPower, reference: string): Promise<boolean> {
  const req = { source: fromCollection("reserved"), destination: { bankCode: "058", accountNumber: "0123456789" }, amount: ngn(100), narration: "sdk sandbox test", reference };
  let [, err] = await attempt(c.transfers.create(req));
  if (err instanceof BuyPowerError && err.code === ErrorCode.Gateway) {
    const [, getErr] = await attempt(c.transactions.get(reference));
    if (isNotFound(getErr)) [, err] = await attempt(c.transfers.create(req));
    else err = getErr; // undefined when the first attempt went through after all
  }
  if (skipKnownIssue(t, err, "Insufficient balance", "the collection balance is empty and simulated payments don't credit it, so transfers can't run on this business")) return false;
  if (err) throw err;
  return true;
}

/** Pays into acct via the sandbox-only /v1 simulator, reached through the internal transport. */
async function simulatePayment(c: BuyPower, acct: BankAccount, transactionReference: string, amount: number): Promise<void> {
  await c["transport"].call({
    method: "POST",
    path: "/v1/webhooks/simulate",
    body: {
      reference: acct.reference,
      destinationAccountNumber: acct.accountNumber,
      bankAccountType: "Normal",
      transactionStatus: TxStatus.Confirmed,
      amount,
      transactionReference,
      sessionId: transactionReference,
      sourceAccountName: "SDK TEST PAYER",
      narration: "sdk sandbox test",
    },
  });
}

async function waitForTransaction(c: BuyPower, reference: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const [, err] = await attempt(c.transactions.get(reference));
    if (!err) return;
    if (!isNotFound(err)) throw err;
    await sleep(2000);
  }
  throw new Error(`transaction ${reference} did not appear within 30s`);
}

describe("sandbox writes", { skip: noWrite }, () => {
  const c = noWrite ? undefined! : sandboxClient();
  let acct: BankAccount;
  before(async () => {
    acct = await createReservedAccount(c);
  });

  test("rename a reserved account", async () => {
    const got = await c.reservedAccounts.rename(acct.reference, "SDK Test Renamed");
    assert.equal(got.accountName, "SDK Test Renamed");
  });

  test("reserved account balance", async (t) => {
    const [, err] = await attempt(c.reservedAccounts.balance(acct.reference));
    if (skipKnownIssue(t, err, "not a wallet account", "balance endpoint rejects reserved accounts")) return;
    if (err) throw err;
  });

  test("invoice account", async () => {
    const inv = await c.invoiceAccounts.create({
      reference: uniqueRef("inv"),
      name: "SDK Invoice",
      email: "sdk-test@example.com",
      description: "sdk sandbox test",
      amount: ngn(1500),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.ok(inv.reference);
  });

  test("wallet", async (t) => {
    const [w, err] = await attempt(c.wallets.create({ reference: uniqueRef("wal"), name: "SDK Wallet", bvn: "12345678901" }));
    if (skipKnownIssue(t, err, "not enabled", "wallets are not enabled for this business")) return;
    if (err) throw err;
    await c.wallets.balance(w!.reference);
  });

  test("transfer and reconcile", async (t) => {
    const ref = uniqueRef("tr");
    if (!(await sandboxTransfer(t, c, ref))) return;
    const tx = await c.transactions.get(ref);
    assert.equal(tx.direction, "OUTFLOW");
    assert.equal(tx.type, TxType.Transfer);
  });

  test("refund own collection", async () => {
    const txRef = uniqueRef("pay");
    await simulatePayment(c, acct, txRef, 2500);
    await waitForTransaction(c, txRef);
    const rf = await c.refunds.create({ transactionReference: txRef, amount: ngn(100), reason: "sdk sandbox test" });
    assert.equal(rf.transactionReference, txRef);
    await c.refunds.get(rf.reference);
  });
});

/**
 * Points the business's sandbox webhook subscriptions at BP_WEBHOOK_URL,
 * triggers a payment and a transfer, and waits for both signed events to reach
 * a local receiver. It leaves the subscriptions pointing there.
 */
describe("sandbox webhooks", { skip: noWebhook }, () => {
  const c = noWebhook ? undefined! : sandboxClient();
  const port = Number(env.BP_WEBHOOK_PORT ?? 9990);
  const events: WebhookEvent[] = [];
  const rejected: number[] = [];
  let server: Server;
  let acct: BankAccount;

  before(async () => {
    const handle = webhookHandler(env.BP_WEBHOOK_SECRET!, (e) => {
      events.push(e);
    });
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : null }));
      if (req.method === "POST" && out.status !== 200) rejected.push(out.status);
      res.writeHead(out.status).end(await out.text());
    });
    // The tunnel forwards to one fixed port, so fail rather than pick another.
    await new Promise<void>((resolve, reject) => {
      server.once("error", (err) => reject(new Error(`port ${port} is busy (stop whatever uses it, or set BP_WEBHOOK_PORT): ${err.message}`)));
      server.listen(port, "127.0.0.1", resolve);
    });
    await c.webhooks.upsertSubscriptions([
      { url: env.BP_WEBHOOK_URL!, topic: "collections" },
      { url: env.BP_WEBHOOK_URL!, topic: "transfers" },
      { url: env.BP_WEBHOOK_URL!, topic: "refunds" },
    ]);
    acct = await createReservedAccount(c);
  });

  after(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function waitForEvent(match: (e: WebhookEvent) => boolean): Promise<WebhookEvent> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const e = events.find(match);
      if (e) return e;
      if (rejected.includes(401)) throw new Error("a delivery failed signature verification: BP_WEBHOOK_SECRET does not match this business");
      if (rejected.length) throw new Error(`a delivery was rejected with HTTP ${rejected[0]}`);
      await sleep(250);
    }
    throw new Error("no matching webhook within 90s: check BP_WEBHOOK_URL forwards to BP_WEBHOOK_PORT");
  }

  test("collection event", async () => {
    const txRef = uniqueRef("whpay");
    await simulatePayment(c, acct, txRef, 2500);
    const e = await waitForEvent((e) => transactionOf(e).transactionReference === txRef);
    const tx = transactionOf(e);
    assert.equal(e.type, "static_account.transaction.created");
    assert.ok(e.id);
    assert.ok(tx.amount > 0);
    assert.equal(tx.type, "INFLOW");
  });

  test("transfer event", async (t) => {
    const ref = uniqueRef("whtr");
    if (!(await sandboxTransfer(t, c, ref))) return;
    const e = await waitForEvent((e) => transactionOf(e).transactionReference === ref);
    assert.match(e.type, /^transfer\./);
  });
});
