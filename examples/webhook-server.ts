// Webhook receiver for v2 payloads on a plain Node http server.
//
//   BP_WEBHOOK_SECRET=whsec_... PORT=9990 npm run example:webhooks
//
// On Bun, Deno, Cloudflare Workers or Next.js route handlers, export
// webhookHandler(secret, fn) directly: it is already a Request → Response function.
// In your own project, import from "buypowermfb2-ts" instead of "../src/index.js".
import { createServer } from "node:http";
import { WebhookEventType, refundOf, transactionOf, webhookHandler } from "../src/index.js";

const handle = webhookHandler(process.env.BP_WEBHOOK_SECRET ?? "", (e) => {
  // De-duplicate on e.id: retries of one delivery share it.
  switch (e.type) {
    case WebhookEventType.InvoicePaid:
    case WebhookEventType.StaticAccountTransactionCreated: {
      const tx = transactionOf(e);
      console.log(`collection ${tx.transactionReference}: ₦${tx.settlementAmount.toFixed(2)} settled (${tx.status})`);
      break;
    }
    case WebhookEventType.TransferPaid:
    case WebhookEventType.TransferFailed:
      console.log(`transfer ${transactionOf(e).transactionReference}: ${e.type}`);
      break;
    case WebhookEventType.RefundCompleted:
    case WebhookEventType.RefundPartiallyCompleted:
    case WebhookEventType.RefundFailed: {
      const rf = refundOf(e);
      console.log(`refund ${rf.reference}: ${rf.status}`);
      break;
    }
    default:
      console.log(`ignoring ${e.type}`);
  }
});

const port = Number(process.env.PORT ?? 9990);
createServer(async (req, res) => {
  // Pass the raw bytes through untouched: the signature is over the exact body.
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const out = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : null }));
  res.writeHead(out.status).end(await out.text());
}).listen(port, "127.0.0.1", () => console.log(`listening on 127.0.0.1:${port}`));
