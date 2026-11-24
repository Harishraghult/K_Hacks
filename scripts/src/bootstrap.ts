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
 *  7. AMM pools + a worse-priced direct orderbook, priced from live FX
 */
import fs from "node:fs";
import path from "node:path";
import {
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Horizon,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Operation,
  getLiquidityPoolId,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  ACCOUNT_NAMES,
  Big,
  EXPLORER_BASE,
  FRIENDBOT_URL,
  assetOf,
  dataDir,
  getFx,
  keypair,
  loadAccountOrNull,
  loadOrCreateAccounts,
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

type Balance = Horizon.HorizonApi.BalanceLine;
type AssetBalance = Horizon.HorizonApi.BalanceLineAsset;

/** Which assets each holder needs, and whether it is KYC-authorised. */
const HOLDERS: { name: AccountName; assets: AssetCode[]; authorize: boolean }[] = [
  { name: "ANCHOR_SEND", assets: ["tUSDC", "tAED"], authorize: true },
  { name: "ANCHOR_RECV", assets: ["tINR"], authorize: true },
  { name: "SENDER_1", assets: ["tUSDC", "tAED"], authorize: true },
  { name: "SENDER_2", assets: ["tUSDC", "tAED"], authorize: true },
  { name: "SENDER_3", assets: ["tUSDC", "tAED"], authorize: true },
  // Passed KYC at onboarding; later found on the sanctions list. Backend blocks it; admin can freeze on-chain.
  { name: "SANCTIONED_1", assets: ["tUSDC", "tAED"], authorize: true },
  // Never passed KYC: trustline exists but is never authorized, so the network itself rejects its payments.
  { name: "UNVERIFIED_1", assets: ["tUSDC", "tAED"], authorize: false },
];
const MM_ASSETS: AssetCode[] = ["tUSDC", "tINR", "tAED"];
const ISSUERS: { name: AccountName; code: AssetCode }[] = [
  { name: "ISSUER_USD", code: "tUSDC" },
  { name: "ISSUER_INR", code: "tINR" },
  { name: "ISSUER_AED", code: "tAED" },
];

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
  const ops = codes.filter((c) => !findLine(bals, A(c))).map((c) => Operation.changeTrust({ asset: A(c) }));
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

function poolAsset(x: AssetCode, y: AssetCode) {
  const [a, b] = Asset.compare(A(x), A(y)) <= 0 ? [A(x), A(y)] : [A(y), A(x)];
  const lp = new LiquidityPoolAsset(a, b, LiquidityPoolFeeV18);
  const id = Buffer.from(getLiquidityPoolId("constant_product", lp.getLiquidityPoolParameters())).toString("hex");
  return { lp, a, b, id };
}

/** Deposits into a pool if it is empty. `amounts` is keyed by asset code. */
async function ensurePool(x: AssetCode, y: AssetCode, amounts: Record<string, string>) {
  const { lp, a, b, id } = poolAsset(x, y);
  const mm = "MARKET_MAKER" as const;
  const bals = await balancesOf(mm);
  const hasShareLine = bals.some((bl) => bl.asset_type === "liquidity_pool_shares" && (bl as { liquidity_pool_id?: string }).liquidity_pool_id === id);
  if (!hasShareLine) {
    await submitOps(keypair(book, mm), [Operation.changeTrust({ asset: lp })]);
    log(`MARKET_MAKER: pool-share trustline ${x}/${y}`);
  }
  let shares = "0";
  try {
    const pool = await server.liquidityPools().liquidityPoolId(id).call();
    shares = pool.total_shares;
  } catch {
    /* pool entry is created by the share trustline; treat as empty */
  }
  if (new Big(shares).gt(0)) {
    log(`pool ${x}/${y} already has liquidity (${shares} shares), leaving it`);
    return id;
  }
  const amtA = amounts[a.getCode()];
  const amtB = amounts[b.getCode()];
  const price = new Big(amtA).div(amtB);
  await submitOps(keypair(book, mm), [
    Operation.liquidityPoolDeposit({
      liquidityPoolId: id,
      maxAmountA: amtA,
      maxAmountB: amtB,
      minPrice: price.times("0.99").toFixed(7),
      maxPrice: price.times("1.01").toFixed(7),
    }),
  ]);
  log(`pool ${x}/${y}: deposited ${amtA} ${a.getCode()} + ${amtB} ${b.getCode()}`);
  return id;
}

/** Direct tAED→tINR orderbook: MM sells tINR for tAED at a deliberately worse rate. */
async function ensureDirectOffer(inrPerAed: Big, amountInr: string) {
  const worse = inrPerAed.times("0.985"); // 1.5% worse than mid
  const priceAedPerInr = new Big(1).div(worse).toPrecision(9); // price = buying (tAED) per selling (tINR)
  const offers = await server.offers().forAccount(pub("MARKET_MAKER")).limit(50).call();
  const existing = offers.records.find(
    (o) =>
      (o.selling as { asset_code?: string }).asset_code === "tINR" && (o.buying as { asset_code?: string }).asset_code === "tAED",
  );
  await submitOps(keypair(book, "MARKET_MAKER"), [
    Operation.manageSellOffer({
      selling: A("tINR"),
      buying: A("tAED"),
      amount: amountInr,
      price: priceAedPerInr,
      offerId: existing ? existing.id : "0",
    }),
  ]);
  log(`orderbook tAED→tINR: ${existing ? "refreshed" : "created"} offer, ${worse.toFixed(4)} INR/AED (1.5% worse than mid)`);
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
  for (const [x, y] of [["tUSDC", "tINR"], ["tAED", "tUSDC"]] as [AssetCode, AssetCode][]) {
    const { lp, id } = poolAsset(x, y);
    const bals = await balancesOf("MARKET_MAKER");
    if (!bals.some((bl) => (bl as { liquidity_pool_id?: string }).liquidity_pool_id === id)) {
      await submitOps(keypair(book, "MARKET_MAKER"), [Operation.changeTrust({ asset: lp })]);
      log(`MARKET_MAKER: pool-share trustline ${x}/${y}`);
    }
  }

  // 4. Clawback on
  await ensureIssuerFlags(true);

  // 5. Remaining trustlines + authorisation
  await Promise.all(HOLDERS.map((h) => ensureTrustlines(h.name, h.assets)));
  await ensureAuthorized(HOLDERS.filter((h) => h.authorize).flatMap((h) => h.assets.map((code) => ({ holder: h.name, code }))));

  // 6. Mint
  await topUp("ISSUER_USD", "MARKET_MAKER", "tUSDC", "2000000", "1000000");
  await topUp("ISSUER_AED", "MARKET_MAKER", "tAED", "6000000", "3000000");
  await topUp("ISSUER_INR", "MARKET_MAKER", "tINR", "200000000", "100000000");
  await topUp("ISSUER_USD", "ANCHOR_SEND", "tUSDC", "1000000", "100000");
  await topUp("ISSUER_AED", "ANCHOR_SEND", "tAED", "3000000", "300000");
  // Starter balances for demo senders (only refilled when nearly empty)
  for (const s of ["SENDER_1", "SENDER_2", "SENDER_3", "SANCTIONED_1"] as AccountName[]) {
    await topUp("ANCHOR_SEND", s, "tAED", "1000", "10");
    await topUp("ANCHOR_SEND", s, "tUSDC", "300", "5");
  }

  // 7. Liquidity priced from live FX
  const fx = await getFx();
  const inrPerUsd = new Big(fx.inrPerUsd);
  const inrPerAed = inrPerUsd.div(fx.aedPerUsd);
  log(`FX: 1 USD = ${fx.inrPerUsd} INR (${fx.source}, as of ${fx.asOf}); 1 USD = ${fx.aedPerUsd} AED; 1 AED = ${inrPerAed.toFixed(4)} INR`);
  const usdInrPool = await ensurePool("tUSDC", "tINR", { tUSDC: "500000", tINR: toStellar(inrPerUsd.times(500000)) });
  const aedUsdPool = await ensurePool("tAED", "tUSDC", { tUSDC: "400000", tAED: toStellar(new Big(fx.aedPerUsd).times(400000)) });
  await ensureDirectOffer(inrPerAed, "5000000");

  const state = { bootstrappedAt: new Date().toISOString(), fx, pools: { "tUSDC/tINR": usdInrPool, "tAED/tUSDC": aedUsdPool } };
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
  console.log(`Pools: ${EXPLORER_BASE}/liquidity-pool/${usdInrPool}  ${EXPLORER_BASE}/liquidity-pool/${aedUsdPool}`);
  console.log("\nBootstrap complete.\n");
}

main().catch((e) => {
  console.error("\nBootstrap failed:", e?.response?.data?.extras?.result_codes ?? e?.codes ?? e);
  process.exit(1);
});
