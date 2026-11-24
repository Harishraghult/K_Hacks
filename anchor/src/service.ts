import { Memo } from "@stellar/stellar-sdk";
import {
  ASSET_CODES,
  COMPLIANCE,
  StellarTxError,
  applySlippage,
  assetOf,
  evaluateCompliance,
  getFx,
  getQuote,
  keypair,
  newTransferId,
  payoutShouldFail,
  server,
  sleep,
  submitOps,
  toStellar,
  toUsd,
  Big,
  type AccountBook,
  type AccountName,
  type Quote,
  type Recipient,
  type TransferStatus,
} from "@remit/shared";
import { db } from "./db.js";
import { deliveredAmounts, pathPaymentOp, trustlines } from "./chain.js";
import { senderExists, senderName, senderPub, senderSigner } from "./wallets.js";
import {
  getRow,
  insertTransfer,
  patchRow,
  rowsByBatch,
  rowsByStatus,
  toView,
  transition,
  usdUsedToday,
  type TransferRow,
} from "./repo.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ---------------- KYC / sanctions lookups ----------------

export const kycPassed = (pub: string) =>
  !!db.prepare("SELECT 1 FROM kyc WHERE public_key = ? AND status = 'PASSED'").get(pub);

export const isSanctioned = (subject: string | undefined) =>
  !!subject && !!db.prepare("SELECT 1 FROM sanctions WHERE lower(subject) = lower(?)").get(subject);

// ---------------- compliance ----------------

async function complianceFor(book: AccountBook, row: Pick<TransferRow, "id" | "sender_id" | "sender_pub" | "send_asset" | "usd_equiv">, recipient: Recipient, opts: { extraUsdToday?: string } = {}) {
  const [senderLines, recvLines] = await Promise.all([
    trustlines(book, row.sender_pub, [row.send_asset]),
    trustlines(book, book.ANCHOR_RECV.publicKey, [ASSET_CODES.INR]),
  ]);
  const used = new Big(usdUsedToday(row.sender_id, row.id)).plus(opts.extraUsdToday ?? "0").toFixed(7);
  return evaluateCompliance({
    senderKycPassed: kycPassed(row.sender_pub),
    senderAuthorizedOnChain: senderLines[row.send_asset].authorized,
    receiverAnchorAuthorizedOnChain: recvLines[ASSET_CODES.INR].authorized,
    senderSanctioned: isSanctioned(row.sender_pub),
    recipientSanctioned: isSanctioned(recipient.upiId) || isSanctioned(recipient.bankAcct) || isSanctioned(recipient.name),
    usdAmount: row.usd_equiv,
    usdUsedToday: used,
    reviewThresholdUsd: COMPLIANCE.REVIEW_THRESHOLD_USD,
    dailyLimitUsd: COMPLIANCE.DAILY_LIMIT_USD,
  });
}

// ---------------- create ----------------

export interface CreateInput {
  quote: Quote;
  senderId: string;
  recipient: Recipient;
  purpose: string;
  batch?: { id: string; index: number };
}

export async function createTransfer(book: AccountBook, i: CreateInput): Promise<TransferRow> {
  if (!senderExists(i.senderId)) throw new HttpError(400, "Unknown sender");
  const pub = senderPub(book, i.senderId);
  const fx = await getFx();
  const q = i.quote;
  return insertTransfer({
    id: newTransferId("T"),
    batchId: i.batch?.id,
    batchIndex: i.batch?.index,
    senderId: i.senderId,
    senderPub: pub,
    sendAsset: q.sendAsset,
    sendAmount: q.sendAmount,
    destAsset: q.destAsset,
    quotedDest: q.best.destAmount,
    destMin: q.destMin,
    usdEquiv: toStellar(toUsd(fx, q.sendAsset, q.sendAmount)),
    route: q.best.hops.map((h) => h.code),
    rejected: q.rejected.map((r) => ({ route: r.hops.map((h) => h.code), destAmount: r.destAmount })),
    path: q.best.hops,
    recipient: i.recipient,
    travel: {
      originatorName: senderName(i.senderId),
      originatorAccount: pub,
      beneficiaryName: i.recipient.name,
      beneficiaryAccount: i.recipient.upiId ?? i.recipient.bankAcct ?? "",
      purpose: i.purpose,
    },
  });
}

// ---------------- run: compliance → submit ----------------

/** Runs compliance; returns the decision status. Submission happens in the background. */
export async function runSingle(book: AccountBook, row: TransferRow, opts: { bypassCompliance?: boolean } = {}): Promise<TransferStatus> {
  transition(row.id, "COMPLIANCE_CHECK");
  if (opts.bypassCompliance) {
    transition(row.id, "APPROVED", {}, "DEBUG: backend pre-checks BYPASSED — the network alone decides");
  } else {
    const recipient = JSON.parse(row.recipient_json) as Recipient;
    const c = await complianceFor(book, row, recipient);
    if (c.decision !== "APPROVED") {
      transition(row.id, c.decision, { reasons: c.reasons }, c.reasons.join("; "));
      return c.decision;
    }
    transition(row.id, "APPROVED", {}, "KYC ✓  sanctions ✓  limits ✓  on-chain authorization ✓");
  }
  void submitSingle(book, row.id);
  return "APPROVED";
}

async function submitSingle(book: AccountBook, id: string) {
  const row = getRow(id)!;
  const hops = JSON.parse(row.path_json);
  try {
    const res = await submitOps(senderSigner(book, row.sender_id), [
      pathPaymentOp(hops, row.send_amount, book.ANCHOR_RECV.publicKey, row.dest_min),
    ], {
      memo: Memo.text(row.id),
      onHash: (hash) => {
        // Record the hash before submitting so a restart can look it up instead of resending.
        if (getRow(id)!.status === "APPROVED") transition(id, "SUBMITTED", { tx_hash: hash }, `tx ${hash.slice(0, 10)}…`);
        else patchRow(id, { tx_hash: hash });
      },
    });
    markSettled(id, res.hash, res.feeCharged);
  } catch (e) {
    failOnChain(id, e);
  }
}

function markSettled(id: string, hash: string, feeStroops: string, received?: string) {
  const cur = getRow(id)!;
  if (cur.status === "SUBMITTED") {
    transition(id, "SETTLED_ON_CHAIN", { tx_hash: hash, fee_stroops: feeStroops, ...(received ? { received_amount: received } : {}) }, `ledger-confirmed, fee ${feeStroops} stroops`);
  } else if (!cur.fee_stroops) {
    patchRow(id, { fee_stroops: feeStroops });
  }
}

function failOnChain(id: string, e: unknown) {
  const cur = getRow(id)!;
  const code = e instanceof StellarTxError ? e.primaryCode : "submit_error";
  const msg = e instanceof StellarTxError ? e.friendly : (e as Error).message;
  console.warn(`[transfer ${id}] on-chain failure: ${code} ${e instanceof StellarTxError ? JSON.stringify(e.codes) : msg}`);
  if (cur.status === "APPROVED") transition(id, "SUBMITTED", {}, "submitted");
  if (getRow(id)!.status === "SUBMITTED")
    transition(id, "ON_CHAIN_FAILED", { error_code: code, error_message: msg, ...(e instanceof StellarTxError && e.hash ? { tx_hash: e.hash } : {}) }, `${code}: ${msg}`);
}

// ---------------- micro-remittance batch: N transfers, one tx, one ledger ----------------

export async function runBatch(book: AccountBook, rows: TransferRow[], batchId: string) {
  const approved: TransferRow[] = [];
  let extra = new Big(0);
  for (const row of rows) {
    transition(row.id, "COMPLIANCE_CHECK");
    const c = await complianceFor(book, row, JSON.parse(row.recipient_json), { extraUsdToday: extra.toFixed(7) });
    if (c.decision !== "APPROVED") {
      // Micro-transfers are never held for review: anything not cleanly approved is blocked.
      const reasons = c.decision === "FLAGGED_FOR_REVIEW" ? [...c.reasons, "Batch items cannot be held for review"] : c.reasons;
      transition(row.id, "BLOCKED", { reasons }, reasons.join("; "));
      continue;
    }
    extra = extra.plus(row.usd_equiv);
    transition(row.id, "APPROVED", {}, "KYC ✓  sanctions ✓  limits ✓");
    approved.push(row);
  }
  if (!approved.length) return;
  const sender = approved[0].sender_id;
  try {
    const ops = approved.map((r) => pathPaymentOp(JSON.parse(r.path_json), r.send_amount, book.ANCHOR_RECV.publicKey, r.dest_min));
    const res = await submitOps(senderSigner(book, sender), ops, {
      memo: Memo.text(batchId),
      onHash: (hash) => approved.forEach((r) => getRow(r.id)!.status === "APPROVED" && transition(r.id, "SUBMITTED", { tx_hash: hash }, `batch tx ${hash.slice(0, 10)}…`)),
    });
    const perOp = new Big(res.feeCharged).div(approved.length).toFixed(0);
    approved.forEach((r) => markSettled(r.id, res.hash, perOp));
  } catch (e) {
    approved.forEach((r) => failOnChain(r.id, e));
  }
}

// ---------------- admin review ----------------

export async function approveFlagged(book: AccountBook, id: string) {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Transfer not found");
  if (row.status !== "FLAGGED_FOR_REVIEW") throw new HttpError(409, `Transfer is ${row.status}, not awaiting review`);
  // Re-check everything except the review threshold at approval time (sanctions may have changed).
  const c = await complianceFor(book, row, JSON.parse(row.recipient_json));
  if (c.decision === "BLOCKED") {
    transition(id, "BLOCKED", { reasons: c.reasons }, `Re-check at approval failed: ${c.reasons.join("; ")}`);
    return;
  }
  transition(id, "APPROVED", {}, "Approved by compliance officer (Travel Rule data on file)");
  // Submit with the ORIGINAL destMin: if the price moved against the sender, the network rejects it
  // (op_under_dest_min) and the sender re-quotes. We never silently accept a worse rate.
  void submitSingle(book, id);
}

export function rejectFlagged(id: string, reason = "Rejected by compliance officer") {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Transfer not found");
  if (row.status !== "FLAGGED_FOR_REVIEW") throw new HttpError(409, `Transfer is ${row.status}, not awaiting review`);
  transition(id, "BLOCKED", { reasons: [reason] }, reason);
}

export function expireStaleReviews() {
  const cutoff = Date.now() - COMPLIANCE.REVIEW_EXPIRY_MIN * 60_000;
  for (const r of rowsByStatus("FLAGGED_FOR_REVIEW"))
    if (r.updated_at < cutoff) transition(r.id, "EXPIRED", {}, `Not reviewed within ${COMPLIANCE.REVIEW_EXPIRY_MIN} min`);
}

// ---------------- off-ramp: payout + refund ----------------

const payoutsInFlight = new Set<string>();

/** Simulated UPI / bank credit. Idempotent: only acts on PAYOUT_PENDING, once per process. */
export async function runPayout(book: AccountBook, id: string) {
  if (payoutsInFlight.has(id)) return;
  payoutsInFlight.add(id);
  try {
    const row = getRow(id);
    if (!row || row.status !== "PAYOUT_PENDING") return;
    const recipient = JSON.parse(row.recipient_json) as Recipient;
    await sleep(1000 + Math.floor(Math.random() * 2000)); // rail latency
    if (getRow(id)!.status !== "PAYOUT_PENDING") return;
    if (payoutShouldFail(recipient)) {
      transition(id, "PAYOUT_FAILED", { error_code: "PAYOUT_REJECTED", error_message: "Beneficiary bank rejected the credit (invalid/closed account)" }, "UPI/bank rail rejected credit");
      await runRefund(book, id);
      return;
    }
    const utr = `UTR${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1e4).toString().padStart(4, "0")}`;
    transition(id, "PAYOUT_COMPLETE", { payout_ref: utr }, `₹${row.received_amount} credited to ${recipient.upiId ?? recipient.bankAcct}, ref ${utr}`);
  } finally {
    payoutsInFlight.delete(id);
  }
}

/** Refund: ANCHOR_RECV path-pays the received tINR back to the sender in their original asset. */
export async function runRefund(book: AccountBook, id: string) {
  let row = getRow(id)!;
  if (row.status === "PAYOUT_FAILED") row = transition(id, "REFUND_PENDING", {}, "Returning funds to sender");
  if (row.status !== "REFUND_PENDING") return;

  // Restart safety: if a refund tx was already sent, look it up instead of sending another.
  if (row.refund_tx) {
    const prior = await server.transactions().transaction(row.refund_tx).call().catch(() => undefined);
    if (prior?.successful) {
      transition(id, "REFUNDED", {}, `refund tx ${row.refund_tx.slice(0, 10)}… (recovered after restart)`);
      return;
    }
  }
  try {
    const amount = row.received_amount ?? row.quoted_dest;
    const paths = await server.strictSendPaths(assetOf(book, "tINR"), amount, [assetOf(book, row.send_asset)]).call();
    const best = [...paths.records].sort((a, b) => new Big(b.destination_amount).comparedTo(a.destination_amount) ?? 0)[0];
    if (!best) throw new Error("No liquidity to refund");
    const hops = [
      { code: "tINR", issuer: book.ISSUER_INR.publicKey },
      ...best.path.map((p) => (p.asset_type === "native" ? { code: "XLM" } : { code: p.asset_code!, issuer: p.asset_issuer! })),
      { code: row.send_asset, issuer: assetOf(book, row.send_asset).getIssuer() },
    ];
    const res = await submitOps(keypair(book, "ANCHOR_RECV"), [pathPaymentOp(hops, amount, row.sender_pub, applySlippage(best.destination_amount, 200))], {
      memo: Memo.text(`R${row.id}`.slice(0, 28)),
      onHash: (hash) => patchRow(id, { refund_tx: hash }),
    });
    const [delivered] = await deliveredAmounts(res.hash);
    transition(id, "REFUNDED", { refund_tx: res.hash }, `${delivered?.amount ?? best.destination_amount} ${row.send_asset} returned to sender (FX round-trip cost borne by anchor in production)`);
  } catch (e) {
    const msg = e instanceof StellarTxError ? `${e.primaryCode}: ${e.friendly}` : (e as Error).message;
    transition(id, "REFUND_FAILED", { error_message: msg }, `Refund failed: ${msg} — manual ops required`);
  }
}

/** On boot: finish anything a crash interrupted. */
export async function resumeInFlight(book: AccountBook) {
  for (const r of rowsByStatus("PAYOUT_PENDING")) void runPayout(book, r.id);
  for (const r of rowsByStatus("PAYOUT_FAILED")) void runRefund(book, r.id);
  for (const r of rowsByStatus("REFUND_PENDING")) void runRefund(book, r.id);
  // SUBMITTED with a hash: ask Horizon what happened.
  for (const r of rowsByStatus("SUBMITTED")) {
    if (!r.tx_hash) continue;
    const found = await server.transactions().transaction(r.tx_hash).call().catch(() => undefined);
    if (found?.successful) markSettled(r.id, r.tx_hash, String(found.fee_charged));
    else if (found && !found.successful) failOnChain(r.id, new StellarTxError({ transaction: "tx_failed" }, "Transaction failed on-chain.", r.tx_hash));
    else if (Date.now() - r.updated_at > 120_000) failOnChain(r.id, new StellarTxError({ transaction: "tx_too_late" }, "The transaction expired before it was processed.", r.tx_hash));
  }
  // APPROVED but never submitted (crash before signing): safe to submit since no hash exists.
  for (const r of rowsByStatus("APPROVED")) if (!r.tx_hash && !r.batch_id) void submitSingle(book, r.id);
}

export { rowsByBatch, toView };
