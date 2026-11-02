import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidSignatureError, PANBOX_SIGNATURE_HEADER, SIGNATURE_HEADER, WebhookEventType, computeSignature, constructEvent, transactionOf, webhookHandler } from "../src/index.js";

const secret = "whsec_test";
const transferPaid =
  '{"id":"evt_1","type":"transfer.paid","version":"2","created":"2026-06-21T10:15:42.000Z","data":{"transactionId":88231,"transactionReference":"payout-4821","amount":15000,"stampDuty":50,"transactionFee":25,"totalAmount":15075,"transactionType":"payout","type":"OUTFLOW","status":"CONFIRMED"}}';

function delivery(body: string, headers: Record<string, string>, method = "POST"): Request {
  return new Request("https://me.test/wh", { method, headers, body: method === "POST" ? body : null });
}

test("constructEvent verifies and parses a v2 event", async () => {
  const e = await constructEvent(transferPaid, await computeSignature(transferPaid, secret), secret);
  const tx = transactionOf(e);
  assert.equal(e.type, WebhookEventType.TransferPaid);
  assert.equal(tx.totalAmount, 15075);
  assert.equal(tx.type, "OUTFLOW");
});

test("constructEvent rejects a wrong secret and a tampered body", async () => {
  await assert.rejects(constructEvent(transferPaid, await computeSignature(transferPaid, "wrong"), secret), InvalidSignatureError);
  const tampered = transferPaid.replace("15000", "99999");
  await assert.rejects(constructEvent(tampered, await computeSignature(transferPaid, secret), secret), InvalidSignatureError);
  await assert.rejects(constructEvent(transferPaid, "deadbeef", secret), InvalidSignatureError);
  await assert.rejects(constructEvent(transferPaid, await computeSignature(transferPaid, secret), ""), InvalidSignatureError, "an empty secret must never verify");
});

test("constructEvent rejects v1 payloads", async () => {
  const v1 = '{"event":"transfer.paid","data":{}}';
  await assert.rejects(constructEvent(v1, await computeSignature(v1, secret), secret), /payloadVersion "2"/);
});

test("webhookHandler answers 200, 500, 401, 400 and 405", async () => {
  let got = "";
  const h = webhookHandler(secret, (e) => {
    got = e.id;
  });
  const sig = await computeSignature(transferPaid, secret);

  let res = await h(delivery(transferPaid, { [PANBOX_SIGNATURE_HEADER]: sig }));
  assert.equal(res.status, 200);
  assert.equal(got, "evt_1");

  const failing = webhookHandler(secret, () => {
    throw new Error("db down");
  });
  res = await failing(delivery(transferPaid, { [SIGNATURE_HEADER]: sig }));
  assert.equal(res.status, 500, "a handler error must answer 500 so BuyPower redelivers");

  res = await h(delivery(transferPaid, { [SIGNATURE_HEADER]: "deadbeef" }));
  assert.equal(res.status, 401);

  const v1 = '{"event":"transfer.paid","data":{}}';
  res = await h(delivery(v1, { [SIGNATURE_HEADER]: await computeSignature(v1, secret) }));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /payloadVersion/);

  res = await h(delivery("", {}, "GET"));
  assert.equal(res.status, 405);
});
