import type { AccountName, AssetCode, Fiat } from "@remit/shared";
import { db } from "./db.js";

/** Fictional demo senders. Keys are custodial (held by this server). */
export interface Persona {
  id: AccountName;
  name: string;
  city: string;
  bankCurrency: Fiat;
  bankStart: string;
  sendAssets: AssetCode[];
  kycAtStart: boolean;
  sanctionedAtStart: boolean;
  note?: string;
}

export const PERSONAS: Persona[] = [
  { id: "SENDER_1", name: "Ravi Kumar", city: "Dubai", bankCurrency: "AED", bankStart: "5000", sendAssets: ["tAED", "tUSDC", "tINR"], kycAtStart: true, sanctionedAtStart: false },
  { id: "SENDER_2", name: "Maria Santos", city: "Houston", bankCurrency: "USD", bankStart: "3000", sendAssets: ["tUSDC", "tAED", "tINR"], kycAtStart: true, sanctionedAtStart: false },
  { id: "SENDER_3", name: "Arjun Nair", city: "Abu Dhabi", bankCurrency: "AED", bankStart: "8000", sendAssets: ["tAED", "tUSDC", "tINR"], kycAtStart: true, sanctionedAtStart: false },
  { id: "SENDER_4", name: "Priya Sharma", city: "Bengaluru", bankCurrency: "INR", bankStart: "250000", sendAssets: ["tINR", "tUSDC", "tAED"], kycAtStart: true, sanctionedAtStart: false, note: "Sends from India: INR → AED / USD corridors" },
  { id: "SENDER_5", name: "Emma Müller", city: "Berlin", bankCurrency: "EUR", bankStart: "4000", sendAssets: ["tEUR", "tUSDC", "tINR"], kycAtStart: true, sanctionedAtStart: false, note: "Sends from the euro area: EUR → anywhere" },
  { id: "SENDER_6", name: "Kenji Sato", city: "Tokyo", bankCurrency: "JPY", bankStart: "600000", sendAssets: ["tJPY", "tUSDC", "tINR"], kycAtStart: true, sanctionedAtStart: false, note: "Sends from Japan: JPY → anywhere" },
  { id: "SANCTIONED_1", name: "Test Watchlisted", city: "Dubai", bankCurrency: "AED", bankStart: "5000", sendAssets: ["tAED", "tUSDC", "tINR"], kycAtStart: true, sanctionedAtStart: true, note: "On sanctions list: backend blocks; admin can freeze on-chain" },
  { id: "UNVERIFIED_1", name: "New User (no KYC)", city: "Dubai", bankCurrency: "AED", bankStart: "2000", sendAssets: ["tAED", "tUSDC", "tINR"], kycAtStart: false, sanctionedAtStart: false, note: "Never passed KYC: trustline not authorized on-chain" },
];

export const personaById = (id: string) => PERSONAS.find((p) => p.id === id);

/** Recipient identifiers on the mock sanctions list. */
export const SANCTIONED_RECIPIENTS = ["blocked@upi", "AE850331234567890999999"];
/** KYC deny list (mock provider rejects these names). */
export const KYC_DENY_NAMES = ["test watchlisted", "blocked person"];

export function seedDb(book: Record<string, { publicKey: string }>) {
  const now = Date.now();
  for (const p of PERSONAS) {
    const pub = book[p.id].publicKey;
    if (p.kycAtStart) db.prepare("INSERT OR IGNORE INTO kyc (public_key, name, status, at) VALUES (?, ?, 'PASSED', ?)").run(pub, p.name, now);
    if (p.sanctionedAtStart) db.prepare("INSERT OR IGNORE INTO sanctions (subject, kind, reason, at) VALUES (?, 'account', 'Seeded watchlist match', ?)").run(pub, now);
    db.prepare("INSERT OR IGNORE INTO bank (account_id, currency, balance) VALUES (?, ?, ?)").run(p.id, p.bankCurrency, p.bankStart);
  }
  for (const r of SANCTIONED_RECIPIENTS)
    db.prepare("INSERT OR IGNORE INTO sanctions (subject, kind, reason, at) VALUES (?, 'recipient', 'Seeded watchlist match', ?)").run(r, now);
}
