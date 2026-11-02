// Quickstart: resolve an account, pay out to it, then reconcile.
//
//   BP_API_KEY=sk_test_... BP_BUSINESS_ID=<id> npm run example:quickstart
//
// In your own project, import from "buypowermfb2-ts" instead of "../src/index.js".
import { BuyPower, BuyPowerError, ErrorCode, fromCollection, ngn } from "../src/index.js";

const client = BuyPower.fromEnv();

// 1. Resolve the beneficiary before sending money.
const acct = await client.banking.resolveAccount("058", "0123456789");
console.log("Paying:", acct.accountName);

// 2. Initiate the transfer with a unique reference.
try {
  const tr = await client.transfers.create({
    source: fromCollection("reserved"),
    destination: { bankCode: acct.bankCode, accountNumber: acct.accountNumber },
    amount: ngn(100),
    narration: "Invoice #4821 payout",
    reference: `payout-${Date.now()}`,
  });
  console.log(`Transfer ${tr.reference} is ${tr.status} (total debit ₦${tr.amount.total.toFixed(2)})`);

  // 3. The transfer is async: confirm the final state from the ledger.
  const tx = await client.transactions.get(tr.reference);
  console.log("Ledger status:", tx.status);
} catch (err) {
  if (err instanceof BuyPowerError && err.code === ErrorCode.Validation) {
    console.error("Fix the request:", err.message);
  } else {
    throw err;
  }
}

// Iterate every reserved account across all pages.
for await (const a of client.reservedAccounts.listAll()) {
  console.log(a.accountNumber, a.accountName);
}
