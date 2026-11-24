"use client";
import { useState } from "react";
import { Big, fmt, stroopsToXlm } from "@remit/shared/money";
import { TERMINAL, type TransferStatus } from "@remit/shared/transfer";
import { api, type AppConfig, type Health, type Quote, type TransferView } from "@/lib/api";
import { relTime } from "@/lib/useLive";
import { useView } from "@/lib/view";
import { Badge, FIAT_LABEL, STATUS_META, Spinner, short } from "./ui";

const HAPPY: TransferStatus[] = ["CREATED", "COMPLIANCE_CHECK", "APPROVED", "SUBMITTED", "SETTLED_ON_CHAIN", "PAYOUT_PENDING", "PAYOUT_COMPLETE"];
const HOP_LABEL: Record<string, string> = { tAED: "AED token", tUSDC: "USDC token", tINR: "INR token", XLM: "XLM" };

function Route({ hops, amount, best }: { hops: string[]; amount?: string; best: boolean }) {
  const { compact } = useView();
  return (
    <div className={`flex items-center gap-2 ${best ? "" : "opacity-40 grayscale"}`}>
      {hops.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <div className="flex flex-col items-center">
              <span className={`text-[9px] uppercase tracking-wider ${best ? "text-emerald-400" : "text-zinc-500"}`}>swap</span>
              <span className={`h-0.5 ${compact ? "w-6" : "w-10"} ${best ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-zinc-600"}`} />
            </div>
          )}
          <div className={`rounded-xl border text-center ${compact ? "px-2 py-1" : "px-3 py-2"} ${best ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-700 bg-zinc-800"}`}>
            <div className="text-sm font-bold text-white">{FIAT_LABEL[h] ?? h}</div>
            <div className="text-[9px] text-zinc-400">{HOP_LABEL[h] ?? h}</div>
          </div>
        </div>
      ))}
      {amount && (
        <div className={`ml-auto text-right font-mono text-sm tabular-nums ${best ? "font-semibold text-emerald-300" : "text-zinc-400 line-through decoration-zinc-500"}`}>
          ₹{fmt(amount)}
          <div className="text-[9px] font-sans font-medium uppercase tracking-wider no-underline">{best ? "chosen" : "rejected"}</div>
        </div>
      )}
    </div>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const { compact } = useView();
  return (
    <section className={`rounded-2xl border border-white/10 bg-zinc-900/80 ${compact ? "p-3" : "p-4"}`}>
      <div className={`flex ${compact ? "mb-2" : "mb-3"} items-center justify-between`}>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

interface Props {
  quote?: Quote;
  transfer?: TransferView;
  transfers: TransferView[];
  config?: AppConfig;
  health?: Health;
  onSelect: (id: string) => void;
  micro: { senderId: string; recipient: { name: string; upiId: string } };
  batchIds: string[];
  onBatch: (ids: string[]) => void;
  allTransfers: Record<string, TransferView>;
}

export function CenterPanel({ quote, transfer, transfers, config, health, onSelect, micro, batchIds, onBatch, allTransfers }: Props) {
  const { compact } = useView();
  const [microBusy, setMicroBusy] = useState(false);
  const [microErr, setMicroErr] = useState<string>();

  // Route: show the selected transfer's route, else the live quote.
  const route = transfer
    ? { best: transfer.route, bestAmt: transfer.receivedAmount ?? transfer.quotedDest, rejected: transfer.rejectedRoutes }
    : quote
      ? { best: quote.best.hops.map((h) => h.code), bestAmt: quote.best.destAmount, rejected: quote.rejected.map((r) => ({ route: r.hops.map((h) => h.code), destAmount: r.destAmount })) }
      : undefined;

  // Comparison numbers
  const fx = health?.fx;
  const t = transfer;
  let cmp: undefined | { send: string; asset: string; mid: Big; tradRecv: Big; tradFee: Big; engRecv: Big; engFeeXlm: string; engFeeUsd: string; secs?: number; final: boolean; costPct: Big };
  if (t && fx && config) {
    const usdPer = t.sendAsset === "tUSDC" ? new Big(1) : new Big(1).div(fx.aedPerUsd);
    const mid = usdPer.times(fx.inrPerUsd);
    const ideal = new Big(t.sendAmount).times(mid);
    const feePct = new Big(config.traditional.FEE_PCT).div(100);
    const engRecv = new Big(t.receivedAmount ?? t.quotedDest);
    const feeStroops = t.feeStroops ?? "100";
    const created = t.events[0]?.at;
    const paid = t.events.find((e) => e.status === "PAYOUT_COMPLETE")?.at;
    cmp = {
      send: t.sendAmount,
      asset: FIAT_LABEL[t.sendAsset],
      mid,
      tradRecv: ideal.times(new Big(1).minus(feePct)),
      tradFee: new Big(t.usdEquiv).times(feePct),
      engRecv,
      engFeeXlm: stroopsToXlm(feeStroops),
      engFeeUsd: new Big(stroopsToXlm(feeStroops)).times(config.xlmUsdReference).toFixed(6),
      secs: created && paid ? (paid - created) / 1000 : undefined,
      final: !!t.receivedAmount,
      costPct: ideal.isZero() ? new Big(0) : ideal.minus(engRecv).div(ideal).times(100),
    };
  }

  // Timeline
  const events = t?.events ?? [];
  const reached = new Set(events.map((e) => e.status));
  const pending = t && !TERMINAL.includes(t.status) && HAPPY.includes(t.status) ? HAPPY.filter((s) => !reached.has(s)) : [];

  // Micro batch summary
  const batch = batchIds.map((id) => allTransfers[id]).filter(Boolean);
  const batchPaid = batch.filter((b) => b.status === "PAYOUT_COMPLETE");
  const batchFee = batch.reduce((a, b) => a.plus(b.feeStroops ?? 0), new Big(0));

  async function runMicro() {
    setMicroBusy(true);
    setMicroErr(undefined);
    try {
      const r = await api<{ transferIds: string[] }>("/transfer/batch", {
        body: { senderId: micro.senderId, sendAsset: "tUSDC", amountEach: "5", count: 10, recipient: micro.recipient },
      });
      onBatch(r.transferIds);
    } catch (e) {
      setMicroErr((e as Error).message);
    } finally {
      setMicroBusy(false);
    }
  }

  return (
    <div className={`flex flex-col overflow-y-auto pr-1 ${compact ? "h-[calc(100vh-64px)] min-h-[500px] gap-2.5" : "h-[calc(100vh-130px)] min-h-[660px] gap-3"}`}>
      <Card
        title="Liquidity route"
        right={route && <span className="text-[11px] text-zinc-500">{t ? `transfer ${t.id}` : "live quote"} · Stellar path payment (atomic)</span>}
      >
        {route ? (
          <div className={compact ? "space-y-2" : "space-y-3"}>
            <Route hops={route.best} amount={route.bestAmt} best />
            {route.rejected.map((r, i) => (
              <Route key={i} hops={r.route} amount={r.destAmount} best={false} />
            ))}
            {route.rejected.length === 0 && <div className="text-xs text-zinc-500">Only one route available for this amount.</div>}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">Enter an amount to see routing.</div>
        )}
      </Card>

      <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-1 xl:grid-cols-2"}`}>
        <Card title="Traditional wire (illustrative)">
          {cmp && config ? (
            <div className="space-y-2">
              <div className={`font-bold tabular-nums text-zinc-300 ${compact ? "text-2xl" : "text-3xl"}`}>₹{fmt(cmp.tradRecv)}</div>
              <dl className="space-y-1 text-xs text-zinc-400">
                <div className="flex justify-between"><dt>Fees + FX markup</dt><dd className="tabular-nums">{config.traditional.FEE_PCT}% ≈ ${fmt(cmp.tradFee)}</dd></div>
                <div className="flex justify-between"><dt>Arrives in</dt><dd>{config.traditional.SETTLEMENT}</dd></div>
                <div className="flex justify-between"><dt>Intermediaries</dt><dd>2–4 correspondent banks</dd></div>
              </dl>
              <a href={config.traditional.SOURCE_URL} target="_blank" rel="noreferrer" className="block text-[10px] leading-snug text-zinc-500 underline decoration-dotted">
                Source: {config.traditional.SOURCE}
              </a>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">Send a transfer to compare.</div>
          )}
        </Card>
        <Card title="This engine (actual, on-chain)" right={cmp && !cmp.final && <Badge tone="blue">quoted</Badge>}>
          {cmp ? (
            <div className="space-y-2">
              <div className={`font-bold tabular-nums text-emerald-300 ${compact ? "text-2xl" : "text-3xl"}`}>₹{fmt(cmp.engRecv)}</div>
              <dl className="space-y-1 text-xs text-zinc-400">
                <div className="flex justify-between"><dt>Network fee</dt><dd className="tabular-nums">{cmp.engFeeXlm} XLM ≈ ${cmp.engFeeUsd}</dd></div>
                <div className="flex justify-between"><dt>Pool fees + spread vs mid</dt><dd className="tabular-nums">{fmt(cmp.costPct, 2)}%</dd></div>
                <div className="flex justify-between"><dt>Sent → paid out</dt><dd className="tabular-nums">{cmp.secs !== undefined ? `${cmp.secs.toFixed(1)} s` : "…"}</dd></div>
              </dl>
              <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-xs font-semibold text-emerald-300">
                Family receives ₹{fmt(cmp.engRecv.minus(cmp.tradRecv))} more
              </div>
              <div className="text-[10px] text-zinc-500">Fee in USD uses a reference XLM price of ${config?.xlmUsdReference}; testnet XLM has no market price.</div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">Send a transfer to compare.</div>
          )}
        </Card>
      </div>

      <Card
        title="Settlement timeline"
        right={t?.txHash && config && (
          <a href={`${config.explorer}/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-sky-400 underline">
            tx {short(t.txHash)} ↗
          </a>
        )}
      >
        {t ? (
          <ol className={`relative border-l ${compact ? "space-y-1.5" : "space-y-2"} border-zinc-700 pl-4`}>
            {events.map((e, i) => {
              const m = STATUS_META[e.status];
              const dt = i === 0 ? 0 : (e.at - events[0].at) / 1000;
              return (
                <li key={i} className="relative">
                  <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${m.tone === "red" ? "bg-rose-500" : m.tone === "amber" ? "bg-amber-400" : m.tone === "green" ? "bg-emerald-400" : "bg-sky-400"}`} />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-100">{m.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-500">+{dt.toFixed(1)}s</span>
                  </div>
                  {e.detail && <div className="text-[11px] text-zinc-400">{e.detail}</div>}
                </li>
              );
            })}
            {pending.map((s) => (
              <li key={s} className="relative opacity-35">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border border-zinc-500" />
                <span className="text-sm text-zinc-400">{STATUS_META[s].label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-sm text-zinc-500">No transfer selected.</div>
        )}
      </Card>

      <Card title="Micro-remittance: 10 × $5" right={<span className="text-[11px] text-zinc-500">one ledger, ten separate payouts</span>}>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={runMicro} disabled={microBusy} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
            {microBusy ? <Spinner /> : "Send 10 × $5"}
          </button>
          {batch.length > 0 && config && (
            <div className="text-xs text-zinc-300">
              <span className="font-semibold text-emerald-300">{batchPaid.length}/{batch.length} paid out</span> · total network fee{" "}
              <span className="font-mono">{stroopsToXlm(batchFee.toFixed(0))} XLM</span> (≈ ${new Big(stroopsToXlm(batchFee.toFixed(0))).times(config.xlmUsdReference).toFixed(5)}) vs ≈ $
              {fmt(new Big(50).times(config.traditional.FEE_PCT).div(100))} at {config.traditional.FEE_PCT}%
            </div>
          )}
        </div>
        {batch.length > 0 && (
          <div className="mt-2 flex gap-1">
            {batch.map((b) => (
              <button key={b.id} onClick={() => onSelect(b.id)} title={`${b.id} ${b.status}`} className={`h-2.5 flex-1 rounded-full ${b.status === "PAYOUT_COMPLETE" ? "bg-emerald-400" : TERMINAL.includes(b.status) ? "bg-rose-500" : "animate-pulse bg-sky-500"}`} />
            ))}
          </div>
        )}
        {microErr && <div className="mt-2 text-xs text-rose-400">{microErr}</div>}
      </Card>

      <Card title="Recent transfers">
        <div className="divide-y divide-white/5">
          {transfers.slice(0, compact ? 8 : 12).map((x) => (
            <button key={x.id} onClick={() => onSelect(x.id)} className={`flex w-full items-center justify-between gap-2 py-1.5 text-left text-xs hover:bg-white/5 ${x.id === t?.id ? "bg-white/5" : ""}`}>
              <span className="font-mono text-zinc-500">{x.id}</span>
              <span className="truncate text-zinc-300">
                {x.senderName.split(" ")[0]} → {x.recipient.name.split(" ")[0]} · {FIAT_LABEL[x.sendAsset]} {fmt(x.sendAmount)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-zinc-600">{relTime(x.createdAt)}</span>
                <Badge tone={STATUS_META[x.status].tone}>{STATUS_META[x.status].label}</Badge>
              </span>
            </button>
          ))}
          {transfers.length === 0 && <div className="text-sm text-zinc-500">None yet.</div>}
        </div>
      </Card>
    </div>
  );
}
