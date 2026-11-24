import {
  Big,
  NON_COUNTING,
  canTransition,
  type AssetCode,
  type PathHop,
  type Recipient,
  type TransferEvent,
  type TransferStatus,
  type TransferView,
  type TravelRule,
} from "@remit/shared";
import { db } from "./db.js";
import { senderName } from "./wallets.js";
import { broadcast } from "./sse.js";

export interface TransferRow {
  id: string;
  batch_id: string | null;
  batch_index: number | null;
  sender_id: string;
  sender_pub: string;
  send_asset: AssetCode;
  send_amount: string;
  dest_asset: AssetCode;
  quoted_dest: string;
  dest_min: string;
  usd_equiv: string;
  route_json: string;
  rejected_json: string;
  path_json: string;
  recipient_json: string;
  travel_json: string;
  status: TransferStatus;
  reasons_json: string;
  error_code: string | null;
  error_message: string | null;
  tx_hash: string | null;
  fee_stroops: string | null;
  received_amount: string | null;
  payout_ref: string | null;
  refund_tx: string | null;
  created_at: number;
  updated_at: number;
}

export interface NewTransfer {
  id: string;
  batchId?: string;
  batchIndex?: number;
  senderId: string;
  senderPub: string;
  sendAsset: AssetCode;
  sendAmount: string;
  destAsset: AssetCode;
  quotedDest: string;
  destMin: string;
  usdEquiv: string;
  route: string[];
  rejected: { route: string[]; destAmount: string }[];
  path: PathHop[]; // full hops incl. source/destination
  recipient: Recipient;
  travel: TravelRule;
}

export function insertTransfer(t: NewTransfer): TransferRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO transfers (id, batch_id, batch_index, sender_id, sender_pub, send_asset, send_amount, dest_asset, quoted_dest, dest_min,
      usd_equiv, route_json, rejected_json, path_json, recipient_json, travel_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?)`,
  ).run(
    t.id, t.batchId ?? null, t.batchIndex ?? null, t.senderId, t.senderPub, t.sendAsset, t.sendAmount, t.destAsset, t.quotedDest, t.destMin,
    t.usdEquiv, JSON.stringify(t.route), JSON.stringify(t.rejected), JSON.stringify(t.path), JSON.stringify(t.recipient), JSON.stringify(t.travel), now, now,
  );
  db.prepare("INSERT INTO transfer_events (transfer_id, status, at, detail) VALUES (?, 'CREATED', ?, ?)").run(t.id, now, null);
  const row = getRow(t.id)!;
  broadcast("transfer", toView(row), row.sender_id);
  return row;
}

export function getRow(id: string): TransferRow | undefined {
  return db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as unknown as TransferRow | undefined;
}

export function rowsByBatch(batchId: string): TransferRow[] {
  return db.prepare("SELECT * FROM transfers WHERE batch_id = ? ORDER BY batch_index").all(batchId) as unknown as TransferRow[];
}

export function rowsByStatus(status: TransferStatus): TransferRow[] {
  return db.prepare("SELECT * FROM transfers WHERE status = ?").all(status) as unknown as TransferRow[];
}

export function recentRows(limit = 30): TransferRow[] {
  return db.prepare("SELECT * FROM transfers ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as TransferRow[];
}

export function eventsFor(id: string): TransferEvent[] {
  return (db.prepare("SELECT status, at, detail FROM transfer_events WHERE transfer_id = ? ORDER BY id").all(id) as unknown as {
    status: TransferStatus;
    at: number;
    detail: string | null;
  }[]).map((e) => ({ status: e.status, at: e.at, ...(e.detail ? { detail: e.detail } : {}) }));
}

export class InvalidTransitionError extends Error {}

type Patch = Partial<Pick<TransferRow, "error_code" | "error_message" | "tx_hash" | "fee_stroops" | "received_amount" | "payout_ref" | "refund_tx" | "dest_min">> & {
  reasons?: string[];
};

/** Validated, persisted, broadcast state transition. */
export function transition(id: string, to: TransferStatus, patch: Patch = {}, detail?: string): TransferRow {
  const row = getRow(id);
  if (!row) throw new Error(`Unknown transfer ${id}`);
  if (!canTransition(row.status, to)) throw new InvalidTransitionError(`${id}: ${row.status} → ${to} not allowed`);
  const now = Date.now();
  const sets: string[] = ["status = ?", "updated_at = ?"];
  const vals: (string | number | null)[] = [to, now];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "reasons") {
      sets.push("reasons_json = ?");
      vals.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = ?`);
      vals.push(v as string | null);
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE transfers SET ${sets.join(", ")} WHERE id = ? AND status = ?`).run(...vals, id, row.status);
    db.prepare("INSERT INTO transfer_events (transfer_id, status, at, detail) VALUES (?, ?, ?, ?)").run(id, to, now, detail ?? null);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const updated = getRow(id)!;
  broadcast("transfer", toView(updated), updated.sender_id);
  return updated;
}

/** Non-state field updates (e.g. recording a tx hash before the result is known). */
export function patchRow(id: string, patch: Patch) {
  const entries = Object.entries(patch).filter(([k]) => k !== "reasons");
  if (!entries.length) return;
  db.prepare(`UPDATE transfers SET ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
    ...entries.map(([, v]) => v as string | null),
    Date.now(),
    id,
  );
}

export function usdUsedToday(senderId: string, excludeId?: string): string {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = db
    .prepare(`SELECT id, usd_equiv, status FROM transfers WHERE sender_id = ? AND created_at >= ?`)
    .all(senderId, startOfDay.getTime()) as unknown as { id: string; usd_equiv: string; status: TransferStatus }[];
  return rows
    .filter((r) => r.id !== excludeId && !NON_COUNTING.includes(r.status) && r.status !== "CREATED" && r.status !== "COMPLIANCE_CHECK")
    .reduce((acc, r) => acc.plus(r.usd_equiv), new Big(0))
    .toFixed(7);
}

export function toView(r: TransferRow): TransferView {
  return {
    id: r.id,
    ...(r.batch_id ? { batchId: r.batch_id } : {}),
    senderId: r.sender_id,
    senderName: senderName(r.sender_id),
    sendAsset: r.send_asset,
    sendAmount: r.send_amount,
    destAsset: r.dest_asset,
    quotedDest: r.quoted_dest,
    destMin: r.dest_min,
    usdEquiv: r.usd_equiv,
    route: JSON.parse(r.route_json),
    rejectedRoutes: JSON.parse(r.rejected_json),
    recipient: JSON.parse(r.recipient_json),
    status: r.status,
    reasons: JSON.parse(r.reasons_json),
    ...(r.error_code ? { errorCode: r.error_code } : {}),
    ...(r.error_message ? { errorMessage: r.error_message } : {}),
    ...(r.tx_hash ? { txHash: r.tx_hash } : {}),
    ...(r.fee_stroops ? { feeStroops: r.fee_stroops } : {}),
    ...(r.received_amount ? { receivedAmount: r.received_amount } : {}),
    ...(r.payout_ref ? { payoutRef: r.payout_ref } : {}),
    ...(r.refund_tx ? { refundTx: r.refund_tx } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    events: eventsFor(r.id),
  };
}
