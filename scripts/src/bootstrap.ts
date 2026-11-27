/**
 * Idempotent network bootstrap. Safe to re-run; rebuilds everything after a testnet reset.
 *
 * Order matters:
 *  1. fund accounts (Friendbot)
 *  2. issuers: AUTH_REQUIRED | AUTH_REVOCABLE
 *  3. MARKET_MAKER trustlines (+ pool-share trustlines), authorized
 *  4. issuers: + AUTH_CLAWBACK_ENABLED  (every trustline created after this is clawback-able;
 *     the market maker's are not, because clawback-enabled trustlines cannot deposit into AMM pools)
 *  5. other trustlines, authorized for KYC-passed accounts only (UNVERIFIED_1 never authorized)
 *  6. mint supply, seed demo balances
 *  7. AMM pools + worse-priced direct orderbook offers (both directions), priced from live FX
 *
 * All 6 corridors (AED/USD/INR → any other) share this liquidity. Every sender and the receiving
 * anchor hold all three assets, so any currency can be sent and any currency can be paid out.
 */
import fs from "node:fs";
import path from "node:path";
import {
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  Operation,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  ACCOUNT_NAMES,
  ALL_ASSETS,
  BOOTSTRAP_VERSION,
  Big,
  CURRENCY_LIST,
  EXPLORER_BASE,
  FRIENDBOT_URL,
  assetOf,
  changeTrustOp,
  dataDir,
  getFx,
  keypair,
  loadAccountOrNull,
  loadOrCreateAccounts,
  POOLS,
  poolInfo,
  rebalanceAll,
  server,
  sleep,
  submitOps,
  toStellar,
  type AccountBook,
  type AccountName,
  type AssetCode,
} from "@remit/shared";

const book: AccountBook = loadOrCreateAccounts();
const pub = (n: AccountName) => book[n].publicKey;
const A = (c: AssetCode) => assetOf(book, c);
const log = (...a: unknown[]) => console.log("•", ...a);
const RESET_AUTH = process.argv.includes("--reset-auth");

type Balance = Horizon.HorizonApi.BalanceLine;
type AssetBalance = Horizon.HorizonApi.BalanceLineAsset;

/** Which assets each holder needs, and whether it is KYC-authorised. */
const HOLDERS: { name: AccountName; assets: AssetCode[]; authorize: boolean }[] = [
  // On-ramp float: pays out the digital currency when a customer adds money (any of the 3 currencies).
  { name: "ANCHOR_SEND", assets: ALL_ASSETS, authorize: true },
  // Off-ramp: receives the destination currency of every corridor, then pays out locally (UPI / ACH / UAEFTS).
  { name: "ANCHOR_RECV", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_1", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_2", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_3", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_4", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_5", assets: ALL_ASSETS, authorize: true },
  { name: "SENDER_6", assets: ALL_ASSETS, authorize: true },
  // Passed KYC at onboarding; later found on the sanctions list. Backend blocks it; admin can freeze on-chain.
  { name: "SANCTIONED_1", assets: ALL_ASSETS, authorize: true },
  // Never passed KYC: trustline exists but is never authorized, so the network itself rejects its payments.
  { name: "UNVERIFIED_1", assets: ALL_ASSETS, authorize: false },
];

/** Starter wallet balances (only refilled when below `min`). */
const STARTERS: { name: AccountName; code: AssetCode; target: string; min: string }[] = [
  ...(["SENDER_1", "SENDER_2", "SENDER_3", "SANCTIONED_1"] as AccountName[]).flatMap((name) => [
    { name, code: "tAED" as AssetCode, target: "1000", min: "500" },
    { name, code: "tUSDC" as AssetCode, target: "300", min: "150" },
  ]),
  // Priya, Bengaluru: sends INR abroad (India → UAE / US corridors).
  { name: "SENDER_4", code: "tINR", target: "50000", min: "25000" },
  { name: "SENDER_4", code: "tUSDC", target: "100", min: "50" },
  // Emma, Berlin (EUR) and Kenji, Tokyo (JPY).
  { name: "SENDER_5", code: "tEUR", target: "1000", min: "500" },
  { name: "SENDER_6", code: "tJPY", target: "150000", min: "75000" },
];
const MM_ASSETS: AssetCode[] = ALL_ASSETS;
const ISSUERS: { name: AccountName; code: AssetCode }[] = CURRENCY_LIST.map((c) => ({ name: c.issuer as AccountName, code: c.asset }));

// ---------- helpers ----------

async function friendbot(pk: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pk)}`, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return;
      const body = await res.text();
      if (body.includes("createAccountAlreadyExist") || body.includes("already funded")) return;
      console.warn(`  friendbot ${res.status} for ${pk.slice(0, 6)}… (attempt ${attempt + 1})`);
    } catch (e) {
      console.warn(`  friendbot error for ${pk.slice(0, 6)}…: ${(e as Error).message}`);
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`Friendbot failed for ${pk}`);
}

function findLine(balances: Balance[], a: Asset): AssetBalance | undefined {
  return balances.find(
    (b) => (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") && b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer(),
  ) as AssetBalance | undefined;
}

async function balancesOf(n: AccountName): Promise<Balance[]> {
  const acc = await server.loadAccount(pub(n));
  return acc.balances;
}

async function ensureTrustlines(holder: AccountName, codes: AssetCode[]) {
  const bals = await balancesOf(holder);
  const ops = codes.filter((c) => !findLine(bals, A(c))).map((c) => changeTrustOp(A(c)));
  if (ops.length) {
    await submitOps(keypair(book, holder), ops);
    log(`${holder}: trustlines ${codes.filter((c) => !findLine(bals, A(c))).join(", ")}`);
  }
}

/** Issuer authorises trustlines that are not yet authorised. */
async function ensureAuthorized(pairs: { holder: AccountName; code: AssetCode }[]) {
  const byIssuer = new Map<AssetCode, xdr.Operation[]>();
  for (const { holder, code } of pairs) {
    const line = findLine(await balancesOf(holder), A(code));
    if (!line) throw new Error(`${holder} missing trustline ${code}`);
    if (line.is_authorized) continue;
    const ops = byIssuer.get(code) ?? [];
    ops.push(Operation.setTrustLineFlags({ trustor: pub(holder), asset: A(code), flags: { authorized: true } }));
    byIssuer.set(code, ops);
  }
  for (const [code, ops] of byIssuer) {
    const issuer = ISSUERS.find((i) => i.code === code)!.name;
    await submitOps(keypair(book, issuer), ops);
    log(`${issuer}: authorized ${ops.length} ${code} trustline(s)`);
  }
}

async function ensureIssuerFlags(withClawback: boolean) {
  await Promise.all(
    ISSUERS.map(async ({ name }) => {
      const acc = await server.loadAccount(pub(name));
      const want = { auth_required: true, auth_revocable: true, auth_clawback_enabled: withClawback };
      const f = acc.flags;
      const missing =
        (!f.auth_required ? AuthRequiredFlag : 0) |
        (!f.auth_revocable ? AuthRevocableFlag : 0) |
        (want.auth_clawback_enabled && !f.auth_clawback_enabled ? AuthClawbackEnabledFlag : 0);
      if (missing) {
        await submitOps(keypair(book, name), [Operation.setOptions({ setFlags: missing as 1 })]);
        log(`${name}: set flags ${missing}`);
      }
    }),
  );
}

/** Top a holder's balance up to `target` if it is below `minimum`. */
async function topUp(from: AccountName, to: AccountName, code: AssetCode, target: string, minimum = target) {
  const line = findLine(await balancesOf(to), A(code));
  const have = new Big(line?.balance ?? "0");
  if (have.gte(minimum)) return;
  const amount = toStellar(new Big(target).minus(have));
  await submitOps(keypair(book, from), [Operation.payment({ destination: pub(to), asset: A(code), amount })]);
  log(`${from} → ${to}: ${amount} ${code}`);
}

/**
 * Direct orderbook route `pay → get`: the MM sells `get` for `pay` at a deliberately worse rate (1.5% below
 * mid), so the router has a real alternative to compare against the AMM route.
 * `getPerPay` = mid-market units of `get` per 1 unit of `pay`.
 */
async function ensureDirectOffer(pay: AssetCode, get: AssetCode, getPerPay: Big, amountGet: string) {
  const worse = getPerPay.times("0.985");
  const price = new Big(1).div(worse).toPrecision(9); // price = buying (pay) per selling (get)
  const offers = await server.offers().forAccount(pub("MARKET_MAKER")).limit(50).call();
  const existing = offers.records.find(
    (o) => (o.selling as { asset_code?: string }).asset_code === get && (o.buying as { asset_code?: string }).asset_code === pay,
  );
  await submitOps(keypair(book, "MARKET_MAKER"), [
    Operation.manageSellOffer({ selling: A(get), buying: A(pay), amount: amountGet, price, offerId: existing ? existing.id : "0" }),
  ]);
  log(`orderbook ${pay}→${get}: ${existing ? "refreshed" : "created"} offer, ${worse.toFixed(6)} ${get}/${pay} (1.5% worse than mid)`);
}

// ---------- main ----------

async function main() {
  console.log(`\nBootstrapping Stellar testnet. Data dir: ${dataDir()}\n`);

  // 1. Fund
  const missing: AccountName[] = [];
  for (const n of ACCOUNT_NAMES) if (!(await loadAccountOrNull(pub(n)))) missing.push(n);
  if (missing.length) {
    log(`funding ${missing.length} account(s) via Friendbot: ${missing.join(", ")}`);
    // Small batches: Friendbot rate-limits bursts.
    for (let i = 0; i < missing.length; i += 3) await Promise.all(missing.slice(i, i + 3).map((n) => friendbot(pub(n))));
  } else log("all accounts exist");

  // 2. Issuer flags (without clawback yet)
  await ensureIssuerFlags(false);

  // 3. Market maker trustlines + pool-share trustlines, authorised
  await ensureTrustlines("MARKET_MAKER", MM_ASSETS);
  await ensureAuthorized(MM_ASSETS.map((code) => ({ holder: "MARKET_MAKER" as const, code })));
  for (const { x, y } of POOLS) {
    const { lp, id } = poolInfo(book, x, y);
    const bals = await balancesOf("MARKET_MAKER");
    if (!bals.some((bl) => (bl as { liquidity_pool_id?: string }).liquidity_pool_id === id)) {
      await submitOps(keypair(book, "MARKET_MAKER"), [changeTrustOp(lp)]);
      log(`MARKET_MAKER: pool-share trustline ${x}/${y}`);
    }
  }

  // 4. Clawback on
  await ensureIssuerFlags(true);

  // 5. Remaining trustlines + authorisation
  await Promise.all(HOLDERS.map((h) => ensureTrustlines(h.name, h.assets)));
  await ensureAuthorized(HOLDERS.filter((h) => h.authorize).flatMap((h) => h.assets.map((code) => ({ holder: h.name, code }))));
  if (RESET_AUTH) {
    // Demo reset: undo anything the demo changed (KYC'd the unverified wallet, froze a sender).
    for (const h of HOLDERS.filter((x) => !x.authorize)) {
      const bals = await balancesOf(h.name);
      for (const code of h.assets) {
        if (findLine(bals, A(code))?.is_authorized) {
          await submitOps(keypair(book, ISSUERS.find((i) => i.code === code)!.name), [
            Operation.setTrustLineFlags({ trustor: pub(h.name), asset: A(code), flags: { authorized: false } }),
          ]);
          log(`${h.name}: ${code} authorization revoked (demo reset)`);
        }
      }
    }
  }

  // 6. Mint, sized from the registry: market maker holds ~2.5× its pool depth (+ orderbook), the on-ramp
  //    float holds ~USD 1M of every currency. Uses the fallback rate; precision does not matter here.
  const totalPoolUsd = CURRENCY_LIST.reduce((a, c) => a.plus(c.poolDepthUsd), new Big(0));
  await topUp("ISSUER_USD", "MARKET_MAKER", "tUSDC", toStellar(totalPoolUsd.times(2)), toStellar(totalPoolUsd.times("1.3")));
  for (const c of CURRENCY_LIST.filter((x) => x.asset !== "tUSDC")) {
    const depth = new Big(c.poolDepthUsd).times(c.fallbackPerUsd);
    await topUp(c.issuer as AccountName, "MARKET_MAKER", c.asset, toStellar(depth.times("2.5")), toStellar(depth.times("1.5")));
  }
  for (const c of CURRENCY_LIST) {
    const float = new Big(1_000_000).times(c.fallbackPerUsd);
    await topUp(c.issuer as AccountName, "ANCHOR_SEND", c.asset, toStellar(float), toStellar(float.div(10)));
  }
  // Starter balances for demo senders (only refilled when nearly empty)
  for (const s of STARTERS) await topUp("ANCHOR_SEND", s.name, s.code, s.target, s.min);

  // 7. Liquidity priced from live FX
  const fx = await getFx();
  const inrPerUsd = new Big(fx.inrPerUsd);
  const inrPerAed = inrPerUsd.div(fx.aedPerUsd);
  log(`FX: 1 USD = ${fx.inrPerUsd} INR (${fx.source}, as of ${fx.asOf}); 1 USD = ${fx.aedPerUsd} AED; 1 AED = ${inrPerAed.toFixed(4)} INR`);
  // Seeds empty pools at the FX mid; re-centres pools that demo traffic has pushed off the mid.
  for (const line of await rebalanceAll(book, fx)) log(`pool ${line}`);
  const pools = Object.fromEntries(POOLS.map((p) => [`${p.x}/${p.y}`, poolInfo(book, p.x, p.y).id]));
  // Direct (non-AMM) routes in both directions of the AED/INR corridor.
  await ensureDirectOffer("tAED", "tINR", inrPerAed, "5000000");
  await ensureDirectOffer("tINR", "tAED", new Big(1).div(inrPerAed), "200000");

  const state = { bootstrapVersion: BOOTSTRAP_VERSION, bootstrappedAt: new Date().toISOString(), fx, pools };
  fs.writeFileSync(path.join(dataDir(), "network.json"), JSON.stringify(state, null, 2));

  // 8. Summary
  console.log("\nAccount        Public key                                                 Balances");
  console.log("-".repeat(130));
  for (const n of ACCOUNT_NAMES) {
    const acc = await server.loadAccount(pub(n));
    const bals = acc.balances
      .map((b) => {
        if (b.asset_type === "native") return `XLM ${new Big(b.balance).toFixed(0)}`;
        if (b.asset_type === "liquidity_pool_shares") return `LP ${new Big(b.balance).toFixed(0)}`;
        const ab = b as AssetBalance;
        return `${ab.asset_code} ${new Big(ab.balance).toFormat(2)}${ab.is_authorized ? "" : " (UNAUTHORIZED)"}`;
      })
      .join(" | ");
    console.log(`${n.padEnd(14)} ${acc.accountId()}   ${bals}`);
  }
  console.log(`\nExplorer: ${EXPLORER_BASE}/account/<public key>`);
  console.log(`Pools (${Object.keys(pools).length}, every currency against tUSDC):`);
  for (const [pair, id] of Object.entries(pools)) console.log(`  ${pair.padEnd(12)} ${EXPLORER_BASE}/liquidity-pool/${id}`);
  console.log(`Corridors: ${CURRENCY_LIST.length} currencies → ${CURRENCY_LIST.length * (CURRENCY_LIST.length - 1)} routes`);
  console.log("\nBootstrap complete.\n");
}

main().catch((e) => {
  console.error("\nBootstrap failed:", e?.response?.data?.extras?.result_codes ?? e?.codes ?? e);
  process.exit(1);
});
