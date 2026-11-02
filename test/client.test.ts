import assert from "node:assert/strict";
import { test } from "node:test";
import { BuyPower, BuyPowerError, ErrorCode, LIVE_URL, SANDBOX_URL, TxStatus, fromCollection, ngn } from "../src/index.js";

type Handler = (req: Request) => Response | Promise<Response>;

function fakeClient(handler: Handler): BuyPower {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init));
  const c = new BuyPower({ apiKey: "sk_test_abc", businessId: "4827", baseUrl: "https://bp.test", fetch: fetchImpl as typeof fetch });
  c["transport"].retryBaseMs = 1;
  return c;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ok = (data: unknown, meta?: unknown) => json(200, { status: "success", message: "ok", data, ...(meta ? { meta } : {}) });

test("base URL is inferred from the key prefix", () => {
  assert.equal(new BuyPower({ apiKey: "sk_live_x", businessId: 1 }).baseUrl, LIVE_URL);
  assert.equal(new BuyPower({ apiKey: "sk_test_x", businessId: 1 }).baseUrl, SANDBOX_URL);
  assert.equal(new BuyPower({ apiKey: "sk_live_x", businessId: 1, environment: "sandbox" }).baseUrl, SANDBOX_URL);
});

test("transfers.create sends the documented body and auth header", async () => {
  const c = fakeClient(async (req) => {
    assert.equal(req.method, "POST");
    assert.equal(new URL(req.url).pathname, "/v2/transfers");
    assert.equal(req.headers.get("authorization"), "Bearer sk_test_abc:4827");
    assert.equal(
      await req.text(),
      '{"source":{"type":"collection","balance":"reserved"},"destination":{"bankCode":"058","accountNumber":"0123456789"},"amount":{"value":5000,"currency":"NGN"},"reference":"payout-1"}',
    );
    return ok({ reference: "payout-1", status: "AUTHORIZED", amount: { value: 5000, transactionFee: 0, total: 5000, currency: "NGN" }, destination: { accountNumber: "0123456789", accountName: "JANE DOE" } });
  });
  const tr = await c.transfers.create({
    source: fromCollection("reserved"),
    destination: { bankCode: "058", accountNumber: "0123456789" },
    amount: ngn(5000),
    reference: "payout-1",
  });
  assert.equal(tr.status, TxStatus.Authorized);
  assert.equal(tr.destination.accountName, "JANE DOE");
  assert.equal(tr.amount.total, 5000);
});

test("transactions.listAll walks every page", async () => {
  const c = fakeClient((req) => {
    const q = new URL(req.url).searchParams;
    assert.equal(q.get("pageSize"), "100");
    const page = Number(q.get("page"));
    return ok(
      [{ reference: `TX-${page}`, type: "COLLECTION", status: "CONFIRMED", amount: { value: 1, fee: null, currency: "NGN" } }],
      { pagination: { page, perPage: 100, total: 3, totalPages: 3 } },
    );
  });
  const refs: string[] = [];
  for await (const tx of c.transactions.listAll()) {
    assert.equal(tx.amount.fee, null);
    refs.push(tx.reference);
  }
  assert.deepEqual(refs, ["TX-1", "TX-2", "TX-3"]);
});

test("list endpoints accept a single object (shape observed on the sandbox)", async () => {
  const c = fakeClient(() =>
    ok({ accountNumber: "9716988283", accountType: "collection.static", currency: "NGN", balance: { balance: 152000, blockedAmount: 0 } }),
  );
  const bals = await c.collections.balances();
  assert.equal(bals.length, 1);
  assert.equal(bals[0]?.balance.balance, 152000);
  assert.equal(bals[0]?.accountType, "collection.static");
});

test("banking.resolveAccount sends the query", async () => {
  const c = fakeClient((req) => {
    assert.equal(new URL(req.url).search, "?bankCode=058&accountNumber=0123456789");
    return ok({ accountNumber: "0123456789", accountName: "JANE DOE", bankCode: "058" });
  });
  const acc = await c.banking.resolveAccount("058", "0123456789");
  assert.equal(acc.accountName, "JANE DOE");
});

test("a 400 becomes a BuyPowerError and is not retried", async () => {
  let calls = 0;
  const c = fakeClient(() => {
    calls++;
    return json(400, { status: "validation-error", message: "bad", errors: [{ field: "amount.value", message: "must be >= 1" }] }, { "x-request-id": "req_1" });
  });
  await assert.rejects(c.transactions.get("TX-1"), (err: unknown) => {
    assert.ok(err instanceof BuyPowerError);
    assert.equal(err.code, ErrorCode.Validation);
    assert.equal(err.requestId, "req_1");
    assert.equal(err.errors[0]?.field, "amount.value");
    return true;
  });
  assert.equal(calls, 1);
});

test("GET is retried on 5xx", async () => {
  let calls = 0;
  const c = fakeClient(() => (++calls < 3 ? json(502, { status: "gateway-error", message: "upstream" }) : ok([{ code: "058", name: "GTBank" }])));
  const banks = await c.banking.listBanks();
  assert.equal(banks.length, 1);
  assert.equal(calls, 3);
});

test("GET is retried on a network error", async () => {
  let calls = 0;
  const c = fakeClient(() => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return ok([]);
  });
  await c.banking.listBanks();
  assert.equal(calls, 2);
});

test("a transfer is never retried, even with a reference", async () => {
  let calls = 0;
  const c = fakeClient(() => {
    calls++;
    return json(502, { status: "gateway-error", message: "upstream" });
  });
  await assert.rejects(c.transfers.create({ source: fromCollection("reserved"), destination: { bankCode: "058", accountNumber: "1" }, amount: ngn(1), reference: "payout-1" }));
  assert.equal(calls, 1);
});

test("a cancelled call is not retried", async () => {
  let calls = 0;
  const ctrl = new AbortController();
  const c = fakeClient(() => {
    calls++;
    ctrl.abort();
    return json(500, { status: "server-error", message: "boom" });
  });
  await assert.rejects(c.banking.listBanks({ signal: ctrl.signal }));
  assert.equal(calls, 1);
});

test("refund retries reuse the same Idempotency-Key", async () => {
  const keys: (string | null)[] = [];
  const c = fakeClient((req) => {
    keys.push(req.headers.get("idempotency-key"));
    if (keys.length === 1) return json(500, { status: "server-error", message: "boom" });
    return json(202, { status: "success", message: "ok", data: { reference: "RF-1", transactionReference: "TX-1", status: "processing" } });
  });
  const rf = await c.refunds.create({ transactionReference: "TX-1", amount: ngn(100), reason: "returned" });
  assert.equal(rf.reference, "RF-1");
  assert.equal(keys.length, 2);
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
});

test("refunds.list pages with size", async () => {
  const c = fakeClient((req) => {
    assert.equal(new URL(req.url).search, "?page=2&size=20&status=completed");
    return ok([]);
  });
  await c.refunds.list({ page: 2, size: 20, status: "completed" });
});

test("upsertSubscriptions defaults to payload v2 and ignores the raw reply", async () => {
  const c = fakeClient(async (req) => {
    assert.equal(req.method, "PUT");
    assert.equal(await req.text(), '[{"url":"https://x.test/wh","topic":"collections","payloadVersion":"2"}]');
    // Shape observed on the sandbox: [[row, created], ...].
    return ok([[{ webhookUrl: "https://x.test/wh", topic: "collections" }, false]]);
  });
  await c.webhooks.upsertSubscriptions([{ url: "https://x.test/wh", topic: "collections" }]);
});

test("revenue dates are sent in Lagos time", async () => {
  const c = fakeClient((req) => {
    assert.equal(new URL(req.url).search, "?from=2026-06-01&to=2026-07-01");
    return ok({ totalRevenue: 250 });
  });
  const rev = await c.revenue.get({
    from: new Date("2026-06-01T00:00:00Z"),
    to: new Date("2026-06-30T23:30:00Z"), // 00:30 on 1 July in Lagos
  });
  assert.equal(rev.totalRevenue, 250);
});

test("backoff is capped for large retry counts", () => {
  const t = new BuyPower({ apiKey: "sk_test_x", businessId: 1 })["transport"];
  for (const attempt of [0, 10, 40, 100]) {
    const d = t["backoff"](attempt, new Error("x"));
    assert.ok(d > 0 && d <= 40_000, `attempt ${attempt}: ${d}`);
  }
});
