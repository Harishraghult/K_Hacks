import { Networks } from "@stellar/stellar-sdk";

export const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = process.env.FRIENDBOT_URL ?? "https://friendbot.stellar.org";
export const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

import { ALL_ASSETS, CURRENCY, CURRENCY_LIST, type AssetCode, type Fiat } from "./corridors";

/** Asset codes (<=12 chars, alphanumeric). The currency registry lives in corridors.ts. */
export { ASSET_CODES, type AssetCode } from "./corridors";
/** Every asset can be sent and received: n currencies → n·(n−1) corridors (see corridors.ts). */
export const SEND_ASSETS: AssetCode[] = ALL_ASSETS;

/** Bump when bootstrap must re-run on existing testnet accounts (new trustlines, accounts, offers). */
export const BOOTSTRAP_VERSION = 3;

export const ACCOUNT_NAMES = [
  "ISSUER_USD",
  "ISSUER_INR",
  "ISSUER_AED",
  "ISSUER_EUR",
  "ISSUER_GBP",
  "ISSUER_JPY",
  "ISSUER_CAD",
  "ISSUER_AUD",
  "ISSUER_SGD",
  "ISSUER_PHP",
  "ISSUER_MXN",
  "ANCHOR_SEND",
  "ANCHOR_RECV",
  "MARKET_MAKER",
  "SENDER_1",
  "SENDER_2",
  "SENDER_3",
  "SENDER_4",
  "SENDER_5",
  "SENDER_6",
  "SANCTIONED_1",
  "UNVERIFIED_1",
] as const;
export type AccountName = (typeof ACCOUNT_NAMES)[number];

/** Which issuer account issues which asset. */
export const ISSUER_FOR = Object.fromEntries(CURRENCY_LIST.map((c) => [c.asset, c.issuer])) as Record<AssetCode, AccountName>;
export const ISSUER_NAMES = CURRENCY_LIST.map((c) => c.issuer as AccountName);

export const FIAT_FOR_ASSET = Object.fromEntries(CURRENCY_LIST.map((c) => [c.asset, c.fiat])) as Record<AssetCode, Fiat>;
export const ASSET_FOR_FIAT = Object.fromEntries(CURRENCY_LIST.map((c) => [c.fiat, c.asset])) as Record<Fiat, AssetCode>;

/** AED is pegged to USD. */
export const AED_PER_USD = CURRENCY.tAED.fallbackPerUsd;
/** Used only if the FX API is unreachable. */
export const FALLBACK_INR_PER_USD = CURRENCY.tINR.fallbackPerUsd;

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
