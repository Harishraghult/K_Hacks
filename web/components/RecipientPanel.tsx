"use client";
import { Big, fmt } from "@remit/shared/money";
import { ALL_ASSETS, CURRENCY, RAILS, RAILS_FOR, recipientLine, railOf } from "@remit/shared/corridors";
import type { AssetCode, TransferView } from "@/lib/api";
import { relTime } from "@/lib/useLive";
import { recipientKey, toRecipient, type RecipientForm } from "./SenderPanel";
import { Phone } from "./ui";

const GRADIENTS = ["from-indigo-600 to-violet-600", "from-sky-600 to-blue-700", "from-emerald-600 to-teal-700", "from-rose-600 to-orange-600", "from-fuchsia-600 to-pink-600", "from-amber-600 to-red-600"];
const bankApp = (dest: AssetCode) => ({ gradient: GRADIENTS[ALL_ASSETS.indexOf(dest) % GRADIENTS.length] });

/** Recipient's banking app, in the destination country. No crypto vocabulary on this screen. */
export function RecipientPanel({ dest, recipient, transfers }: { dest: AssetCode; recipient: RecipientForm; transfers: TransferView[] }) {
  const me = toRecipient(dest, recipient);
  const key = recipientKey(dest, me);
  const cur = CURRENCY[dest];
  const rail = railOf(dest, me) ?? RAILS_FOR[dest][0];
  const mine = transfers
    .filter((t) => t.destAsset === dest && key && recipientKey(dest, t.recipient) === key)
    .filter((t) => ["PAYOUT_PENDING", "PAYOUT_COMPLETE", "PAYOUT_FAILED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"].includes(t.status))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const credited = mine.filter((t) => t.status === "PAYOUT_COMPLETE");
  const total = credited.reduce((a, t) => a.plus(t.receivedAmount ?? 0), new Big(0));
  const latest = mine[0];
  const fresh = latest && Date.now() - latest.updatedAt < 15000;
  const via = RAILS[rail].short;
  const subtitle = `${cur.flag} ${cur.countryName} · ${recipientLine(me)}`;
  const m = (v: string | number | Big) => `${cur.symbol}${fmt(v as string, cur.dp)}`;

  return (
    <Phone title={recipient.name ? `Hi, ${recipient.name.split(" ")[0]}` : "Bank app"} subtitle={subtitle}>
      {latest && fresh && (
        <div key={`${latest.id}-${latest.status}`} className="animate-[drop_0.5s_ease-out] mb-4 rounded-2xl bg-zinc-900 p-3 text-white shadow-xl">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[10px] font-bold text-white">{cur.symbol.trim().slice(0, 1)}</span>
            Bank alert · now
          </div>
          {latest.status === "PAYOUT_COMPLETE" ? (
            <div className="text-sm">
              <b>{m(latest.receivedAmount ?? latest.quotedDest)}</b> credited via {via}. From {latest.senderName}. Ref: {latest.payoutRef}
            </div>
          ) : latest.status === "PAYOUT_PENDING" ? (
            <div className="text-sm">Incoming money from {latest.senderName}… crediting now</div>
          ) : (
            <div className="text-sm">A transfer from {latest.senderName} could not be credited. The sender has been refunded.</div>
          )}
        </div>
      )}

      <div className={`mb-4 rounded-2xl bg-gradient-to-br ${bankApp(dest).gradient} p-4 text-white`}>
        <div className="text-xs opacity-80">Received from abroad</div>
        <div className="text-3xl font-bold tabular-nums">{m(total)}</div>
        <div className="text-xs opacity-80">
          {credited.length} credit{credited.length === 1 ? "" : "s"} · {RAILS[rail].label}
        </div>
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
                {t.status === "PAYOUT_COMPLETE" ? `${via} · ${t.payoutRef}` : t.status === "PAYOUT_PENDING" ? "Processing…" : "Failed · returned to sender"} · {relTime(t.updatedAt)}
              </div>
            </div>
            <div className={`text-sm font-semibold tabular-nums ${t.status === "PAYOUT_COMPLETE" ? "text-emerald-700" : "text-zinc-400 line-through"}`}>+{m(t.receivedAmount ?? t.quotedDest)}</div>
          </li>
        ))}
        {mine.length === 0 && <li className="py-6 text-center text-sm text-zinc-400">No credits yet</li>}
      </ul>
    </Phone>
  );
}
