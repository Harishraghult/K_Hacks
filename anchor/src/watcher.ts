import { Big, server, type AccountBook } from "@remit/shared";
import { db, kvGet, kvSet } from "./db.js";
import { getRow, rowsByBatch, transition, type TransferRow } from "./repo.js";
import { runPayout } from "./service.js";
import { broadcast } from "./sse.js";

const CURSOR_KEY = "watcher_cursor";

export const watcherState = {
  connected: false,
  cursor: undefined as string | undefined,
  lastEventAt: undefined as number | undefined,
  reconnects: 0,
  lastError: undefined as string | undefined,
};

interface PaymentRecord {
  id: string;
  paging_token: string;
  type: string;
  transaction_hash: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

const memoCache = new Map<string, { memo?: string; opIds: string[] }>();

async function txInfo(hash: string) {
  const cached = memoCache.get(hash);
  if (cached) return cached;
  const [t, ops] = await Promise.all([
    server.transactions().transaction(hash).call(),
    server.operations().forTransaction(hash).limit(100).call(),
  ]);
  const info = { memo: t.memo_type === "text" ? t.memo : undefined, opIds: ops.records.map((o) => o.id) };
  memoCache.set(hash, info);
  if (memoCache.size > 500) memoCache.delete(memoCache.keys().next().value!);
  return info;
}

function recordUnmatched(p: PaymentRecord, memo: string | undefined, reason: string) {
  db.prepare(
    "INSERT OR IGNORE INTO unmatched (op_id, tx_hash, memo, amount, asset, from_acct, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(p.id, p.transaction_hash, memo ?? null, p.amount ?? "0", p.asset_code ?? "XLM", p.from ?? "", reason, Date.now());
  console.warn(`[watcher] UNMATCHED op ${p.id} memo=${memo ?? "(none)"}: ${reason}`);
  broadcast("unmatched", { opId: p.id, txHash: p.transaction_hash, memo, amount: p.amount, asset: p.asset_code, reason }, "admin");
}

/** Handles one incoming payment. Must be idempotent: may be re-delivered after a restart. */
export async function handlePayment(book: AccountBook, p: PaymentRecord) {
  const recv = book.ANCHOR_RECV.publicKey;
  if (!["payment", "path_payment_strict_send", "path_payment_strict_receive"].includes(p.type)) return;
  if (p.to !== recv || p.from === recv) return; // outgoing (refunds) or unrelated

  // Idempotency: one payout per payment operation, ever.
  if (db.prepare("SELECT 1 FROM processed_payments WHERE op_id = ?").get(p.id)) return;

  const isInr = p.asset_code === "tINR" && p.asset_issuer === book.ISSUER_INR.publicKey;
  const { memo, opIds } = await txInfo(p.transaction_hash);

  let row: TransferRow | undefined;
  if (memo?.startsWith("B")) {
    // Batch: the N-th payment op in the tx belongs to the N-th approved transfer of the batch.
    const approved = rowsByBatch(memo).filter((r) => r.tx_hash === p.transaction_hash);
    row = approved[opIds.indexOf(p.id)];
  } else if (memo) {
    row = getRow(memo);
  }

  const markProcessed = (transferId: string | null) =>
    db.prepare("INSERT OR IGNORE INTO processed_payments (op_id, tx_hash, transfer_id, at) VALUES (?, ?, ?, ?)").run(p.id, p.transaction_hash, transferId, Date.now());

  if (!isInr) {
    markProcessed(null);
    return recordUnmatched(p, memo, `Unexpected asset ${p.asset_code ?? "XLM"}`);
  }
  if (!row) {
    markProcessed(null);
    return recordUnmatched(p, memo, memo ? "Memo does not match any transfer" : "Missing memo");
  }
  if (new Big(p.amount ?? "0").lt(row.dest_min)) {
    markProcessed(row.id);
    return recordUnmatched(p, memo, `Received ₹${p.amount} < guaranteed minimum ₹${row.dest_min}; held for review`);
  }

  // Atomically mark processed and move the transfer forward.
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db
      .prepare("INSERT OR IGNORE INTO processed_payments (op_id, tx_hash, transfer_id, at) VALUES (?, ?, ?, ?)")
      .run(p.id, p.transaction_hash, row.id, Date.now());
    db.exec("COMMIT");
    if (Number(inserted.changes) === 0) return;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const cur = getRow(row.id)!;
  if (cur.status === "SUBMITTED")
    transition(row.id, "SETTLED_ON_CHAIN", { tx_hash: p.transaction_hash, received_amount: p.amount }, "Payment observed by anchor watcher");
  else db.prepare("UPDATE transfers SET received_amount = ? WHERE id = ?").run(p.amount ?? null, row.id);
  if (getRow(row.id)!.status === "SETTLED_ON_CHAIN") {
    transition(row.id, "PAYOUT_PENDING", {}, `₹${p.amount} received by India anchor; initiating UPI/bank credit`);
    void runPayout(book, row.id);
  }
}

let closeStream: (() => void) | undefined;
let queue: Promise<void> = Promise.resolve();
let backoff = 1000;
let generation = 0;

export function startWatcher(book: AccountBook) {
  watcherState.cursor = kvGet(CURSOR_KEY) ?? "now";
  let restarting = false;

  const open = () => {
    const gen = ++generation;
    let failed = false;
    console.log(`[watcher] streaming ANCHOR_RECV payments from cursor ${watcherState.cursor}`);
    closeStream = server
      .payments()
      .forAccount(book.ANCHOR_RECV.publicKey)
      .cursor(watcherState.cursor!)
      .stream({
        onmessage: (rec) => {
          if (gen !== generation) return; // message from a stream we already replaced
          watcherState.connected = true;
          backoff = 1000;
          const p = rec as unknown as PaymentRecord;
          // Serialise processing; persist the cursor only after the record is handled.
          queue = queue.then(async () => {
            if (gen !== generation || failed) return;
            try {
              await handlePayment(book, p);
              watcherState.cursor = p.paging_token;
              watcherState.lastEventAt = Date.now();
              kvSet(CURSOR_KEY, p.paging_token);
            } catch (e) {
              // Do not advance the cursor: the reopened stream re-delivers this record (dedupe makes that safe).
              failed = true;
              console.error(`[watcher] failed on op ${p.id}:`, (e as Error).message);
              watcherState.lastError = (e as Error).message;
              restart();
            }
          });
        },
        onerror: (e) => {
          if (gen !== generation) return;
          watcherState.lastError = String((e as { message?: string })?.message ?? "stream error");
          restart();
        },
      });
    watcherState.connected = true;
  };

  const restart = () => {
    if (restarting) return;
    restarting = true;
    generation++; // invalidate the old stream immediately
    watcherState.connected = false;
    watcherState.reconnects++;
    try {
      closeStream?.();
    } catch {
      /* ignore */
    }
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30000);
    console.warn(`[watcher] reconnecting in ${wait}ms (${watcherState.lastError ?? ""})`);
    setTimeout(() => {
      restarting = false;
      watcherState.cursor = kvGet(CURSOR_KEY) ?? watcherState.cursor;
      open();
    }, wait);
  };

  open();
  return () => closeStream?.();
}
