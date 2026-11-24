import BigNumber from "bignumber.js";

/** Money never touches JS floats. Stellar amounts: strings, max 7 decimals. */
export const Big = BigNumber.clone({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_DOWN });
export type Big = BigNumber;

export const STELLAR_DECIMALS = 7;
export const MAX_STELLAR_AMOUNT = new Big("922337203685.4775807");

export class AmountError extends Error {}

/** Validates user input; returns a normalised Stellar amount string. */
export function parseAmount(input: unknown, opts: { max?: string } = {}): string {
  if (typeof input !== "string" && typeof input !== "number") throw new AmountError("Amount is required");
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AmountError("Amount must be a positive number");
  const frac = s.split(".")[1] ?? "";
  if (frac.length > STELLAR_DECIMALS) throw new AmountError(`At most ${STELLAR_DECIMALS} decimal places`);
  const v = new Big(s);
  if (!v.isFinite()) throw new AmountError("Invalid amount");
  if (v.lte(0)) throw new AmountError("Amount must be greater than zero");
  if (v.gt(MAX_STELLAR_AMOUNT)) throw new AmountError("Amount too large");
  if (opts.max !== undefined && v.gt(opts.max)) throw new AmountError("Amount exceeds available balance");
  return toStellar(v);
}

/** Exact on-chain representation (rounds DOWN to 7dp, never over-promise). */
export function toStellar(v: BigNumber.Value): string {
  return new Big(v).decimalPlaces(STELLAR_DECIMALS, BigNumber.ROUND_DOWN).toFixed(STELLAR_DECIMALS);
}

/** Display only. */
export function fmt(v: BigNumber.Value, dp = 2): string {
  return new Big(v).toFormat(dp, BigNumber.ROUND_DOWN);
}

/** Apply slippage tolerance in basis points (rounds down). */
export function applySlippage(amount: BigNumber.Value, bps: number): string {
  return toStellar(new Big(amount).times(10_000 - bps).div(10_000));
}

export const STROOPS_PER_XLM = 10_000_000;
export function stroopsToXlm(stroops: BigNumber.Value): string {
  return new Big(stroops).div(STROOPS_PER_XLM).toFixed(7);
}
