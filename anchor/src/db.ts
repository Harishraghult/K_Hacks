import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "@remit/shared";

export const DB_PATH = process.env.ANCHOR_DB ?? path.join(dataDir(), "anchor.db");
export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  batch_index INTEGER,
  sender_id TEXT NOT NULL,
  sender_pub TEXT NOT NULL,
  send_asset TEXT NOT NULL,
  send_amount TEXT NOT NULL,
  dest_asset TEXT NOT NULL,
  quoted_dest TEXT NOT NULL,
  dest_min TEXT NOT NULL,
  usd_equiv TEXT NOT NULL,
  route_json TEXT NOT NULL,
  rejected_json TEXT NOT NULL,
  path_json TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  travel_json TEXT NOT NULL,
  status TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  tx_hash TEXT,
  fee_stroops TEXT,
  received_amount TEXT,
  payout_ref TEXT,
  refund_tx TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_sender ON transfers(sender_id, created_at);
CREATE INDEX IF NOT EXISTS transfers_batch ON transfers(batch_id);
CREATE TABLE IF NOT EXISTS transfer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS events_transfer ON transfer_events(transfer_id);
CREATE TABLE IF NOT EXISTS kyc (
  public_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sanctions (
  subject TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bank (
  account_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  balance TEXT NOT NULL
);
-- Idempotency: one row per on-chain payment operation that we have handled.
CREATE TABLE IF NOT EXISTS processed_payments (
  op_id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  transfer_id TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS unmatched (
  op_id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  memo TEXT,
  amount TEXT NOT NULL,
  asset TEXT NOT NULL,
  from_acct TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

export function kvGet(k: string): string | undefined {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
  return row?.v;
}
export function kvSet(k: string, v: string) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
