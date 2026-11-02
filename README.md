# buypowermfb2-ts

**The BuyPower MFB v2 API SDK for TypeScript and JavaScript.**

[![CI](https://github.com/otyang/buypowermfb2-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/otyang/buypowermfb2-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.3-339933.svg)

A fully typed client for the [BuyPower MFB](https://docs.buypowermfb.net/docs/introduction) payments API. Covers transfers, refunds, virtual accounts, wallets, collections, transactions, revenue and signed webhooks.

> **Also available in Go:** [otyang/buypowermfb2-go](https://github.com/otyang/buypowermfb2-go). Both SDKs share the same design, behaviour and test suite.

> [!CAUTION]
> **This SDK targets version 2 of the BuyPower MFB API only (`/v2/...`).**
>
> It does not support the deprecated `/v1` or `/api` endpoints, the `/admin` endpoints, or webhook payload version 1. If your integration still calls `/v1`, migrate first using BuyPower's [v1 to v2 guide](https://docs.buypowermfb.net/docs/migration/v1-to-v2). Webhook subscriptions must use `payloadVersion: "2"`; this SDK registers them that way by default.

> [!NOTE]
> This is a community SDK. It is not published or supported by BuyPower MFB. For account or API problems, contact BuyPower at developers@buypowermfb.net.

- Zero runtime dependencies: built on the standard `fetch` and Web Crypto APIs
- Runs on Node.js 20.3+, Bun, Deno and Cloudflare Workers
- Strict TypeScript types for every request and response
- ES module with type declarations
- Tested against the live sandbox (see [Testing](#testing))

## Install

The package is not published to npm. Install it straight from GitHub; npm builds it on install:

```sh
npm install github:otyang/buypowermfb2-ts
```

```ts
import { BuyPower, fromCollection, ngn } from "buypowermfb2-ts";
```

## Quick start

```ts
const client = new BuyPower({ apiKey: process.env.BP_API_KEY!, businessId: process.env.BP_BUSINESS_ID! });
// or: BuyPower.fromEnv()
// sk_live_ keys go to https://api.buypowermfb.net, everything else to the sandbox.
// Override with { environment: "live" } or { baseUrl: "..." }.

const acct = await client.banking.resolveAccount("058", "0123456789");

const tr = await client.transfers.create({
  source: fromCollection("reserved"), // or fromWallet("9006990538")
  destination: { bankCode: "058", accountNumber: "0123456789" },
  amount: ngn(5000), // naira, not kobo
  reference: "payout-4821", // your idempotent reference
});

for await (const tx of client.transactions.listAll()) { ... } // walks every page
```

Every method takes an optional last argument `{ signal, idempotencyKey, requestId, headers }`. Use `signal` with an `AbortController` to cancel a call.

Runnable programs are in [examples/](examples): `npm run example:quickstart` and `npm run example:webhooks`.

## Endpoints

| Service | Methods | Endpoint |
|---|---|---|
| `transfers` | `create` | `POST /v2/transfers` |
| `refunds` | `create` / `list` / `listAll` / `get` | `POST /v2/refunds`, `GET /v2/refunds`, `GET /v2/refunds/{ref}` |
| `banking` | `listBanks` / `resolveAccount` | `GET /v2/banking/banks`, `GET /v2/banking/accounts/resolve` |
| `reservedAccounts` | `create` / `list` / `listAll` / `balance` / `rename` | `/v2/accounts/reserved[/{ref}[/balance]]` |
| `invoiceAccounts` | `create` / `list` / `listAll` | `/v2/accounts/invoices` |
| `wallets` | `create` / `list` / `listAll` / `get` / `balance` | `/v2/wallets[/{ref}[/balance]]` |
| `collections` | `listAccounts` / `balances` | `GET /v2/collections/accounts`, `GET /v2/collections/balances` |
| `transactions` | `list` / `listAll` / `get` | `GET /v2/transactions[/{ref}]` |
| `webhooks` | `listSubscriptions` / `upsertSubscriptions` | `GET`/`PUT /v2/webhooks/subscriptions` |
| `revenue` | `get` | `GET /v2/revenue` |

`GET /v2/collections/wallets` is left out because it is a deprecated alias of `GET /v2/wallets`.

Revenue dates are read in Lagos time (Africa/Lagos), whatever time zone the `Date` carries. A `"YYYY-MM-DD"` string is sent as is.

## Errors

Non-2xx responses throw a `BuyPowerError` with `status`, `code` (`validation-error`, `conflict-error`, `gateway-error`, …), `message`, field-level `errors` and `requestId`.

```ts
try {
  await client.transfers.create(req);
} catch (err) {
  if (err instanceof BuyPowerError && err.code === ErrorCode.Validation) { /* fix the request */ }
  if (isNotFound(err)) { ... }
}
```

## Retries and idempotency

Network errors, timeouts, 429 and 5xx responses are retried with exponential backoff and jitter. The default is 2 retries; change it with `maxRetries`. Each attempt times out after 30 seconds (`timeoutMs`). Retries happen only when they can't move money twice:

- `GET` requests, the subscription upsert, and account renames are always retried.
- `reservedAccounts.create`, `invoiceAccounts.create` and `wallets.create` are retried only when `reference` is set.
- `transfers.create` is never retried. After a timeout or a 502 the money may still move, so check `transactions.get(reference)` first, then retry yourself with the same `reference`.
- `refunds.create` sends an `Idempotency-Key` that it generates once per call and reuses on retries. To keep the same key across process restarts, pass your own: `refunds.create(req, { idempotencyKey })`.

A call cancelled through its `signal` is never retried. Transfers and refunds are asynchronous: confirm the final state with `transactions.get` or a webhook.

## Transfer statuses

> [!IMPORTANT]
> A transfer's `status` uses the upper-case **transaction** statuses, not the lower-case `pending` / `paid` / `failed` from BuyPower's [Transfers guide](https://docs.buypowermfb.net/docs/guides/transfers). Code that checks for `"paid"` never matches, and a finished payout is never marked as paid.

In the sandbox, a new transfer comes back as `AUTHORIZED` and later shows `CONFIRMED` in `transactions.get`. Those values come from the [transaction status list](https://docs.buypowermfb.net/docs/guides/transactions): `PENDING`, `AUTHORIZED`, `SUBMITTED`, `CONFIRMED`, `UNRESOLVED`, `REJECTED`, `REFUND_INITIATED`, `REFUNDED`, `REFUNDED_PARTIALLY`.

Compare against the `TxStatus` constants:

```ts
switch (tr.status) {
  case TxStatus.Confirmed: // money delivered (final)
    break;
  case TxStatus.Unresolved:
  case TxStatus.Rejected: // failed (final)
    break;
  default: // PENDING, AUTHORIZED, SUBMITTED: still in flight, wait for the webhook
}
```

| Transfers guide | Status you actually get | Webhook event |
|---|---|---|
| `pending` | `PENDING`, `AUTHORIZED`, `SUBMITTED` | `transfer.pending` |
| `paid` | `CONFIRMED` | `transfer.paid` |
| `failed` | `UNRESOLVED`, `REJECTED` | `transfer.failed` |

Webhook event names keep the guide's words: a transfer that ends `CONFIRMED` arrives as a `transfer.paid` event.

`AUTHORIZED` and `CONFIRMED` were seen in the sandbox. Mapping `UNRESOLVED` and `REJECTED` to a failure follows BuyPower's docs, which call `CONFIRMED` and `UNRESOLVED` final; a failed transfer has not yet been observed.

## Webhooks

`webhookHandler(secret, fn)` returns a standard `Request → Response` function. Use it directly on Bun, Deno, Cloudflare Workers and Next.js route handlers:

```ts
import { WebhookEventType, refundOf, transactionOf, webhookHandler } from "buypowermfb2-ts";

export const POST = webhookHandler(process.env.BP_WEBHOOK_SECRET!, async (e) => {
  switch (e.type) {
    case WebhookEventType.TransferPaid:
      const tx = transactionOf(e);
      ...
      break;
    case WebhookEventType.RefundCompleted:
      const rf = refundOf(e);
      ...
  }
  // throw → 500 → BuyPower redelivers
});
```

On a plain Node `http` or Express server, read the **raw** body and call `constructEvent` yourself, or adapt the request as [examples/webhook-server.ts](examples/webhook-server.ts) does:

```ts
const event = await constructEvent(rawBody, req.headers["x-buypower-signature"], secret);
```

The signature is an HMAC-SHA256 over the exact bytes received, checked in constant time. Parsing the JSON and re-serialising it breaks the check, so with Express use `express.raw({ type: "application/json" })` on the webhook route. Retries of one delivery share the same `event.id`, so de-duplicate on it.

`upsertSubscriptions` defaults to `payloadVersion: "2"` and returns nothing. Read the result back with `listSubscriptions`, because the server's upsert reply echoes your webhook secret.

## Testing

There are three levels of tests. Each person uses their own sandbox credentials through environment variables; never commit them.

| Level | Needs | Changes sandbox data | Command |
|---|---|---|---|
| Offline | Node.js only | No | `npm test` |
| Sandbox reads | Sandbox API key and business ID | No | `npm run test:sandbox` |
| Sandbox writes | The above, plus `BP_SANDBOX_WRITE=1` | Yes | `BP_SANDBOX_WRITE=1 npm run test:sandbox` |
| Webhooks | The above, plus a public tunnel and your webhook secret | Yes, and repoints your webhook subscriptions | see [Webhook test](#webhook-test) |

First install the dev dependencies (TypeScript and Node's type definitions):

```sh
npm install
```

### Offline tests

```sh
npm test
```

These use a fake `fetch`, so they need no credentials and no network. CI runs them on Node 20 and 22 for every push and pull request.

### Sandbox tests

These run against the real BuyPower sandbox. They are skipped unless `BP_API_KEY` and `BP_BUSINESS_ID` are set, and they refuse anything other than an `sk_test_` key, so they can't touch live money.

```sh
export BP_API_KEY=sk_test_...          # the API key only, without the ":businessId" part
export BP_BUSINESS_ID=<your-business-id>

# Read-only checks: change nothing on the account
npm run test:sandbox

# Also create a reserved account, an invoice, a ₦100 transfer and a refund
BP_SANDBOX_WRITE=1 npm run test:sandbox
```

Every run uses fresh references, so runs by different people never clash.

Known sandbox problems show as `SKIP` with the reason instead of failing:
- wallets not enabled for the business;
- the reserved-account balance endpoint answering "This is not a wallet account";
- an empty collection balance refusing the test transfer.

These tests start passing by themselves once the sandbox is fixed or the account is set up.

### Webhook test

This test makes the sandbox send real signed webhooks to your machine and checks they arrive and verify. It needs a public URL that forwards to a local port.

1. Start a tunnel to the test port (default `9990`) and copy the `https://….trycloudflare.com` URL it prints:
   ```sh
   cloudflared tunnel --url http://localhost:9990
   ```
2. Run the test with the tunnel URL and your webhook secret (dashboard, **API Keys** tab):
   ```sh
   BP_SANDBOX_WRITE=1 \
   BP_WEBHOOK_URL=https://<your-tunnel>.trycloudflare.com/webhooks/buypower \
   BP_WEBHOOK_SECRET=whsec_test_... \
   npm run test:sandbox
   ```

What it does:
- It listens on `BP_WEBHOOK_PORT` (default `9990`). Nothing else may use that port while it runs.
- It **points your sandbox webhook subscriptions** (collections, transfers, refunds) at `BP_WEBHOOK_URL` and leaves them there.
- It sends a test payment and a ₦100 transfer, then waits up to 90 seconds for each signed event.

A wrong secret fails with a clear message.

To watch events by hand instead, run the example receiver on the same port:

```sh
BP_WEBHOOK_SECRET=whsec_test_... PORT=9990 npm run example:webhooks
```

### Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `BP_API_KEY` | sandbox tests, examples | Sandbox API key (`sk_test_…`) |
| `BP_BUSINESS_ID` | sandbox tests, examples | Your numeric business ID |
| `BP_SANDBOX_WRITE` | sandbox tests | Set to `1` to allow tests that create data |
| `BP_WEBHOOK_URL` | webhook test | Public URL that forwards to `BP_WEBHOOK_PORT` |
| `BP_WEBHOOK_SECRET` | webhook test, webhook example | Webhook secret (`whsec_…`) |
| `BP_WEBHOOK_PORT` | webhook test | Local port for the test receiver (default `9990`) |
| `PORT` | webhook example | Local port for the example receiver (default `9990`) |

## Where the API differs from its spec

Checked against the sandbox on 2 November 2026:

- List endpoints return arrays, even where `openapi.json` declares a single object. The SDK accepts either.
- Collection accounts and balances use `accountType` and a nested `balance.balance`, not the spec's `type` and `available`. The SDK follows the server.
- Transfer `status` uses the transaction statuses (`AUTHORIZED`, `CONFIRMED`, …), not the docs' `pending`/`paid`/`failed`. See [Transfer statuses](#transfer-statuses).
- Validation errors list the bad fields inside `message`. The `errors` array is not sent.
- Insufficient balance on a transfer returns 502 `gateway-error`, not the documented 422 `conflict-error`.
- `reservedAccounts.balance` returns `unknown` because the spec doesn't type it. On the sandbox it currently fails with "This is not a wallet account", which is a server bug.

## Other languages

- **Go:** [otyang/buypowermfb2-go](https://github.com/otyang/buypowermfb2-go)

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run:

```sh
npm run build
npm test
```

If your change touches request or response shapes, also run the [sandbox tests](#sandbox-tests) with your own sandbox credentials. Changes in behaviour should land in the [Go SDK](https://github.com/otyang/buypowermfb2-go) too, so the two stay in step.

## Contributors

- [@otyang](https://github.com/otyang): creator and maintainer

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Otyang.
