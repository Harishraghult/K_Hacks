import { Asset, BASE_FEE } from "@stellar/stellar-sdk";
import type { AccountBook } from "./accounts.js";
import { assetOf } from "./accounts.js";
import { FIAT_FOR_ASSET, PRICE_IMPACT_WARN_PCT, QUOTE_TTL_SEC, type AssetCode } from "./constants.js";
import { getFx, type FxSnapshot } from "./fx.js";
import { Big, applySlippage, stroopsToXlm, toStellar } from "./money.js";
import { server } from "./stellar.js";

/** Reference XLM price for showing the network fee in USD (testnet XLM has no market price). */
export const XLM_USD_REFERENCE = process.env.XLM_USD_REFERENCE ?? "0.30";

export interface PathHop {
  code: string; // asset code, "XLM" for native
  issuer?: string;
}

export interface Candidate {
  hops: PathHop[]; // full route incl. source and destination
  destAmount: string;
  /** Cost vs mid-market, in percent (pool fees + price impact + spread). */
  costVsMidPct: string;
}

export interface Quote {
  quoteId: string;
  sendAsset: AssetCode;
  sendAmount: string;
  destAsset: AssetCode;
  best: Candidate;
  rejected: Candidate[];
  destMin: string;
  slippageBps: number;
  midRate: string; // dest units per 1 send unit, at FX mid-market
  effectiveRate: string;
  priceImpactWarning: boolean;
  networkFee: { stroops: string; xlm: string; usd: string; xlmUsdReference: string };
  fx: FxSnapshot;
  createdAt: number;
  expiresAt: number;
}

export class NoPathError extends Error {}

function toHop(a: { asset_type: string; asset_code?: string; asset_issuer?: string }): PathHop {
  return a.asset_type === "native" ? { code: "XLM" } : { code: a.asset_code!, issuer: a.asset_issuer };
}

export function hopToAsset(h: PathHop): Asset {
  return h.code === "XLM" ? Asset.native() : new Asset(h.code, h.issuer!);
}

/** Units of `to` per 1 unit of `from`, at mid-market. */
export function midRate(fx: FxSnapshot, from: AssetCode, to: AssetCode): string {
  const usdPer: Record<string, Big> = {
    USD: new Big(1),
    AED: new Big(1).div(fx.aedPerUsd),
    INR: new Big(1).div(fx.inrPerUsd),
  };
  return usdPer[FIAT_FOR_ASSET[from]].div(usdPer[FIAT_FOR_ASSET[to]]).toString();
}

/** Converts an amount in any of our assets to USD-equivalent (for limits/thresholds). */
export function toUsd(fx: FxSnapshot, code: AssetCode, amount: string): Big {
  return new Big(amount).times(midRate(fx, code, "tUSDC"));
}

let quoteSeq = 0;
const newQuoteId = () => `q${Date.now().toString(36)}${(quoteSeq++).toString(36)}`;

/** Pure selection logic (unit-tested): sorts candidates best-first. */
export function rankCandidates(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => new Big(b.destAmount).comparedTo(a.destAmount) ?? 0);
}

export async function getQuote(
  book: AccountBook,
  sendAsset: AssetCode,
  sendAmount: string,
  destAsset: AssetCode,
  slippageBps: number,
): Promise<Quote> {
  const src = assetOf(book, sendAsset);
  const dst = assetOf(book, destAsset);
  const [fx, paths, baseFee] = await Promise.all([
    getFx(),
    server.strictSendPaths(src, sendAmount, [dst]).call(),
    server.fetchBaseFee().catch(() => Number(BASE_FEE)),
  ]);
  const mid = midRate(fx, sendAsset, destAsset);
  const ideal = new Big(sendAmount).times(mid);

  const cands: Candidate[] = paths.records.map((r) => ({
    hops: [toHop({ asset_type: r.source_asset_type, asset_code: r.source_asset_code, asset_issuer: r.source_asset_issuer }), ...r.path.map(toHop), toHop({ asset_type: r.destination_asset_type, asset_code: r.destination_asset_code, asset_issuer: r.destination_asset_issuer })],
    destAmount: r.destination_amount,
    costVsMidPct: ideal.isZero() ? "0" : ideal.minus(r.destination_amount).div(ideal).times(100).toFixed(2),
  }));
  if (!cands.length || cands.every((c) => new Big(c.destAmount).lte(0))) {
    throw new NoPathError(`No liquidity for ${sendAsset} → ${destAsset} at this amount.`);
  }
  const [best, ...rejected] = rankCandidates(cands);
  const stroops = String(baseFee); // one operation
  const xlm = stroopsToXlm(stroops);
  const now = Date.now();
  return {
    quoteId: newQuoteId(),
    sendAsset,
    sendAmount,
    destAsset,
    best,
    rejected,
    destMin: applySlippage(best.destAmount, slippageBps),
    slippageBps,
    midRate: new Big(mid).toFixed(7),
    effectiveRate: toStellar(new Big(best.destAmount).div(sendAmount)),
    priceImpactWarning: new Big(best.costVsMidPct).gt(PRICE_IMPACT_WARN_PCT),
    networkFee: { stroops, xlm, usd: new Big(xlm).times(XLM_USD_REFERENCE).toFixed(6), xlmUsdReference: XLM_USD_REFERENCE },
    fx,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_SEC * 1000,
  };
}
