"use client";
import { useCallback, useEffect, useState } from "react";
import { fmt } from "@remit/shared/money";
import { api, type Health, type Sender, type TransferView, type Unmatched } from "@/lib/api";
import { relTime } from "@/lib/useLive";
import { Badge, FIAT_LABEL, Spinner, short } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  senders: Sender[];
  transfers: TransferView[];
  health?: Health;
  unmatchedTick: number;
  onSelect: (id: string) => void;
  refreshSenders: () => void;
}

export function AdminDrawer({ open, onClose, senders, transfers, health, unmatchedTick, onSelect, refreshSenders }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [claw, setClaw] = useState({ senderId: "SANCTIONED_1", asset: "tAED", amount: "100" });

  useEffect(() => setToken(localStorage.getItem("adminToken") ?? "demo-admin"), []);
  useEffect(() => {
    if (token) localStorage.setItem("adminToken", token);
  }, [token]);

  const loadUnmatched = useCallback(async () => {
    if (!token) return;
    try {
      setUnmatched(await api<Unmatched[]>("/admin/unmatched", { admin: token }));
    } catch {
      /* token wrong → shown on actions */
    }
  }, [token]);
  useEffect(() => {
    if (open) loadUnmatched();
  }, [open, unmatchedTick, loadUnmatched]);

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    setMsg(undefined);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      refreshSenders();
      loadUnmatched();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  const flagged = transfers.filter((t) => t.status === "FLAGGED_FOR_REVIEW");
  const clawSender = senders.find((s) => s.id === claw.senderId);

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/50 transition ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside className={`fixed right-0 top-0 z-50 h-full w-[440px] max-w-full overflow-y-auto border-l border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl transition-transform ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compliance & ops console</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/10" aria-label="Close">✕</button>
        </div>

        <label className="mb-4 block text-xs text-zinc-400">
          Admin token (hackathon-level shared secret)
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm" />
        </label>

        {msg && <div className={`mb-4 rounded-lg p-2 text-xs ${msg.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{msg.text}</div>}

        <Section title={`Review queue (${flagged.length})`}>
          {flagged.map((t) => (
            <div key={t.id} className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <button onClick={() => onSelect(t.id)} className="font-mono text-amber-300 underline">{t.id}</button>
              <div className="mt-1 text-zinc-300">
                {t.senderName} → {t.recipient.name} ({t.recipient.upiId}) · {FIAT_LABEL[t.sendAsset]} {fmt(t.sendAmount)} ≈ USD {fmt(t.usdEquiv)}
              </div>
              <div className="text-zinc-500">{t.reasons.join("; ")}</div>
              <div className="mt-2 flex gap-2">
                <button disabled={!!busy} onClick={() => run(`ap${t.id}`, () => api(`/admin/approve/${t.id}`, { method: "POST", admin: token }), `Approved ${t.id}`)} className="rounded-lg bg-emerald-600 px-3 py-1 font-semibold disabled:opacity-50">
                  {busy === `ap${t.id}` ? <Spinner /> : "Approve"}
                </button>
                <button disabled={!!busy} onClick={() => run(`rj${t.id}`, () => api(`/admin/reject/${t.id}`, { method: "POST", admin: token }), `Rejected ${t.id}`)} className="rounded-lg bg-zinc-700 px-3 py-1 font-semibold disabled:opacity-50">
                  Reject
                </button>
              </div>
            </div>
          ))}
          {flagged.length === 0 && <Empty>Nothing awaiting review. Transfers over USD 1,000 land here.</Empty>}
        </Section>

        <Section title="Sanctions & on-chain freeze">
          {senders.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="truncate">{s.name}</div>
                <div className="font-mono text-[10px] text-zinc-500">{short(s.publicKey)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {s.sanctioned && <Badge tone="red">listed</Badge>}
                {Object.values(s.balances).some((b) => b.frozen) && <Badge tone="red">frozen</Badge>}
                {s.sanctioned ? (
                  <button disabled={!!busy} onClick={() => run(`us${s.id}`, () => api("/admin/unsanction", { body: { publicKey: s.publicKey }, admin: token }), `${s.name} removed from list${s.kyc === "PASSED" ? " and re-authorized on-chain" : ""}`)} className="rounded-md bg-zinc-700 px-2 py-1 disabled:opacity-50">
                    {busy === `us${s.id}` ? <Spinner /> : "Delist"}
                  </button>
                ) : (
                  <button disabled={!!busy} onClick={() => run(`sa${s.id}`, () => api("/admin/sanction", { body: { publicKey: s.publicKey }, admin: token }), `${s.name} sanctioned; issuers revoked authorization on-chain`)} className="rounded-md bg-rose-600 px-2 py-1 disabled:opacity-50">
                    {busy === `sa${s.id}` ? <Spinner /> : "Sanction + freeze"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Clawback (issuer recovers frozen funds)">
          <div className="flex flex-wrap gap-2 text-xs">
            <select value={claw.senderId} onChange={(e) => setClaw({ ...claw, senderId: e.target.value })} className="rounded-lg bg-zinc-900 px-2 py-1">
              {senders.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select value={claw.asset} onChange={(e) => setClaw({ ...claw, asset: e.target.value })} className="rounded-lg bg-zinc-900 px-2 py-1">
              <option value="tAED">AED</option>
              <option value="tUSDC">USD</option>
            </select>
            <input value={claw.amount} onChange={(e) => setClaw({ ...claw, amount: e.target.value })} className="w-20 rounded-lg bg-zinc-900 px-2 py-1" />
            <button
              disabled={!!busy || !clawSender}
              onClick={() => run("claw", () => api("/admin/clawback", { body: { publicKey: clawSender!.publicKey, asset: claw.asset, amount: claw.amount }, admin: token }), `Clawed back ${claw.amount} ${claw.asset}`)}
              className="rounded-lg bg-rose-700 px-3 py-1 font-semibold disabled:opacity-50"
            >
              {busy === "claw" ? <Spinner /> : "Claw back"}
            </button>
          </div>
          {clawSender && <div className="mt-1 text-[11px] text-zinc-500">Balance: {fmt(clawSender.balances[claw.asset as "tAED"]?.balance ?? "0")} {FIAT_LABEL[claw.asset]}</div>}
        </Section>

        <Section title="Network enforcement demo">
          <p className="mb-2 text-[11px] text-zinc-400">Force-submit from the unverified wallet, skipping every backend check. Stellar itself must reject it (op_src_not_authorized).</p>
          <button
            disabled={!!busy}
            onClick={() =>
              run("force", async () => {
                const r = await api<{ transferId: string }>("/debug/force-transfer", { body: { senderId: "UNVERIFIED_1", sendAsset: "tAED", amount: "10" } });
                onSelect(r.transferId);
                onClose();
              }, "Force-submitted — watch the timeline")
            }
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-50"
          >
            {busy === "force" ? <Spinner /> : "Force-submit from UNVERIFIED wallet"}
          </button>
        </Section>

        <Section title={`Unmatched payments (${unmatched.length})`}>
          <button disabled={!!busy} onClick={() => run("stray", () => api("/admin/simulate-stray-payment", { body: {}, admin: token }), "Stray payment sent; it should appear here without a payout")} className="mb-2 rounded-lg bg-zinc-800 px-3 py-1 text-xs disabled:opacity-50">
            {busy === "stray" ? <Spinner /> : "Simulate stray payment (bad memo)"}
          </button>
          {unmatched.map((u) => (
            <div key={u.op_id} className="border-t border-white/5 py-1.5 text-[11px]">
              <div className="flex justify-between">
                <span>₹{fmt(u.amount)} · memo <span className="font-mono">{u.memo ?? "(none)"}</span></span>
                <span className="text-zinc-500">{relTime(u.at)}</span>
              </div>
              <div className="text-zinc-500">{u.reason} · <span className="font-mono">{short(u.tx_hash)}</span></div>
            </div>
          ))}
        </Section>

        <Section title="System health">
          {health ? (
            <>
            <dl className="space-y-1 text-[11px] text-zinc-400">
              <Row k="Horizon">{health.horizon.reachable ? `ledger #${health.horizon.latestLedger}` : "unreachable"}</Row>
              <Row k="Testnet accounts">{health.needsBootstrap ? `missing ${health.missingAccounts.join(", ")} — run npm run bootstrap` : "ok"}</Row>
              <Row k="Payment watcher">{health.watcher.connected ? "streaming" : "reconnecting"} · {health.watcher.reconnects} reconnects</Row>
              <Row k="Watcher cursor"><span className="font-mono">{health.watcher.cursor}</span></Row>
              <Row k="FX">1 USD = ₹{health.fx.inrPerUsd} ({health.fx.source}, {health.fx.asOf})</Row>
              {health.pools?.map((p) => (
                <Row key={p.id} k={`AMM ${p.pair}`}>
                  {p.price} vs mid {p.target}{" "}
                  <span className={Math.abs(Number(p.driftPct)) > 0.25 ? "text-amber-400" : "text-emerald-400"}>({p.driftPct}%)</span>
                </Row>
              ))}
            </dl>
            <button disabled={!!busy} onClick={() => run("rebal", () => api("/admin/rebalance", { body: {}, admin: token }), "Market maker re-centred pools at the FX mid")} className="mt-2 rounded-lg bg-zinc-800 px-3 py-1 text-xs disabled:opacity-50">
              {busy === "rebal" ? <Spinner /> : "Rebalance pools to FX mid"}
            </button>
            <p className="mt-1 text-[10px] text-zinc-500">Demo traffic flows one way and pushes pool prices off the mid; on mainnet arbitrage corrects this. Here the mock market maker does it automatically every minute.</p>
            </>
          ) : (
            <Empty>Loading…</Empty>
          )}
        </Section>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-zinc-500">{children}</div>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="text-right text-zinc-300">{children}</dd>
    </div>
  );
}
