/**
 * Customer wallets. Every sender is identified by a `senderId`:
 *  - demo personas: the account name (SENDER_1 …), keys in .data/accounts.json
 *  - signed-up customers: "U-<username>", a fresh testnet keypair created at signup,
 *    secret encrypted at rest (AES-256-GCM, key in .data/wallet.key).
 * Custodial by design for the prototype; production would use user-held keys (SEP-10).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Keypair, Operation } from "@stellar/stellar-sdk";
import {
  ACCOUNT_NAMES,
  ALL_ASSETS,
  ASSET_OF_COUNTRY,
  CURRENCY,
  FRIENDBOT_URL,
  type Country,
  type Fiat,
  assetOf,
  dataDir,
  keypair,
  loadAccountOrNull,
  sleep,
  submitOps,
  type AccountBook,
  type AccountName,
} from "@remit/shared";
import { db } from "./db.js";
import { personaById } from "./personas.js";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  sender_id TEXT NOT NULL UNIQUE,
  wallet_pub TEXT NOT NULL,
  wallet_secret_enc TEXT,
  country TEXT NOT NULL,
  wallet_status TEXT NOT NULL,
  wallet_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

export type WalletStatus = "PROVISIONING" | "READY" | "FAILED";

export interface UserRow {
  username: string;
  display_name: string;
  password_hash: string;
  sender_id: string;
  wallet_pub: string;
  wallet_secret_enc: string | null;
  country: Country;
  wallet_status: WalletStatus;
  wallet_error: string | null;
  created_at: number;
}

// ---------------- encryption at rest ----------------

function walletKey(): Buffer {
  const file = path.join(dataDir(), "wallet.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}
const KEY = walletKey();

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------------- lookups ----------------

export const userByUsername = (u: string) => db.prepare("SELECT * FROM users WHERE username = ?").get(u) as unknown as UserRow | undefined;
export const userBySender = (s: string) => db.prepare("SELECT * FROM users WHERE sender_id = ?").get(s) as unknown as UserRow | undefined;

const isPersona = (id: string): id is AccountName => (ACCOUNT_NAMES as readonly string[]).includes(id) && !!personaById(id);

export function senderPub(book: AccountBook, senderId: string): string {
  if (isPersona(senderId)) return book[senderId].publicKey;
  const u = userBySender(senderId);
  if (!u) throw new Error(`Unknown sender ${senderId}`);
  return u.wallet_pub;
}

export function senderName(senderId: string): string {
  return personaById(senderId)?.name ?? userBySender(senderId)?.display_name ?? senderId;
}

export function senderSigner(book: AccountBook, senderId: string): Keypair {
  if (isPersona(senderId)) return keypair(book, senderId);
  const u = userBySender(senderId);
  if (!u?.wallet_secret_enc) throw new Error(`No wallet key for ${senderId}`);
  return Keypair.fromSecret(decrypt(u.wallet_secret_enc));
}

export const senderExists = (senderId: string) => isPersona(senderId) || !!userBySender(senderId);

// ---------------- provisioning (signup) ----------------

const provisioning = new Set<string>();

/** Idempotent: fund via Friendbot, then add tAED + tUSDC + tINR trustlines (left unauthorised until KYC passes). */
export async function provisionWallet(book: AccountBook, username: string): Promise<void> {
  if (provisioning.has(username)) return;
  provisioning.add(username);
  try {
    const u = userByUsername(username);
    if (!u || u.wallet_status === "READY") return;
    const kp = Keypair.fromSecret(decrypt(u.wallet_secret_enc!));
    let acc = await loadAccountOrNull(u.wallet_pub);
    for (let attempt = 0; !acc && attempt < 5; attempt++) {
      await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(u.wallet_pub)}`, { signal: AbortSignal.timeout(30000) }).catch(() => undefined);
      acc = await loadAccountOrNull(u.wallet_pub);
      if (!acc) await sleep(2000 * 2 ** attempt);
    }
    if (!acc) throw new Error("Could not create the wallet on Stellar testnet (Friendbot unavailable). Retry later.");
    const have = new Set(acc.balances.map((b) => ("asset_code" in b ? b.asset_code : "native")));
    const ops = ALL_ASSETS.filter((c) => !have.has(c)).map((c) => Operation.changeTrust({ asset: assetOf(book, c) }));
    if (ops.length) await submitOps(kp, ops);
    db.prepare("UPDATE users SET wallet_status = 'READY', wallet_error = NULL WHERE username = ?").run(username);
  } catch (e) {
    db.prepare("UPDATE users SET wallet_status = 'FAILED', wallet_error = ? WHERE username = ?").run((e as Error).message, username);
    throw e;
  } finally {
    provisioning.delete(username);
  }
}

/** Customer bank account currency and opening balance, by country. */
export function bankForCountry(country: Country): { currency: Fiat; start: string } {
  const c = CURRENCY[ASSET_OF_COUNTRY[country]];
  return { currency: c.fiat, start: c.bankStart };
}

/**
 * Wallets created before INR could be sent lack a tINR trustline. Adds any missing trustline and returns
 * the assets that were added (the caller authorises them if the customer has passed KYC).
 */
export async function addMissingTrustlines(book: AccountBook, username: string) {
  const u = userByUsername(username);
  if (!u?.wallet_secret_enc || u.wallet_status !== "READY") return [];
  const acc = await loadAccountOrNull(u.wallet_pub);
  if (!acc) return [];
  const have = new Set(acc.balances.map((b) => ("asset_code" in b ? b.asset_code : "native")));
  const missing = ALL_ASSETS.filter((c) => !have.has(c));
  if (missing.length) await submitOps(Keypair.fromSecret(decrypt(u.wallet_secret_enc)), missing.map((c) => Operation.changeTrust({ asset: assetOf(book, c) })));
  return missing;
}

export function createUser(i: { username: string; displayName: string; passwordHash: string; country: Country }): UserRow {
  const kp = Keypair.random();
  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, sender_id, wallet_pub, wallet_secret_enc, country, wallet_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PROVISIONING', ?)`,
  ).run(i.username, i.displayName, i.passwordHash, `U-${i.username}`, kp.publicKey(), encrypt(kp.secret()), i.country, Date.now());
  // Linked mock bank account so the new customer can add money once verified.
  const bank = bankForCountry(i.country);
  db.prepare("INSERT OR IGNORE INTO bank (account_id, currency, balance) VALUES (?, ?, ?)").run(`U-${i.username}`, bank.currency, bank.start);
  return userByUsername(i.username)!;
}

/** Demo logins mapped onto the pre-built persona wallets. */
export const DEMO_LOGINS: { username: string; password: string; senderId: AccountName; country: Country }[] = [
  { username: "ravi", password: "ravi1234", senderId: "SENDER_1", country: "AE" },
  { username: "maria", password: "maria1234", senderId: "SENDER_2", country: "US" },
  { username: "arjun", password: "arjun1234", senderId: "SENDER_3", country: "AE" },
  { username: "priya", password: "priya1234", senderId: "SENDER_4", country: "IN" },
  { username: "emma", password: "emma1234", senderId: "SENDER_5", country: "EU" },
  { username: "kenji", password: "kenji1234", senderId: "SENDER_6", country: "JP" },
  { username: "watchlisted", password: "watch1234", senderId: "SANCTIONED_1", country: "AE" },
  { username: "newuser", password: "newuser1234", senderId: "UNVERIFIED_1", country: "AE" },
];

export function seedDemoUsers(book: AccountBook, hash: (pw: string) => string) {
  for (const d of DEMO_LOGINS) {
    if (userByUsername(d.username)) continue;
    db.prepare(
      `INSERT INTO users (username, display_name, password_hash, sender_id, wallet_pub, wallet_secret_enc, country, wallet_status, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'READY', ?)`,
    ).run(d.username, personaById(d.senderId)!.name, hash(d.password), d.senderId, book[d.senderId].publicKey, d.country, Date.now());
  }
}

export function resumeProvisioning(book: AccountBook) {
  const rows = db.prepare("SELECT username FROM users WHERE wallet_status = 'PROVISIONING'").all() as unknown as { username: string }[];
  for (const r of rows) void provisionWallet(book, r.username).catch(() => undefined);
}
