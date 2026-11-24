import { ENV } from "./env.js"; // must be first: loads .env
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { Memo, Operation } from "@stellar/stellar-sdk";
import {
  ACCOUNT_NAMES,
  AmountError,
  ASSET_FOR_FIAT,
  Big,
  COMPLIANCE,
  DEFAULT_SLIPPAGE_BPS,
  EXPLORER_BASE,
  NoPathError,
  QUOTE_TTL_SEC,
  StellarTxError,
  TRADITIONAL,
  XLM_USD_REFERENCE,
  assetOf,
  getFx,
  getQuote,
  keypair,
  loadAccountOrNull,
  loadAccounts,
  newTransferId,
  parseAmount,
  POOLS,
  poolStatus,
  rebalanceAll,
  server as horizon,
  submitOps,
  type AccountName,
  type AssetCode,
  type Quote,
} from "@remit/shared";
import { db, DB_PATH } from "./db.js";
import { setAuthorized, trustlines } from "./chain.js";
import { KYC_DENY_NAMES, PERSONAS, personaById, seedDb } from "./personas.js";
import { getRow, recentRows, toView } from "./repo.js";
import {
  HttpError,
  approveFlagged,
  createTransfer,
  expireStaleReviews,
  isSanctioned,
  kycPassed,
  rejectFlagged,
  resumeInFlight,
  runBatch,
  runSingle,
} from "./service.js";
import { broadcast, sseClientCount, sseHandler } from "./sse.js";
import { startWatcher, watcherState } from "./watcher.js";

const book = loadAccounts();
seedDb(book);

const app = Fastify({ logger: { level: "info", redact: ["req.headers['x-admin-token']"] } });
await app.register(cors, { origin: ENV.WEB_ORIGINS, methods: ["GET", "POST"] });

// ---------------- helpers ----------------

const SendAsset = z.enum(["tUSDC", "tAED"]);
const SenderId = z.enum(ACCOUNT_NAMES).refine((id) => !!personaById(id), "Not a sender account");
const RecipientSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    upiId: z.string().trim().regex(/^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/, "Invalid UPI ID").optional(),
    bankAcct: z.string().trim().regex(/^\d{9,18}$/, "Invalid bank account").optional(),
  })
  .refine((r) => r.upiId || r.bankAcct, "UPI ID or bank account required");

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "VALIDATION");
  return r.data;
}

function requireAdmin(req: FastifyRequest) {
  if (req.headers["x-admin-token"] !== ENV.ADMIN_TOKEN) throw new HttpError(401, "Admin token required", "UNAUTHORIZED");
}

app.setErrorHandler((err: unknown, _req, reply: FastifyReply) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
  if (err instanceof AmountError) return reply.status(400).send({ error: err.message, code: "BAD_AMOUNT" });
  if (err instanceof NoPathError) return reply.status(422).send({ error: err.message, code: "NO_PATH" });
  if (err instanceof StellarTxError) return reply.status(422).send({ error: err.friendly, code: err.primaryCode, raw: err.codes });
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 429) return reply.status(503).send({ error: "Stellar network is rate limiting us; retry in a few seconds.", code: "RATE_LIMITED" });
  if (status === 404) return reply.status(503).send({ error: "Account not found on testnet — run `npm run bootstrap`.", code: "NEEDS_BOOTSTRAP" });
  app.log.error(err);
  return reply.status(500).send({ error: "Internal error", code: "INTERNAL" });
});

// Quotes: kept server-side; the client only holds the id. Short cache to spare Horizon's rate limits.
const quotes = new Map<string, Quote>();
const quoteCache = new Map<string, { at: number; q: Quote }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, q] of quotes) if (q.expiresAt + 60_000 < now) quotes.delete(id);
  for (const [k, v] of quoteCache) if (now - v.at > 5000) quoteCache.delete(k);
  expireStaleReviews();
}, 10_000).unref();

// Mock market maker: keep AMM pools at the FX mid (demo traffic only flows one way).
let lastRebalance: { at: number; result: string[] } | undefined;
let rebalancing = false;
async function rebalance(thresholdPct = 0.25) {
  if (rebalancing) return lastRebalance?.result ?? [];
  rebalancing = true;
  try {
    const result = await rebalanceAll(book, await getFx(), thresholdPct);
    lastRebalance = { at: Date.now(), result };
    if (result.some((r) => r.includes("rebalanced"))) app.log.info({ result }, "market maker rebalanced pools");
    return result;
  } finally {
    rebalancing = false;
  }
}
setInterval(() => rebalance().catch((e) => app.log.warn(`rebalance failed: ${(e as Error).message}`)), 60_000).unref();

async function quoteFor(sendAsset: AssetCode, sendAmount: string, slippageBps: number): Promise<Quote> {
  const key = `${sendAsset}:${sendAmount}:${slippageBps}`;
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < 5000) {
    const q: Quote = { ...hit.q, quoteId: `${hit.q.quoteId}c${Math.random().toString(36).slice(2, 5)}`, expiresAt: hit.q.expiresAt };
    quotes.set(q.quoteId, q);
    return q;
  }
  const q = await getQuote(book, sendAsset, sendAmount, "tINR", slippageBps);
  quotes.set(q.quoteId, q);
  quoteCache.set(key, { at: Date.now(), q });
  return q;
}

// ---------------- public ----------------

app.get("/events", sseHandler);

app.get("/config", async () => ({
  explorer: EXPLORER_BASE,
  traditional: TRADITIONAL,
  compliance: COMPLIANCE,
  quoteTtlSec: QUOTE_TTL_SEC,
  xlmUsdReference: XLM_USD_REFERENCE,
  anchorRecv: book.ANCHOR_RECV.publicKey,
}));

let healthCache: { at: number; body: unknown } | undefined;
app.get("/health", async () => {
  if (healthCache && Date.now() - healthCache.at < 5000) return healthCache.body;
  let horizonOk = false;
  let latestLedger: number | undefined;
  try {
    const l = await horizon.ledgers().order("desc").limit(1).call();
    latestLedger = l.records[0]?.sequence;
    horizonOk = true;
  } catch {
    /* unreachable */
  }
  const critical: AccountName[] = ["ISSUER_USD", "ISSUER_INR", "ISSUER_AED", "ANCHOR_SEND", "ANCHOR_RECV", "MARKET_MAKER"];
  const missing: string[] = [];
  if (horizonOk) for (const n of critical) if (!(await loadAccountOrNull(book[n].publicKey))) missing.push(n);
  const fx = await getFx();
  const pools = horizonOk && !missing.length ? (await Promise.all(POOLS.map((p) => poolStatus(book, p, fx)))).filter(Boolean) : [];
  const body = {
    ok: horizonOk && missing.length === 0 && watcherState.connected,
    pools,
    lastRebalance,
    horizon: { reachable: horizonOk, latestLedger },
    needsBootstrap: missing.length > 0,
    missingAccounts: missing,
    watcher: { ...watcherState },
    fx,
    sseClients: sseClientCount(),
    db: DB_PATH,
  };
  healthCache = { at: Date.now(), body };
  return body;
});

let sendersCache: { at: number; body: unknown } | undefined;
export function invalidateSenders() {
  sendersCache = undefined;
}
app.get("/senders", async () => {
  if (sendersCache && Date.now() - sendersCache.at < 2000) return sendersCache.body;
  const body = await Promise.all(
    PERSONAS.map(async (p) => {
      const pub = book[p.id].publicKey;
      const lines = await trustlines(book, pub, ["tUSDC", "tAED"]);
      const bank = db.prepare("SELECT currency, balance FROM bank WHERE account_id = ?").get(p.id) as { currency: string; balance: string };
      return {
        id: p.id,
        name: p.name,
        city: p.city,
        note: p.note,
        publicKey: pub,
        kyc: kycPassed(pub) ? "PASSED" : "NOT_VERIFIED",
        sanctioned: isSanctioned(pub),
        balances: Object.fromEntries(
          Object.entries(lines).map(([code, l]) => [code, { balance: l.balance, authorized: l.authorized, trustline: l.exists, frozen: l.exists && !l.authorized && new Big(l.balance).gt(0) }]),
        ),
        bank,
        defaultAsset: p.sendAssets[0],
      };
    }),
  );
  sendersCache = { at: Date.now(), body };
  return body;
});

app.post("/kyc/verify", async (req) => {
  const body = parse(z.object({ publicKey: z.string().length(56), name: z.string().trim().min(2).max(80) }), req.body);
  const p = PERSONAS.find((x) => book[x.id].publicKey === body.publicKey);
  if (!p) throw new HttpError(404, "Unknown wallet");
  // Mock KYC provider: passes unless the name or key is on the deny list.
  if (KYC_DENY_NAMES.includes(body.name.toLowerCase()) || isSanctioned(body.publicKey)) {
    db.prepare("INSERT INTO kyc (public_key, name, status, at) VALUES (?, ?, 'REJECTED', ?) ON CONFLICT(public_key) DO UPDATE SET status = 'REJECTED', at = excluded.at").run(body.publicKey, body.name, Date.now());
    invalidateSenders();
    throw new HttpError(403, "KYC rejected by verification provider (watchlist match)", "KYC_REJECTED");
  }
  db.prepare("INSERT INTO kyc (public_key, name, status, at) VALUES (?, ?, 'PASSED', ?) ON CONFLICT(public_key) DO UPDATE SET status = 'PASSED', name = excluded.name, at = excluded.at").run(body.publicKey, body.name, Date.now());
  const authorized = await setAuthorized(book, body.publicKey, ["tUSDC", "tAED"], true);
  invalidateSenders();
  broadcast("senders", {});
  return { status: "PASSED", authorizedOnChain: authorized };
});

app.post("/deposit", async (req) => {
  const body = parse(z.object({ senderId: SenderId, fiatAmount: z.union([z.string(), z.number()]), fiatCurrency: z.enum(["USD", "AED"]) }), req.body);
  const amount = parseAmount(body.fiatAmount);
  const pub = book[body.senderId].publicKey;
  if (!kycPassed(pub)) throw new HttpError(403, "Complete KYC before adding money", "KYC_REQUIRED");
  const asset = ASSET_FOR_FIAT[body.fiatCurrency];
  const lines = await trustlines(book, pub, [asset]);
  if (!lines[asset].authorized) throw new HttpError(403, "Wallet is frozen or not authorized for this currency", "NOT_AUTHORIZED");
  const bank = db.prepare("SELECT currency, balance FROM bank WHERE account_id = ?").get(body.senderId) as { currency: string; balance: string };
  // Mock FX at the bank if the deposit currency differs from the bank account currency.
  const fx = await getFx();
  const debit = bank.currency === body.fiatCurrency ? new Big(amount) : body.fiatCurrency === "USD" ? new Big(amount).times(fx.aedPerUsd) : new Big(amount).div(fx.aedPerUsd);
  if (debit.gt(bank.balance)) throw new HttpError(400, `Insufficient mock bank balance (${bank.currency} ${new Big(bank.balance).toFixed(2)})`, "BANK_INSUFFICIENT");

  // Debit first (conditional update guards against concurrent deposits), credit back on failure.
  const res = db.prepare("UPDATE bank SET balance = ? WHERE account_id = ? AND balance = ?").run(new Big(bank.balance).minus(debit).toFixed(7), body.senderId, bank.balance);
  if (Number(res.changes) !== 1) throw new HttpError(409, "Concurrent deposit, retry", "CONFLICT");
  try {
    const r = await submitOps(keypair(book, "ANCHOR_SEND"), [Operation.payment({ destination: pub, asset: assetOf(book, asset), amount })]);
    invalidateSenders();
    broadcast("senders", {});
    return { txHash: r.hash, asset, amount, bankDebited: `${bank.currency} ${debit.toFixed(2)}` };
  } catch (e) {
    const cur = db.prepare("SELECT balance FROM bank WHERE account_id = ?").get(body.senderId) as { balance: string };
    db.prepare("UPDATE bank SET balance = ? WHERE account_id = ?").run(new Big(cur.balance).plus(debit).toFixed(7), body.senderId);
    throw e;
  }
});

app.get("/quote", async (req) => {
  const q = parse(
    z.object({ sendAsset: SendAsset, sendAmount: z.string(), destAsset: z.literal("tINR").default("tINR"), slippageBps: z.coerce.number().int().min(10).max(500).default(DEFAULT_SLIPPAGE_BPS) }),
    req.query,
  );
  return quoteFor(q.sendAsset, parseAmount(q.sendAmount), q.slippageBps);
});

app.post("/transfer", async (req, reply) => {
  const body = parse(
    z.object({ quoteId: z.string(), senderId: SenderId, recipient: RecipientSchema, purpose: z.string().trim().max(60).default("Family support") }),
    req.body,
  );
  const quote = quotes.get(body.quoteId);
  if (!quote) throw new HttpError(409, "Quote not found or expired. Please refresh the quote.", "QUOTE_EXPIRED");
  if (Date.now() > quote.expiresAt) throw new HttpError(409, "Quote expired. Please review the refreshed quote.", "QUOTE_EXPIRED");
  quotes.delete(body.quoteId); // single use

  const pub = book[body.senderId].publicKey;
  const lines = await trustlines(book, pub, [quote.sendAsset]);
  if (new Big(quote.sendAmount).gt(lines[quote.sendAsset].balance) && lines[quote.sendAsset].authorized)
    throw new HttpError(400, `Insufficient balance: you have ${new Big(lines[quote.sendAsset].balance).toFixed(2)} ${quote.sendAsset}`, "INSUFFICIENT_BALANCE");

  const row = await createTransfer(book, { quote, senderId: body.senderId, recipient: body.recipient, purpose: body.purpose });
  const decision = await runSingle(book, row);
  invalidateSenders();
  return reply.status(201).send({ transferId: row.id, status: decision, transfer: toView(getRow(row.id)!) });
});

/** Micro-remittances: N small transfers settled together in one ledger (one tx, N path-payment ops). */
app.post("/transfer/batch", async (req, reply) => {
  const body = parse(
    z.object({ senderId: SenderId, sendAsset: SendAsset, amountEach: z.union([z.string(), z.number()]), count: z.number().int().min(2).max(20), recipient: RecipientSchema, purpose: z.string().max(60).default("Family support") }),
    req.body,
  );
  const amountEach = parseAmount(body.amountEach);
  const pub = book[body.senderId].publicKey;
  const lines = await trustlines(book, pub, [body.sendAsset]);
  const total = new Big(amountEach).times(body.count);
  if (total.gt(lines[body.sendAsset].balance) && lines[body.sendAsset].authorized)
    throw new HttpError(400, `Insufficient balance for ${body.count} × ${amountEach}`, "INSUFFICIENT_BALANCE");
  const quote = await getQuote(book, body.sendAsset, amountEach, "tINR", DEFAULT_SLIPPAGE_BPS);
  const batchId = newTransferId("B");
  const rows = [];
  for (let i = 0; i < body.count; i++)
    rows.push(await createTransfer(book, { quote, senderId: body.senderId, recipient: body.recipient, purpose: body.purpose, batch: { id: batchId, index: i } }));
  void runBatch(book, rows, batchId).finally(invalidateSenders);
  return reply.status(201).send({ batchId, transferIds: rows.map((r) => r.id) });
});

/** DEBUG: skip backend compliance entirely, to prove the network enforces authorization by itself. */
app.post("/debug/force-transfer", async (req, reply) => {
  const body = parse(z.object({ senderId: SenderId, sendAsset: SendAsset.default("tAED"), amount: z.union([z.string(), z.number()]).default("10") }), req.body);
  const quote = await getQuote(book, body.sendAsset, parseAmount(body.amount), "tINR", DEFAULT_SLIPPAGE_BPS);
  const row = await createTransfer(book, { quote, senderId: body.senderId, recipient: { name: "Debug Recipient", upiId: "debug@upi" }, purpose: "debug force-submit" });
  await runSingle(book, row, { bypassCompliance: true });
  return reply.status(201).send({ transferId: row.id });
});

app.get("/transfer/:id", async (req) => {
  const { id } = req.params as { id: string };
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Transfer not found");
  return toView(row);
});

app.get("/transfers", async (req) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
  return recentRows(limit).map(toView);
});

// ---------------- admin ----------------

app.post("/admin/sanction", async (req) => {
  requireAdmin(req);
  const { publicKey } = parse(z.object({ publicKey: z.string().length(56) }), req.body);
  db.prepare("INSERT OR IGNORE INTO sanctions (subject, kind, reason, at) VALUES (?, 'account', 'Added by admin', ?)").run(publicKey, Date.now());
  // Freeze on-chain: issuers revoke authorization. Existing balances stay but cannot move.
  const revoked = await setAuthorized(book, publicKey, ["tUSDC", "tAED"], false);
  invalidateSenders();
  broadcast("senders", {});
  return { sanctioned: true, revokedOnChain: revoked };
});

app.post("/admin/unsanction", async (req) => {
  requireAdmin(req);
  const { publicKey } = parse(z.object({ publicKey: z.string().length(56) }), req.body);
  db.prepare("DELETE FROM sanctions WHERE subject = ?").run(publicKey);
  const restored = kycPassed(publicKey) ? await setAuthorized(book, publicKey, ["tUSDC", "tAED"], true) : [];
  invalidateSenders();
  broadcast("senders", {});
  return { sanctioned: false, reauthorizedOnChain: restored };
});

app.post("/admin/approve/:id", async (req) => {
  requireAdmin(req);
  await approveFlagged(book, (req.params as { id: string }).id);
  return { ok: true };
});

app.post("/admin/reject/:id", async (req) => {
  requireAdmin(req);
  rejectFlagged((req.params as { id: string }).id);
  return { ok: true };
});

app.post("/admin/clawback", async (req) => {
  requireAdmin(req);
  const body = parse(z.object({ publicKey: z.string().length(56), asset: SendAsset, amount: z.union([z.string(), z.number()]) }), req.body);
  const lines = await trustlines(book, body.publicKey, [body.asset]);
  const amount = parseAmount(body.amount, { max: lines[body.asset].balance });
  const issuer = body.asset === "tUSDC" ? "ISSUER_USD" : "ISSUER_AED";
  const r = await submitOps(keypair(book, issuer), [Operation.clawback({ asset: assetOf(book, body.asset), from: body.publicKey, amount })]);
  invalidateSenders();
  broadcast("senders", {});
  return { txHash: r.hash, clawedBack: `${amount} ${body.asset}` };
});

app.post("/admin/rebalance", async (req) => {
  requireAdmin(req);
  healthCache = undefined;
  quoteCache.clear();
  return { result: await rebalance(0) };
});

app.get("/admin/unmatched", async (req) => {
  requireAdmin(req);
  return db.prepare("SELECT * FROM unmatched ORDER BY at DESC LIMIT 50").all();
});

/** Demo: a stray payment with no memo lands at the India anchor; it must NOT be paid out. */
app.post("/admin/simulate-stray-payment", async (req) => {
  requireAdmin(req);
  const r = await submitOps(keypair(book, "MARKET_MAKER"), [
    Operation.payment({ destination: book.ANCHOR_RECV.publicKey, asset: assetOf(book, "tINR"), amount: "123.4500000" }),
  ], { memo: Memo.text("no-such-transfer") });
  return { txHash: r.hash };
});

// ---------------- start ----------------

await resumeInFlight(book).catch((e) => app.log.warn(`resume failed: ${(e as Error).message}`));
startWatcher(book);
await app.listen({ port: ENV.PORT, host: "0.0.0.0" });
