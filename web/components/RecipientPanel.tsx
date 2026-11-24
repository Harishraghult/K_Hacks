"use client";
import { Big, fmt } from "@remit/shared/money";
import type { TransferView } from "@/lib/api";
import { relTime } from "@/lib/useLive";
import { Phone } from "./ui";

/** Recipient's banking app. No crypto vocabulary on this screen. */
export function RecipientPanel({ name, upiId, transfers }: { name: string; upiId: string; transfers: TransferView[] }) {
  const mine = transfers
    .filter((t) => t.recipient.upiId?.toLowerCase() === upiId.toLowerCase())
    .filter((t) => ["PAYOUT_PENDING", "PAYOUT_COMPLETE", "PAYOUT_FAILED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"].includes(t.status))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const credited = mine.filter((t) => t.status === "PAYOUT_COMPLETE");
  const today = credited.reduce((a, t) => a.plus(t.receivedAmount ?? 0), new Big(0));
  const latest = mine[0];
  const fresh = latest && Date.now() - latest.updatedAt < 15000;

  return (
    <Phone title={name ? `Hi, ${name.split(" ")[0]}` : "UPI"} subtitle={upiId || "Enter a UPI ID"}>
      {latest && fresh && (
        <div key={`${latest.id}-${latest.status}`} className="animate-[drop_0.5s_ease-out] mb-4 rounded-2xl bg-zinc-900 p-3 text-white shadow-xl">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[10px] font-bold text-white">₹</span>
            Bank alert · now
          </div>
          {latest.status === "PAYOUT_COMPLETE" ? (
            <div className="text-sm">
              <b>₹{fmt(latest.receivedAmount ?? latest.quotedDest)}</b> credited to your UPI {upiId}. From {latest.senderName}. Ref: {latest.payoutRef}
            </div>
          ) : latest.status === "PAYOUT_PENDING" ? (
            <div className="text-sm">Incoming money from {latest.senderName}… crediting now</div>
          ) : (
            <div className="text-sm">A transfer from {latest.senderName} could not be credited to {upiId}. The sender has been refunded.</div>
          )}
        </div>
      )}

      <div className="mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-4 text-white">
        <div className="text-xs opacity-80">Received from abroad</div>
        <div className="text-3xl font-bold tabular-nums">₹{fmt(today)}</div>
        <div className="text-xs opacity-80">{credited.length} credit{credited.length === 1 ? "" : "s"} · Savings account ••4821</div>
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Transactions</div>
      <ul className="divide-y divide-zinc-100">
        {mine.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${t.status === "PAYOUT_COMPLETE" ? "bg-emerald-100 text-emerald-700" : t.status === "PAYOUT_PENDING" ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"}`}>
              {t.senderName[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.senderName}</div>
              <div className="truncate text-[11px] text-zinc-500">
                {t.status === "PAYOUT_COMPLETE" ? `UPI · ${t.payoutRef}` : t.status === "PAYOUT_PENDING" ? "Processing…" : "Failed · returned to sender"} · {relTime(t.updatedAt)}
              </div>
            </div>
            <div className={`text-sm font-semibold tabular-nums ${t.status === "PAYOUT_COMPLETE" ? "text-emerald-700" : "text-zinc-400 line-through"}`}>+₹{fmt(t.receivedAmount ?? t.quotedDest)}</div>
          </li>
        ))}
        {mine.length === 0 && <li className="py-6 text-center text-sm text-zinc-400">No credits yet</li>}
      </ul>
    </Phone>
  );
}
