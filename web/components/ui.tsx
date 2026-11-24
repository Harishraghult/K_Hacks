"use client";
import type { ReactNode } from "react";
import type { TransferStatus } from "@remit/shared";
import { useView } from "@/lib/view";

export function Phone({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { compact } = useView();
  return (
    <div
      className={`mx-auto w-full border border-white/10 bg-zinc-800 shadow-2xl shadow-black/50 ${compact ? "max-w-[340px] rounded-[1.9rem] p-1.5" : "max-w-[380px] rounded-[2.6rem] p-2.5"}`}
    >
      <div
        className={`flex flex-col overflow-hidden bg-white text-zinc-900 ${compact ? "h-[calc(100vh-70px)] min-h-[500px] rounded-[1.5rem]" : "h-[calc(100vh-150px)] min-h-[640px] rounded-[2.1rem]"}`}
      >
        {!compact && (
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold opacity-60">
            <span>9:41</span>
            <span className="h-4 w-20 rounded-full bg-zinc-900/90" />
            <span>5G ▮▮▮</span>
          </div>
        )}
        <div className={compact ? "px-4 pb-2 pt-3" : "px-5 pb-3 pt-2"}>
          <div className={`font-semibold leading-tight ${compact ? "text-base" : "text-lg"}`}>{title}</div>
          {subtitle && <div className="text-xs opacity-60">{subtitle}</div>}
        </div>
        <div className={`flex-1 overflow-y-auto ${compact ? "px-4 pb-3" : "px-5 pb-5"}`}>{children}</div>
        {footer && <div className={`border-t border-zinc-100 bg-white ${compact ? "px-4 py-2.5" : "px-5 py-3"}`}>{footer}</div>}
      </div>
    </div>
  );
}

const TONES = {
  green: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-100 text-amber-800 ring-amber-600/20",
  red: "bg-rose-100 text-rose-800 ring-rose-600/20",
  blue: "bg-sky-100 text-sky-800 ring-sky-600/20",
  grey: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export const STATUS_META: Record<TransferStatus, { label: string; tone: Tone; senderText: string }> = {
  CREATED: { label: "Created", tone: "grey", senderText: "Preparing…" },
  COMPLIANCE_CHECK: { label: "Compliance check", tone: "blue", senderText: "Running safety checks…" },
  BLOCKED: { label: "Blocked", tone: "red", senderText: "Transfer blocked" },
  FLAGGED_FOR_REVIEW: { label: "Flagged for review", tone: "amber", senderText: "Under review by our compliance team" },
  EXPIRED: { label: "Review expired", tone: "grey", senderText: "Review window expired — nothing was charged" },
  APPROVED: { label: "Approved", tone: "blue", senderText: "Approved, sending…" },
  SUBMITTED: { label: "Submitted to Stellar", tone: "blue", senderText: "Sending…" },
  ON_CHAIN_FAILED: { label: "Rejected on-chain", tone: "red", senderText: "Transfer failed — nothing was charged" },
  SETTLED_ON_CHAIN: { label: "Settled on-chain", tone: "green", senderText: "Delivered to India partner" },
  PAYOUT_PENDING: { label: "Payout pending", tone: "blue", senderText: "Crediting recipient's account…" },
  PAYOUT_COMPLETE: { label: "Paid out", tone: "green", senderText: "Delivered" },
  PAYOUT_FAILED: { label: "Payout failed", tone: "red", senderText: "Recipient bank rejected the credit" },
  REFUND_PENDING: { label: "Refund pending", tone: "amber", senderText: "Returning your money…" },
  REFUNDED: { label: "Refunded", tone: "amber", senderText: "Refunded to your wallet" },
  REFUND_FAILED: { label: "Refund failed", tone: "red", senderText: "Refund needs manual action — support notified" },
};

export const FIAT_LABEL: Record<string, string> = { tUSDC: "USD", tAED: "AED", tINR: "INR" };
export const FIAT_SYMBOL: Record<string, string> = { tUSDC: "$", tAED: "AED ", tINR: "₹" };

export function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />;
}

export function short(s: string, n = 6) {
  return s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}
