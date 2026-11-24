import { Asset, LiquidityPoolAsset, LiquidityPoolFeeV18, Operation, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { assetOf, keypair, type AccountBook } from "./accounts";
import type { AssetCode } from "./constants";
import type { FxSnapshot } from "./fx";
import { Big, toStellar } from "./money";
import { server, submitOps } from "./stellar";

/**
 * Mock market maker. One-directional remittance flow (AED/USD in, INR out) pushes AMM prices away from
 * the FX mid; on mainnet arbitrageurs pull them back. On testnet nobody does, so the market maker,
 * which owns 100% of the pool shares, withdraws and re-deposits at the live FX mid in one atomic tx.
 */
export interface PoolSpec {
  x: AssetCode;
  y: AssetCode;
  /** Target units of y per 1 x. */
  target: (fx: FxSnapshot) => string;
  /** Depth: amount of x to deposit. */
  depthX: string;
}

export const POOLS: PoolSpec[] = [
  { x: "tUSDC", y: "tINR", target: (fx) => fx.inrPerUsd, depthX: "500000" },
  { x: "tUSDC", y: "tAED", target: (fx) => fx.aedPerUsd, depthX: "400000" },
];

export function poolInfo(book: AccountBook, x: AssetCode, y: AssetCode) {
  const [a, b] = Asset.compare(assetOf(book, x), assetOf(book, y)) <= 0 ? [assetOf(book, x), assetOf(book, y)] : [assetOf(book, y), assetOf(book, x)];
  const lp = new LiquidityPoolAsset(a, b, LiquidityPoolFeeV18);
  const id = Buffer.from(getLiquidityPoolId("constant_product", lp.getLiquidityPoolParameters())).toString("hex");
  return { lp, a, b, id };
}

/** Deposit amounts for a pool spec at the FX mid, keyed by asset code. */
function amountsAtMid(spec: PoolSpec, fx: FxSnapshot): Record<string, string> {
  return { [spec.x]: toStellar(spec.depthX), [spec.y]: toStellar(new Big(spec.depthX).times(spec.target(fx))) };
}

export interface PoolStatus {
  id: string;
  pair: string;
  price: string; // y per x
  target: string;
  driftPct: string;
  shares: string;
}

export async function poolStatus(book: AccountBook, spec: PoolSpec, fx: FxSnapshot): Promise<PoolStatus | undefined> {
  const { id } = poolInfo(book, spec.x, spec.y);
  try {
    const p = await server.liquidityPools().liquidityPoolId(id).call();
    const r = Object.fromEntries(p.reserves.map((x) => [x.asset.split(":")[0], x.amount]));
    if (new Big(p.total_shares).isZero()) return { id, pair: `${spec.x}/${spec.y}`, price: "0", target: spec.target(fx), driftPct: "100", shares: "0" };
    const price = new Big(r[spec.y]).div(r[spec.x]);
    return {
      id,
      pair: `${spec.x}/${spec.y}`,
      price: price.toFixed(6),
      target: spec.target(fx),
      driftPct: price.minus(spec.target(fx)).div(spec.target(fx)).times(100).toFixed(3),
      shares: p.total_shares,
    };
  } catch {
    return undefined;
  }
}

/** Deposits at the mid if empty; withdraw + re-deposit at the mid if drifted beyond `thresholdPct`. */
export async function rebalancePool(book: AccountBook, spec: PoolSpec, fx: FxSnapshot, thresholdPct = 0.25): Promise<string> {
  const { a, b, id } = poolInfo(book, spec.x, spec.y);
  const st = await poolStatus(book, spec, fx);
  const amounts = amountsAtMid(spec, fx);
  const amtA = amounts[a.getCode()];
  const amtB = amounts[b.getCode()];
  const price = new Big(amtA).div(amtB);
  const deposit = Operation.liquidityPoolDeposit({
    liquidityPoolId: id,
    maxAmountA: amtA,
    maxAmountB: amtB,
    minPrice: price.times("0.999").toFixed(7),
    maxPrice: price.times("1.001").toFixed(7),
  });
  const mm = keypair(book, "MARKET_MAKER");

  if (!st || new Big(st.shares).isZero()) {
    await submitOps(mm, [deposit]);
    return `${spec.x}/${spec.y}: seeded at ${spec.target(fx)}`;
  }
  if (new Big(st.driftPct).abs().lte(thresholdPct)) return `${spec.x}/${spec.y}: ok (drift ${st.driftPct}%)`;

  // Only safe if the market maker owns every share (true in this sandbox).
  const acc = await server.loadAccount(book.MARKET_MAKER.publicKey);
  const mine = acc.balances.find((x) => x.asset_type === "liquidity_pool_shares" && (x as { liquidity_pool_id?: string }).liquidity_pool_id === id)?.balance ?? "0";
  if (!new Big(mine).eq(st.shares)) return `${spec.x}/${spec.y}: drift ${st.driftPct}% but other LPs present; skipping`;

  await submitOps(mm, [Operation.liquidityPoolWithdraw({ liquidityPoolId: id, amount: mine, minAmountA: "0", minAmountB: "0" }), deposit]);
  return `${spec.x}/${spec.y}: rebalanced ${st.price} → ${spec.target(fx)} (drift was ${st.driftPct}%)`;
}

export async function rebalanceAll(book: AccountBook, fx: FxSnapshot, thresholdPct = 0.25): Promise<string[]> {
  const out: string[] = [];
  for (const spec of POOLS) out.push(await rebalancePool(book, spec, fx, thresholdPct));
  return out;
}
