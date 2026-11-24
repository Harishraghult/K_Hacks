import { Networks } from "@stellar/stellar-sdk";

export const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = process.env.FRIENDBOT_URL ?? "https://friendbot.stellar.org";
export const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

/** Asset codes (<=12 chars, alphanumeric). */
export const ASSET_CODES = { USD: "tUSDC", INR: "tINR", AED: "tAED" } as const;
export type AssetCode = (typeof ASSET_CODES)[keyof typeof ASSET_CODES];
export const SEND_ASSETS: AssetCode[] = ["tUSDC", "tAED"];

export const ACCOUNT_NAMES = [
  "ISSUER_USD",
  "ISSUER_INR",
  "ISSUER_AED",
  "ANCHOR_SEND",
  "ANCHOR_RECV",
  "MARKET_MAKER",
  "SENDER_1",
  "SENDER_2",
  "SENDER_3",
  "SANCTIONED_1",
  "UNVERIFIED_1",
] as const;
export type AccountName = (typeof ACCOUNT_NAMES)[number];

/** Which issuer account issues which asset. */
export const ISSUER_FOR: Record<AssetCode, AccountName> = {
  tUSDC: "ISSUER_USD",
  tINR: "ISSUER_INR",
  tAED: "ISSUER_AED",
};

export const FIAT_FOR_ASSET: Record<AssetCode, "USD" | "INR" | "AED"> = {
  tUSDC: "USD",
  tINR: "INR",
  tAED: "AED",
};
export const ASSET_FOR_FIAT: Record<"USD" | "AED" | "INR", AssetCode> = {
  USD: "tUSDC",
  AED: "tAED",
  INR: "tINR",
};

/** AED is pegged to USD. */
export const AED_PER_USD = "3.6725";
/** Used only if the FX API is unreachable. */
export const FALLBACK_INR_PER_USD = "92.90";

export const COMPLIANCE = {
  /** USD-equivalent above which a transfer needs manual review. */
  REVIEW_THRESHOLD_USD: "1000",
  /** USD-equivalent daily cap per sender. */
  DAILY_LIMIT_USD: "5000",
  /** Flagged transfers not approved within this many minutes expire. */
  REVIEW_EXPIRY_MIN: 15,
};

export const QUOTE_TTL_SEC = 30;
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const PRICE_IMPACT_WARN_PCT = 2;
export const TX_TIMEOUT_SEC = 30;
export const MAX_FEE_STROOPS = 10_000; // cap for surge-pricing retries

/** Illustrative traditional-corridor figures. */
export const TRADITIONAL = {
  FEE_PCT: "6.4",
  SETTLEMENT: "1-5 days",
  SOURCE: "World Bank Remittance Prices Worldwide: global average cost of sending $200 (illustrative)",
  SOURCE_URL: "https://remittanceprices.worldbank.org/",
};
