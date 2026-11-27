"use client";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { TransferStatus } from "@remit/shared/transfer";
import { fmt } from "@remit/shared/money";
import {
  ASSET_OF_FIAT,
  CURRENCY,
  CURRENCY_LIST,
  FIATS as ALL_FIATS,
  RAILS,
  recipientLine as railLine,
  validateRecipientFor,
  type Rail,
  type RailField,
  type RailRecipient,
} from "@remit/shared/corridors";
import type { AssetCode, FiatCode, TransferView } from "@/lib/api";

export const CUR: Record<string, string> = Object.fromEntries(CURRENCY_LIST.map((c) => [c.asset, c.fiat]));
export const ASSET_OF: Record<FiatCode, AssetCode> = ASSET_OF_FIAT;
export const FIATS: FiatCode[] = [...ALL_FIATS];
export const FIAT_NAME: Record<FiatCode, string> = Object.fromEntries(CURRENCY_LIST.map((c) => [c.fiat, c.name])) as Record<FiatCode, string>;

/** "₹2,514.00", "$27.10", "¥4,210" (pass dp for rates) */
export function amt(asset: string, v: string | number, dp?: number) {
  const c = CURRENCY[asset as AssetCode];
  return `${c?.symbol ?? ""}${fmt(v, dp ?? c?.dp ?? 2)}`;
}
export const countryOf = (asset: string) => CURRENCY[asset as AssetCode]?.countryName ?? "";

/** The currency a saved recipient is paid in (first currency whose rail accepts their details). */
export function destOfRecipient(r: RailRecipient): FiatCode | undefined {
  return CURRENCY_LIST.find((c) => !validateRecipientFor(c.asset, r))?.fiat;
}

/** Currency dropdown with flags, built from the registry. */
export function CurrencySelect({ value, onChange, exclude, id, className = "", label = "name" }: { value: FiatCode; onChange: (f: FiatCode) => void; exclude?: FiatCode; id?: string; className?: string; label?: "code" | "name" }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as FiatCode)} className={className} aria-label="Currency">
      {CURRENCY_LIST.filter((c) => c.fiat !== exclude).map((c) => (
        <option key={c.fiat} value={c.fiat}>
          {c.flag} {c.fiat}
          {label === "name" ? ` · ${c.name}` : ""}
        </option>
      ))}
    </select>
  );
}

export type RailForm = Record<RailField | "name", string>;
export const emptyRailForm = (): RailForm => ({ name: "", upiId: "", bankAcct: "", ifsc: "", routingNumber: "", iban: "", sortCode: "", bankCode: "", branchCode: "", bsb: "", email: "", mobile: "", clabe: "" });

/** Recipient object for one rail (only that rail's fields). */
export function recipientFor(rail: Rail, f: RailForm): RailRecipient {
  const out: RailRecipient = { name: f.name.trim() };
  for (const spec of RAILS[rail].fields) out[spec.key] = f[spec.key].trim();
  return out;
}

/** Input fields for a payout rail, generated from its field spec, with demo test values underneath. */
export function RailFields({ rail, form, setForm }: { rail: Rail; form: RailForm; setForm: (f: RailForm) => void }) {
  const info = RAILS[rail];
  const sample = Object.values(info.sample).join(" / ");
  const fail = Object.values(info.failSample).join(" / ");
  return (
    <div>
      <div className={`grid gap-3 ${info.fields.length === 1 ? "grid-cols-1" : info.fields.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {info.fields.map((spec) => (
          <Field key={spec.key} label={spec.label} id={`recipient-${spec.key}`}>
            <Input id={`recipient-${spec.key}`} name={spec.key} value={form[spec.key]} onChange={(e) => setForm({ ...form, [spec.key]: e.target.value })} placeholder={spec.placeholder} inputMode={"numeric" in spec && spec.numeric ? "numeric" : undefined} />
          </Field>
        ))}
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        Testing: <span className="font-mono">{sample}</span> works · <span className="font-mono">{fail}</span> is rejected by the bank (you get refunded)
        {rail === "UPI" ? " · blocked@upi is on a sanctions list" : rail === "AE_IBAN" ? " · AE850331234567890999999 is on a sanctions list" : ""}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-zinc-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function Button({ variant = "primary", className = "", children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-zinc-300",
    secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:opacity-50",
    ghost: "text-zinc-600 hover:bg-zinc-100 disabled:opacity-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50",
  }[variant];
  return (
    <button type={type} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, error, id, children }: { label: string; hint?: string; error?: string; id?: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15";
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Alert({ tone, children }: { tone: "error" | "warn" | "info" | "ok"; children: ReactNode }) {
  const c = { error: "border-rose-200 bg-rose-50 text-rose-800", warn: "border-amber-200 bg-amber-50 text-amber-900", info: "border-sky-200 bg-sky-50 text-sky-900", ok: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${c}`}>{children}</div>;
}

// ---------------- customer-friendly status ----------------

type Tone = "green" | "blue" | "amber" | "red" | "grey";
export const STATUS: Record<TransferStatus, { label: string; tone: Tone; help: string }> = {
  CREATED: { label: "Processing", tone: "blue", help: "We've received your transfer." },
  COMPLIANCE_CHECK: { label: "Processing", tone: "blue", help: "Running our standard security checks." },
  APPROVED: { label: "Processing", tone: "blue", help: "Checks passed. Sending now." },
  SUBMITTED: { label: "On its way", tone: "blue", help: "Your money is crossing the border." },
  SETTLED_ON_CHAIN: { label: "On its way", tone: "blue", help: "Arrived at our payout partner in the destination country." },
  PAYOUT_PENDING: { label: "Crediting", tone: "blue", help: "Crediting your recipient's account now." },
  PAYOUT_COMPLETE: { label: "Delivered", tone: "green", help: "Your recipient has the money." },
  FLAGGED_FOR_REVIEW: { label: "Under review", tone: "amber", help: "Larger transfers get a quick manual review, usually within minutes. Nothing has been taken from your balance yet." },
  EXPIRED: { label: "Cancelled", tone: "grey", help: "The review window passed. Nothing was charged." },
  BLOCKED: { label: "Not sent", tone: "red", help: "We couldn't send this transfer. Nothing was charged." },
  ON_CHAIN_FAILED: { label: "Not sent", tone: "red", help: "This transfer didn't go through. Nothing was charged." },
  PAYOUT_FAILED: { label: "Returning", tone: "amber", help: "The recipient's bank rejected the credit. We're returning your money." },
  REFUND_PENDING: { label: "Returning", tone: "amber", help: "Returning your money to your balance." },
  REFUNDED: { label: "Refunded", tone: "amber", help: "The recipient's bank rejected the credit, so we returned the money to your balance." },
  REFUND_FAILED: { label: "Needs attention", tone: "red", help: "We couldn't complete the refund automatically. Our team has been alerted." },
};

export function Pill({ status }: { status: TransferStatus }) {
  const s = STATUS[status];
  const c = { green: "bg-emerald-100 text-emerald-800", blue: "bg-sky-100 text-sky-800", amber: "bg-amber-100 text-amber-900", red: "bg-rose-100 text-rose-800", grey: "bg-zinc-100 text-zinc-700" }[s.tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{s.label}</span>;
}

const STEPS = [
  { key: "sent", label: "Sent", reached: ["CREATED", "COMPLIANCE_CHECK", "FLAGGED_FOR_REVIEW", "APPROVED", "SUBMITTED", "SETTLED_ON_CHAIN", "PAYOUT_PENDING", "PAYOUT_COMPLETE"] },
  { key: "checked", label: "Security check", reached: ["APPROVED", "SUBMITTED", "SETTLED_ON_CHAIN", "PAYOUT_PENDING", "PAYOUT_COMPLETE"] },
  { key: "moving", label: "Reached partner", reached: ["SETTLED_ON_CHAIN", "PAYOUT_PENDING", "PAYOUT_COMPLETE"] },
  { key: "done", label: "Delivered", reached: ["PAYOUT_COMPLETE"] },
];

/** 4-step progress tracker. Failure states replace the tracker with a clear message. */
export function Tracker({ t }: { t: TransferView }) {
  const failed = ["BLOCKED", "ON_CHAIN_FAILED", "EXPIRED", "PAYOUT_FAILED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"].includes(t.status);
  const current = STEPS.findIndex((s) => !s.reached.includes(t.status));
  const at = (statuses: string[]) => t.events.find((e) => statuses.includes(e.status))?.at;
  if (failed) {
    return (
      <div className={`rounded-xl p-4 ${STATUS[t.status].tone === "red" ? "bg-rose-50" : "bg-amber-50"}`}>
        <div className="font-semibold">{STATUS[t.status].label}</div>
        <div className="mt-1 text-sm text-zinc-700">{STATUS[t.status].help}</div>
        {t.reasons.length > 0 && t.status === "BLOCKED" && <div className="mt-1 text-xs text-zinc-500">Reason: {t.reasons.join("; ")}</div>}
        {t.errorMessage && t.status === "ON_CHAIN_FAILED" && <div className="mt-1 text-xs text-zinc-500">{t.errorMessage}</div>}
      </div>
    );
  }
  return (
    <ol className="grid grid-cols-4 gap-2">
      {STEPS.map((s, i) => {
        const done = s.reached.includes(t.status);
        const active = i === current;
        const ts = done ? at(i === 0 ? ["CREATED"] : i === 1 ? ["APPROVED"] : i === 2 ? ["SETTLED_ON_CHAIN"] : ["PAYOUT_COMPLETE"]) : undefined;
        return (
          <li key={s.key} className="flex flex-col items-center text-center">
            <div className="relative flex w-full items-center">
              <div className={`h-1 flex-1 rounded ${i === 0 ? "invisible" : done || active ? "bg-emerald-500" : "bg-zinc-200"}`} />
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-emerald-500 text-white" : active ? "border-2 border-emerald-500 bg-white text-emerald-600" : "border-2 border-zinc-200 bg-white text-zinc-400"}`}
              >
                {done ? "✓" : active ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className={`h-1 flex-1 rounded ${i === STEPS.length - 1 ? "invisible" : done && STEPS[i + 1].reached.includes(t.status) ? "bg-emerald-500" : "bg-zinc-200"}`} />
            </div>
            <div className={`mt-1.5 text-xs font-semibold ${done || active ? "text-zinc-900" : "text-zinc-400"}`}>
              {i === 1 && t.status === "FLAGGED_FOR_REVIEW" ? "Under review" : s.label}
            </div>
            {ts && <div className="text-[11px] text-zinc-500">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function dateTime(ms: number) {
  return new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function recipientLine(r: Partial<RailRecipient>) {
  return railLine({ ...r, name: r.name ?? "" });
}
