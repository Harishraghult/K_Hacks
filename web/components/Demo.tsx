"use client";
import { useCallback, useMemo, useState } from "react";
import type { Quote } from "@/lib/api";
import { useLive } from "@/lib/useLive";
import { AdminDrawer } from "./AdminDrawer";
import { CenterPanel } from "./CenterPanel";
import { RecipientPanel } from "./RecipientPanel";
import { SenderPanel, type RecipientForm } from "./SenderPanel";

export function Demo() {
  const live = useLive();
  const [senderId, setSenderId] = useState("SENDER_1");
  const [recipient, setRecipient] = useState<RecipientForm>({ name: "Lakshmi Kumar", upiId: "lakshmi@okaxis", purpose: "Family support" });
  const [quote, setQuote] = useState<Quote>();
  const [focusId, setFocusId] = useState<string>();
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [adminOpen, setAdminOpen] = useState(false);

  const list = useMemo(() => Object.values(live.transfers).sort((a, b) => b.createdAt - a.createdAt), [live.transfers]);
  const focused = focusId ? live.transfers[focusId] : undefined;
  const flaggedCount = list.filter((t) => t.status === "FLAGGED_FOR_REVIEW").length;
  const onQuote = useCallback((q: Quote | undefined) => setQuote(q), []);
  const h = live.health;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e293b,_#09090b_60%)] px-5 pb-4 pt-3 text-zinc-100">
      <header className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Remit<span className="text-emerald-400">Rail</span>
          </h1>
          <p className="text-[11px] text-zinc-400">Compliant cross-border settlement on Stellar testnet: real path payments, mocked bank rails</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          <Dot ok={live.connected} label={live.connected ? "live" : "reconnecting"} />
          {h && <Dot ok={h.horizon.reachable} label={h.horizon.reachable ? `testnet ledger #${h.horizon.latestLedger}` : "Horizon unreachable"} />}
          {h && <Dot ok={h.watcher.connected} label="payout watcher" />}
          {h && (
            <span>
              1 USD = ₹{h.fx.inrPerUsd} · 1 USD = AED {h.fx.aedPerUsd}{" "}
              <span className={h.fx.source === "fallback" ? "text-amber-400" : ""}>(rate as of {h.fx.asOf})</span>
            </span>
          )}
          <button onClick={() => setAdminOpen(true)} className="relative rounded-lg border border-white/15 px-3 py-1.5 font-semibold text-zinc-200 hover:bg-white/10">
            Compliance console
            {flaggedCount > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{flaggedCount}</span>}
          </button>
        </div>
      </header>

      {live.offline && <Banner>⚠ {live.offline} Start it with <code>npm run anchor</code>.</Banner>}
      {h?.needsBootstrap && (
        <Banner>
          ⚠ Testnet accounts are missing ({h.missingAccounts.join(", ")}). The testnet was probably reset. Run <code>npm run demo:reset</code>.
        </Banner>
      )}

      <main className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(320px,380px)_1fr_minmax(320px,380px)]">
        <SenderPanel
          senders={live.senders}
          senderId={senderId}
          setSenderId={setSenderId}
          recipient={recipient}
          setRecipient={setRecipient}
          onQuote={onQuote}
          onSent={setFocusId}
          active={focused}
          refreshSenders={live.refreshSenders}
        />
        <CenterPanel
          quote={quote}
          transfer={focused}
          transfers={list}
          config={live.config}
          health={h}
          onSelect={setFocusId}
          micro={{ senderId, recipient: { name: recipient.name, upiId: recipient.upiId } }}
          batchIds={batchIds}
          onBatch={(ids) => {
            setBatchIds(ids);
            setFocusId(ids[0]);
          }}
          allTransfers={live.transfers}
        />
        <RecipientPanel name={recipient.name} upiId={recipient.upiId} transfers={list} />
      </main>

      <AdminDrawer
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        senders={live.senders}
        transfers={list}
        health={h}
        unmatchedTick={live.unmatchedTick}
        onSelect={setFocusId}
        refreshSenders={live.refreshSenders}
      />
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "animate-pulse bg-amber-400"}`} />
      {label}
    </span>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">{children}</div>;
}
