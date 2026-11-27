import fs from "node:fs";
import path from "node:path";
import { Asset, Keypair, LiquidityPoolAsset, Operation, type xdr } from "@stellar/stellar-sdk";
import { ACCOUNT_NAMES, ISSUER_FOR, type AccountName, type AssetCode } from "./constants";

export interface AccountEntry {
  publicKey: string;
  secret: string;
}
export type AccountBook = Record<AccountName, AccountEntry>;

/** Locate repo root (dir whose package.json declares workspaces). */
export function repoRoot(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.readFileSync(pkg, "utf8").includes('"workspaces"')) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function dataDir(): string {
  const d = process.env.DATA_DIR ?? path.join(repoRoot(), ".data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const accountsFile = () => path.join(dataDir(), "accounts.json");

/** Loads keys; creates any missing ones. Keys are stable, so they survive testnet resets. */
export function loadOrCreateAccounts(): AccountBook {
  const file = accountsFile();
  const existing: Partial<AccountBook> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let changed = false;
  for (const name of ACCOUNT_NAMES) {
    if (!existing[name]) {
      const kp = Keypair.random();
      existing[name] = { publicKey: kp.publicKey(), secret: kp.secret() };
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  return existing as AccountBook;
}

export function loadAccounts(): AccountBook {
  const file = accountsFile();
  if (!fs.existsSync(file)) throw new Error(`No accounts at ${file}. Run: npm run bootstrap`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as AccountBook;
}

export function keypair(book: AccountBook, name: AccountName): Keypair {
  return Keypair.fromSecret(book[name].secret);
}

export function assetOf(book: AccountBook, code: AssetCode): Asset {
  return new Asset(code, book[ISSUER_FOR[code]].publicKey);
}

/**
 * changeTrust built with the SAME SDK copy that constructed the asset. Under tsx the scripts workspace can load
 * the SDK's ESM build while this package gets the CJS build, and changeTrust checks `instanceof Asset`.
 */
export function changeTrustOp(asset: Asset | LiquidityPoolAsset): xdr.Operation {
  return Operation.changeTrust({ asset });
}

export function codeOfAsset(book: AccountBook, a: { asset_code?: string; asset_issuer?: string; asset_type: string }): AssetCode | undefined {
  if (a.asset_type === "native") return undefined;
  for (const code of Object.keys(ISSUER_FOR) as AssetCode[]) {
    if (a.asset_code === code && a.asset_issuer === book[ISSUER_FOR[code]].publicKey) return code;
  }
  return undefined;
}

export function nameOf(book: AccountBook, pub: string): AccountName | undefined {
  return (Object.keys(book) as AccountName[]).find((n) => book[n].publicKey === pub);
}
