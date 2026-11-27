/**
 * Currency + payout-rail registry. THE single place to add a currency: add a row to CURRENCY_LIST (and its
 * issuer account name to ACCOUNT_NAMES in constants.ts), then `npm run bootstrap`.
 *
 * Every ordered pair of currencies is a corridor (n·(n−1)). Liquidity is hub-and-spoke: each currency has an
 * AMM pool against tUSDC, so any pair settles atomically in one path payment (X → USDC → Y, or a direct
 * orderbook where one exists). What differs per destination is the local payout rail.
 *
 * Pure (no network, no Node APIs, no SDK) so the web UI can import it.
 */

// ---------------- currencies ----------------

export const FIATS = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD", "AED", "INR", "PHP", "MXN"] as const;
export type Fiat = (typeof FIATS)[number];

/** On-chain asset code per fiat (≤12 chars). */
export const ASSET_CODES = {
  USD: "tUSDC",
  EUR: "tEUR",
  GBP: "tGBP",
  JPY: "tJPY",
  CAD: "tCAD",
  AUD: "tAUD",
  SGD: "tSGD",
  AED: "tAED",
  INR: "tINR",
  PHP: "tPHP",
  MXN: "tMXN",
} as const satisfies Record<Fiat, string>;
export type AssetCode = (typeof ASSET_CODES)[Fiat];

export type Country = "US" | "EU" | "GB" | "JP" | "CA" | "AU" | "SG" | "AE" | "IN" | "PH" | "MX";

export type Rail = "UPI" | "IN_BANK" | "US_ACH" | "AE_IBAN" | "SEPA" | "UK_FPS" | "JP_ZENGIN" | "CA_INTERAC" | "AU_NPP" | "SG_PAYNOW" | "PH_GCASH" | "MX_SPEI";

export interface CurrencyInfo {
  fiat: Fiat;
  asset: AssetCode;
  name: string;
  symbol: string;
  dp: number; // display decimals
  country: Country;
  countryName: string;
  flag: string;
  issuer: string; // account name in .data/accounts.json
  rails: Rail[];
  /** Units per 1 USD if the FX API is down (AED is a hard peg and always uses this). */
  fallbackPerUsd: string;
  pegged?: boolean;
  /** AMM pool depth vs tUSDC, in USD. */
  poolDepthUsd: string;
  /** Opening balance of a new customer's mock bank account in this country. */
  bankStart: string;
}

export const CURRENCY_LIST: CurrencyInfo[] = [
  { fiat: "USD", asset: "tUSDC", name: "US dollar", symbol: "$", dp: 2, country: "US", countryName: "United States", flag: "🇺🇸", issuer: "ISSUER_USD", rails: ["US_ACH"], fallbackPerUsd: "1", poolDepthUsd: "0", bankStart: "2000" },
  { fiat: "EUR", asset: "tEUR", name: "Euro", symbol: "€", dp: 2, country: "EU", countryName: "Eurozone", flag: "🇪🇺", issuer: "ISSUER_EUR", rails: ["SEPA"], fallbackPerUsd: "0.86", poolDepthUsd: "300000", bankStart: "2000" },
  { fiat: "GBP", asset: "tGBP", name: "British pound", symbol: "£", dp: 2, country: "GB", countryName: "United Kingdom", flag: "🇬🇧", issuer: "ISSUER_GBP", rails: ["UK_FPS"], fallbackPerUsd: "0.75", poolDepthUsd: "300000", bankStart: "1500" },
  { fiat: "JPY", asset: "tJPY", name: "Japanese yen", symbol: "¥", dp: 0, country: "JP", countryName: "Japan", flag: "🇯🇵", issuer: "ISSUER_JPY", rails: ["JP_ZENGIN"], fallbackPerUsd: "155", poolDepthUsd: "300000", bankStart: "300000" },
  { fiat: "CAD", asset: "tCAD", name: "Canadian dollar", symbol: "C$", dp: 2, country: "CA", countryName: "Canada", flag: "🇨🇦", issuer: "ISSUER_CAD", rails: ["CA_INTERAC"], fallbackPerUsd: "1.38", poolDepthUsd: "300000", bankStart: "2500" },
  { fiat: "AUD", asset: "tAUD", name: "Australian dollar", symbol: "A$", dp: 2, country: "AU", countryName: "Australia", flag: "🇦🇺", issuer: "ISSUER_AUD", rails: ["AU_NPP"], fallbackPerUsd: "1.52", poolDepthUsd: "300000", bankStart: "3000" },
  { fiat: "SGD", asset: "tSGD", name: "Singapore dollar", symbol: "S$", dp: 2, country: "SG", countryName: "Singapore", flag: "🇸🇬", issuer: "ISSUER_SGD", rails: ["SG_PAYNOW"], fallbackPerUsd: "1.30", poolDepthUsd: "300000", bankStart: "2500" },
  { fiat: "AED", asset: "tAED", name: "UAE dirham", symbol: "AED ", dp: 2, country: "AE", countryName: "United Arab Emirates", flag: "🇦🇪", issuer: "ISSUER_AED", rails: ["AE_IBAN"], fallbackPerUsd: "3.6725", pegged: true, poolDepthUsd: "400000", bankStart: "7500" },
  { fiat: "INR", asset: "tINR", name: "Indian rupee", symbol: "₹", dp: 2, country: "IN", countryName: "India", flag: "🇮🇳", issuer: "ISSUER_INR", rails: ["UPI", "IN_BANK"], fallbackPerUsd: "92.90", poolDepthUsd: "500000", bankStart: "150000" },
  { fiat: "PHP", asset: "tPHP", name: "Philippine peso", symbol: "₱", dp: 2, country: "PH", countryName: "Philippines", flag: "🇵🇭", issuer: "ISSUER_PHP", rails: ["PH_GCASH"], fallbackPerUsd: "58.5", poolDepthUsd: "300000", bankStart: "100000" },
  { fiat: "MXN", asset: "tMXN", name: "Mexican peso", symbol: "MX$", dp: 2, country: "MX", countryName: "Mexico", flag: "🇲🇽", issuer: "ISSUER_MXN", rails: ["MX_SPEI"], fallbackPerUsd: "18.5", poolDepthUsd: "300000", bankStart: "35000" },
];

export const ALL_ASSETS: AssetCode[] = CURRENCY_LIST.map((c) => c.asset);
export const CURRENCY = Object.fromEntries(CURRENCY_LIST.map((c) => [c.asset, c])) as Record<AssetCode, CurrencyInfo>;
export const CURRENCY_BY_FIAT = Object.fromEntries(CURRENCY_LIST.map((c) => [c.fiat, c])) as Record<Fiat, CurrencyInfo>;
export const ASSET_OF_FIAT = Object.fromEntries(CURRENCY_LIST.map((c) => [c.fiat, c.asset])) as Record<Fiat, AssetCode>;
export const ASSET_OF_COUNTRY = Object.fromEntries(CURRENCY_LIST.map((c) => [c.country, c.asset])) as Record<Country, AssetCode>;
export const COUNTRIES: Country[] = CURRENCY_LIST.map((c) => c.country);
export const isAssetCode = (s: string): s is AssetCode => (ALL_ASSETS as string[]).includes(s);

// ---------------- recipients + rails ----------------

export interface RailRecipient {
  name: string;
  upiId?: string;
  bankAcct?: string;
  ifsc?: string;
  routingNumber?: string;
  iban?: string;
  sortCode?: string;
  bankCode?: string;
  branchCode?: string;
  bsb?: string;
  email?: string;
  mobile?: string;
  clabe?: string;
}
export type RailField = Exclude<keyof RailRecipient, "name">;
export const RAIL_FIELDS: RailField[] = ["upiId", "bankAcct", "ifsc", "routingNumber", "iban", "sortCode", "bankCode", "branchCode", "bsb", "email", "mobile", "clabe"];

/** ABA routing number checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10). */
export function isValidAbaRouting(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0 && r !== "000000000";
}

export const normalizeIban = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** ISO 13616 mod-97 (string arithmetic, no BigInt). */
export function ibanMod97(iban: string): number {
  const re = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of re) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

/** UAE IBAN: AE + 2 check digits + 3-digit bank code + 16-digit account = 23 chars. */
export function isValidUaeIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  return /^AE\d{21}$/.test(iban) && ibanMod97(iban) === 1;
}

/** Euro-area SEPA IBAN lengths. */
const SEPA_IBAN_LENGTH: Record<string, number> = {
  AT: 20, BE: 16, CY: 28, DE: 22, EE: 20, ES: 24, FI: 18, FR: 27, GR: 27, HR: 21, IE: 22, IT: 27, LT: 20, LU: 20, LV: 21, MT: 31, NL: 18, PT: 25, SI: 19, SK: 24,
};
export function isValidSepaIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  const len = SEPA_IBAN_LENGTH[iban.slice(0, 2)];
  return !!len && iban.length === len && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) && ibanMod97(iban) === 1;
}

/** Mexican CLABE: 18 digits, weights 3-7-1, last digit is the check digit. */
export function isValidClabe(c: string): boolean {
  if (!/^\d{18}$/.test(c)) return false;
  const w = [3, 7, 1];
  const sum = c.slice(0, 17).split("").reduce((a, d, i) => a + ((Number(d) * w[i % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(c[17]);
}

const digits = (s: string) => s.replace(/[\s-]/g, "");
const upper = (s: string) => s.trim().toUpperCase();
const trim = (s: string) => s.trim();

interface FieldSpec {
  key: RailField;
  label: string;
  placeholder: string;
  normalize: (s: string) => string;
  valid: (s: string) => boolean;
  error: string;
  numeric?: boolean;
}
const F = {
  upiId: { key: "upiId", label: "UPI ID", placeholder: "name@okaxis", normalize: trim, valid: (s) => /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/.test(s), error: "Enter a valid UPI ID, e.g. name@okaxis" },
  inAcct: { key: "bankAcct", label: "Account number", placeholder: "123456789012", normalize: digits, valid: (s) => /^\d{9,18}$/.test(s), error: "Indian account number: 9–18 digits", numeric: true },
  ifsc: { key: "ifsc", label: "IFSC code", placeholder: "SBIN0001234", normalize: upper, valid: (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s), error: "Enter a valid IFSC, e.g. SBIN0001234" },
  routing: { key: "routingNumber", label: "Routing number (ABA)", placeholder: "021000021", normalize: digits, valid: isValidAbaRouting, error: "Enter a valid 9-digit ABA routing number, e.g. 021000021", numeric: true },
  usAcct: { key: "bankAcct", label: "Account number", placeholder: "123456789", normalize: digits, valid: (s) => /^\d{4,17}$/.test(s), error: "US account number: 4–17 digits", numeric: true },
  aeIban: { key: "iban", label: "IBAN", placeholder: "AE07 0331 2345 6789 0123 456", normalize: normalizeIban, valid: isValidUaeIban, error: "Enter a valid UAE IBAN, e.g. AE07 0331 2345 6789 0123 456" },
  sepaIban: { key: "iban", label: "IBAN", placeholder: "DE89 3704 0044 0532 0130 00", normalize: normalizeIban, valid: isValidSepaIban, error: "Enter a valid euro-area IBAN, e.g. DE89 3704 0044 0532 0130 00" },
  sortCode: { key: "sortCode", label: "Sort code", placeholder: "20-00-00", normalize: digits, valid: (s) => /^\d{6}$/.test(s), error: "Sort code: 6 digits, e.g. 20-00-00", numeric: true },
  ukAcct: { key: "bankAcct", label: "Account number", placeholder: "55779911", normalize: digits, valid: (s) => /^\d{8}$/.test(s), error: "UK account number: 8 digits", numeric: true },
  jpBank: { key: "bankCode", label: "Bank code", placeholder: "0005", normalize: digits, valid: (s) => /^\d{4}$/.test(s), error: "Zengin bank code: 4 digits", numeric: true },
  jpBranch: { key: "branchCode", label: "Branch code", placeholder: "001", normalize: digits, valid: (s) => /^\d{3}$/.test(s), error: "Branch code: 3 digits", numeric: true },
  jpAcct: { key: "bankAcct", label: "Account number", placeholder: "1234567", normalize: digits, valid: (s) => /^\d{7}$/.test(s), error: "Japanese account number: 7 digits", numeric: true },
  email: { key: "email", label: "Interac e-mail", placeholder: "name@example.ca", normalize: (s) => s.trim().toLowerCase(), valid: (s) => /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/.test(s), error: "Enter a valid e-mail for Interac e-Transfer" },
  bsb: { key: "bsb", label: "BSB", placeholder: "062-000", normalize: digits, valid: (s) => /^\d{6}$/.test(s), error: "BSB: 6 digits, e.g. 062-000", numeric: true },
  auAcct: { key: "bankAcct", label: "Account number", placeholder: "12345678", normalize: digits, valid: (s) => /^\d{6,10}$/.test(s), error: "Australian account number: 6–10 digits", numeric: true },
  sgMobile: { key: "mobile", label: "PayNow mobile", placeholder: "+65 9123 4567", normalize: (s) => s.replace(/[\s-]/g, ""), valid: (s) => /^\+65[89]\d{7}$/.test(s), error: "Enter a Singapore mobile, e.g. +65 9123 4567" },
  phMobile: { key: "mobile", label: "GCash mobile", placeholder: "0917 123 4567", normalize: (s) => s.replace(/[\s-]/g, ""), valid: (s) => /^(\+63|0)9\d{9}$/.test(s), error: "Enter a Philippine mobile, e.g. 0917 123 4567" },
  clabe: { key: "clabe", label: "CLABE", placeholder: "002010077777777771", normalize: digits, valid: isValidClabe, error: "Enter a valid 18-digit CLABE", numeric: true },
} satisfies Record<string, FieldSpec>;

export interface RailInfo {
  label: string;
  short: string;
  help: string;
  refPrefix: string;
  refName: string;
  fields: FieldSpec[];
  /** A valid demo beneficiary, and one the (mock) bank rejects so the sender is refunded. */
  sample: Omit<RailRecipient, "name">;
  failSample: Omit<RailRecipient, "name">;
}

export const RAILS: Record<Rail, RailInfo> = {
  UPI: { label: "UPI", short: "UPI", help: "Instant to any UPI app", refPrefix: "UTR", refName: "UTR", fields: [F.upiId], sample: { upiId: "lakshmi@okaxis" }, failSample: { upiId: "fail@upi" } },
  IN_BANK: { label: "Indian bank account (IFSC)", short: "IMPS", help: "Any Indian bank via IFSC (IMPS)", refPrefix: "UTR", refName: "UTR", fields: [F.inAcct, F.ifsc], sample: { bankAcct: "123456789012", ifsc: "SBIN0001234" }, failSample: { bankAcct: "123456780000", ifsc: "SBIN0001234" } },
  US_ACH: { label: "US bank account", short: "ACH", help: "Any US bank via routing number (same-day ACH)", refPrefix: "ACH", refName: "ACH trace", fields: [F.routing, F.usAcct], sample: { routingNumber: "021000021", bankAcct: "123456789" }, failSample: { routingNumber: "021000021", bankAcct: "123450000" } },
  AE_IBAN: { label: "UAE bank account (IBAN)", short: "UAEFTS", help: "Any UAE bank via IBAN (UAEFTS)", refPrefix: "FTS", refName: "UAEFTS ref", fields: [F.aeIban], sample: { iban: "AE070331234567890123456" }, failSample: { iban: "AE050331234567890120000" } },
  SEPA: { label: "Euro bank account (SEPA IBAN)", short: "SEPA Instant", help: "Any euro-area bank via IBAN (SEPA Instant)", refPrefix: "SCT", refName: "SEPA end-to-end ID", fields: [F.sepaIban], sample: { iban: "DE89370400440532013000" }, failSample: { iban: "DE27500105170000000000" } },
  UK_FPS: { label: "UK bank account", short: "Faster Payments", help: "Any UK bank via sort code (Faster Payments)", refPrefix: "FPS", refName: "FPS ref", fields: [F.sortCode, F.ukAcct], sample: { sortCode: "200000", bankAcct: "55779911" }, failSample: { sortCode: "200000", bankAcct: "55770000" } },
  JP_ZENGIN: { label: "Japanese bank account", short: "Zengin", help: "Any Japanese bank via Zengin (bank + branch code)", refPrefix: "ZEN", refName: "Zengin ref", fields: [F.jpBank, F.jpBranch, F.jpAcct], sample: { bankCode: "0005", branchCode: "001", bankAcct: "1234567" }, failSample: { bankCode: "0005", branchCode: "001", bankAcct: "1230000" } },
  CA_INTERAC: { label: "Interac e-Transfer", short: "Interac", help: "To any Canadian bank by e-mail (Interac e-Transfer)", refPrefix: "INT", refName: "Interac ref", fields: [F.email], sample: { email: "olivia@example.ca" }, failSample: { email: "fail@example.ca" } },
  AU_NPP: { label: "Australian bank account", short: "NPP / Osko", help: "Any Australian bank via BSB (NPP / Osko)", refPrefix: "NPP", refName: "NPP ref", fields: [F.bsb, F.auAcct], sample: { bsb: "062000", bankAcct: "12345678" }, failSample: { bsb: "062000", bankAcct: "12340000" } },
  SG_PAYNOW: { label: "PayNow", short: "PayNow", help: "To any PayNow-registered mobile in Singapore", refPrefix: "PNW", refName: "PayNow ref", fields: [F.sgMobile], sample: { mobile: "+6591234567" }, failSample: { mobile: "+6591230000" } },
  PH_GCASH: { label: "GCash wallet", short: "GCash", help: "To any GCash wallet in the Philippines", refPrefix: "GCS", refName: "GCash ref", fields: [F.phMobile], sample: { mobile: "09171234567" }, failSample: { mobile: "09171230000" } },
  MX_SPEI: { label: "Mexican bank account (CLABE)", short: "SPEI", help: "Any Mexican bank via CLABE (SPEI)", refPrefix: "SPEI", refName: "SPEI tracking key", fields: [F.clabe], sample: { clabe: "002010077777777771" }, failSample: { clabe: "002010077770500000" } },
};

/** Payout rails available for each destination currency. */
export const RAILS_FOR = Object.fromEntries(CURRENCY_LIST.map((c) => [c.asset, c.rails])) as Record<AssetCode, Rail[]>;

export interface Corridor {
  id: string; // e.g. "AED-INR"
  from: AssetCode;
  to: AssetCode;
  label: string; // e.g. "United Arab Emirates → India"
  rails: Rail[];
}

export const CORRIDORS: Corridor[] = ALL_ASSETS.flatMap((from) =>
  ALL_ASSETS.filter((to) => to !== from).map((to) => ({
    id: `${CURRENCY[from].fiat}-${CURRENCY[to].fiat}`,
    from,
    to,
    label: `${CURRENCY[from].countryName} → ${CURRENCY[to].countryName}`,
    rails: RAILS_FOR[to],
  })),
);

export const corridorOf = (from: AssetCode, to: AssetCode) => CORRIDORS.find((c) => c.from === from && c.to === to);

const present = (r: RailRecipient, k: RailField) => !!r[k]?.trim();

/** Which rail a recipient uses for `dest`: the first of the destination's rails whose key field is filled. */
export function railOf(dest: AssetCode, r: RailRecipient): Rail | undefined {
  return RAILS_FOR[dest]?.find((rail) => present(r, RAILS[rail].fields[0].key)) ?? RAILS_FOR[dest]?.find((rail) => RAILS[rail].fields.some((f) => present(r, f.key)));
}

/** Returns a user-facing error, or undefined if the recipient can be paid in `dest`. */
export function validateRecipientFor(dest: AssetCode, r: RailRecipient): string | undefined {
  if (!r.name?.trim()) return "Enter the recipient's name";
  const cur = CURRENCY[dest];
  if (!cur) return "Unsupported destination currency";
  const rails = cur.rails;
  const railLabels = rails.map((x) => RAILS[x].label).join(" or ");
  const rail = railOf(dest, r);
  if (!rail) return `${cur.fiat} payouts need a ${railLabels}`;
  const allowed = new Set(RAILS[rail].fields.map((f) => f.key));
  if (RAIL_FIELDS.some((k) => present(r, k) && !allowed.has(k))) return `${cur.fiat} payouts go to ${/^[AEIOU]/.test(railLabels) ? "an" : "a"} ${railLabels}`;
  for (const f of RAILS[rail].fields) {
    const v = r[f.key];
    if (!v || !f.valid(f.normalize(v))) return f.error;
  }
  return undefined;
}

/** Canonical form for storage (strips spaces/dashes, upper-cases IBAN/IFSC…). */
export function normalizeRecipient<T extends RailRecipient>(dest: AssetCode, r: T): T {
  const rail = railOf(dest, r);
  const out = { ...r, name: r.name.trim() };
  if (rail) for (const f of RAILS[rail].fields) if (out[f.key]) out[f.key] = f.normalize(out[f.key]!);
  return out;
}

/** Short display of where the money goes. */
export function recipientLine(r: RailRecipient): string {
  const tail = (s?: string) => `••${(s ?? "").slice(-4)}`;
  if (r.upiId) return `UPI · ${r.upiId}`;
  if (r.iban) return `IBAN ${tail(normalizeIban(r.iban))}`;
  if (r.routingNumber) return `ACH ${tail(r.bankAcct)} · RTN ${r.routingNumber}`;
  if (r.sortCode) return `UK ${tail(r.bankAcct)} · sort ${r.sortCode}`;
  if (r.bankCode) return `Zengin ${r.bankCode}-${r.branchCode ?? ""} ${tail(r.bankAcct)}`;
  if (r.bsb) return `BSB ${r.bsb} ${tail(r.bankAcct)}`;
  if (r.email) return `Interac · ${r.email}`;
  if (r.mobile) return `Mobile ${tail(r.mobile)}`;
  if (r.clabe) return `CLABE ${tail(r.clabe)}`;
  return `Bank ${tail(r.bankAcct)}${r.ifsc ? ` · ${r.ifsc}` : ""}`;
}

/** The account identifier used for sanctions screening / Travel Rule. */
export function beneficiaryAccount(r: RailRecipient): string {
  return RAIL_FIELDS.filter((k) => r[k]).map((k) => (k === "iban" ? normalizeIban(r[k]!) : r[k]!)).join(":");
}

/** Display amount with its currency symbol, e.g. "₹2,514.00", "$27.10", "¥4,210". */
export function money(asset: AssetCode, amount: string | number, fmtFn: (v: string | number, dp?: number) => string, dp?: number): string {
  return `${CURRENCY[asset].symbol}${fmtFn(amount, dp ?? CURRENCY[asset].dp)}`;
}
