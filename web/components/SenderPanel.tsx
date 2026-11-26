"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AmountError, Big, fmt, parseAmount } from "@remit/shared/money";
import { TERMINAL } from "@remit/shared/transfer";
import { ApiError, api, type Quote, type Sender, type TransferView } from "@/lib/api";
import { useView } from "@/lib/view";
import { Badge, FIAT_LABEL, FIAT_SYMBOL, Phone, STATUS_META, Spinner } from "./ui";

export interface RecipientForm {
  name: string;
  upiId: string;
  purpose: string;
}

interface Props {
  senders: Sender[];
  senderId: string;
  setSenderId: (id: string) => void;
  recipient: RecipientForm;
  setRecipient: (r: RecipientForm) => void;
  onQuote: (q: Quote | undefined) => void;
  onSent: (transferId: string) => void;
  active?: TransferView;
  refreshSenders: () => void;
}

export function SenderPanel({ senders, senderId, setSenderId, recipient, setRecipient, onQuote, onSent, active, refreshSenders }: Props) {
  const sender = senders.find((s) => s.id === senderId);
  const { compact } = useView();
  const [asset, setAsset] = useState<"tAED" | "tUSDC">("tAED");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<Quote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  const [quoting, setQuoting] = useState(false);
  const [secsLeft, setSecsLeft] = useState(0);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "amber" | "green"; text: string }>();
  const [depositAmt, setDepositAmt] = useState("200");
  const [busy, setBusy] = useState<string>();
  const reqSeq = useRef(0);

  useEffect(() => {
    if (sender) setAsset(sender.defaultAsset);
    setMsg(undefined);
  }, [senderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountError = (() => {
    try {
      parseAmount(amount);
      return undefined;
    } catch (e) {
      return e instanceof AmountError ? e.message : "Invalid amount";
    }
  })();
  const balance = sender?.balances[asset];
  const overBalance = !amountError && balance && new Big(amount).gt(balance.balance);

  const fetchQuote = useCallback(async () => {
    if (amountError) {
      setQuote(undefined);
      onQuote(undefined);
      return;
    }
    const seq = ++reqSeq.current;
    setQuoting(true);
    try {
      const q = await api<Quote>(`/quote?sendAsset=${asset}&sendAmount=${encodeURIComponent(amount)}&destAsset=tINR`);
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setQuote(q);
      setQuoteErr(undefined);
      onQuote(q);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setQuote(undefined);
      onQuote(undefined);
      setQuoteErr((e as Error).message);
    } finally {
      if (seq === reqSeq.current) setQuoting(false);
    }
  }, [amount, asset, amountError, onQuote]);

  // Debounced re-quote on input change.
  useEffect(() => {
    const t = setTimeout(fetchQuote, 350);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  // Countdown + auto-refresh on expiry.
  useEffect(() => {
    if (!quote) {
      setSecsLeft(0);
      return;
    }
    const calc = () => Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000));
    setSecsLeft(calc());
    const t = setInterval(() => {
      const s = calc();
      setSecsLeft((prev) => (prev !== s ? s : prev));
    }, 1000);
    return () => clearInterval(t);
  }, [quote]);
  useEffect(() => {
    if (quote && secsLeft === 0 && !quoting && !sending) fetchQuote();
  }, [secsLeft, quote, quoting, sending, fetchQuote]);

  // Rate moved after submit: re-quote and ask the user to confirm again (never auto-resubmit).
  useEffect(() => {
    if (active?.status === "ON_CHAIN_FAILED" && active.errorCode === "op_under_dest_min") {
      setMsg({ tone: "amber", text: "The exchange rate moved before your transfer settled. Nothing was charged. Please review the new quote and send again." });
      fetchQuote();
    }
  }, [active?.status, active?.errorCode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!quote || !sender) return;
    setSending(true);
    setMsg(undefined);
    try {
      const r = await api<{ transferId: string; status: string }>("/transfer", {
        body: { quoteId: quote.quoteId, senderId: sender.id, recipient: { name: recipient.name, upiId: recipient.upiId }, purpose: recipient.purpose },
      });
      onSent(r.transferId);
      refreshSenders();
      fetchQuote(); // quotes are single-use
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "QUOTE_EXPIRED") {
        setMsg({ tone: "amber", text: "Your quote expired. Here's a fresh one — please confirm the new amount." });
        fetchQuote();
      } else setMsg({ tone: "red", text: err.message });
    } finally {
      setSending(false);
    }
  }

  async function action(name: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(name);
    setMsg(undefined);
    try {
      await fn();
      if (ok) setMsg({ tone: "green", text: ok });
      refreshSenders();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  const sym = FIAT_SYMBOL[asset];
  const activeMeta = active ? STATUS_META[active.status] : undefined;
  const activeDone = active && TERMINAL.includes(active.status);
  const sendDisabled = !quote || sending || !!amountError || !!overBalance || !recipient.name || !recipient.upiId;
  const field = `w-full rounded-lg border border-zinc-200 px-3 text-sm ${compact ? "py-1.5" : "py-2"}`;

  // Pinned to the bottom of the phone, so Send stays visible even on a short laptop screen.
  const footer = sender && (
    <div className="space-y-2">
      {msg && (
        <div className={`rounded-lg px-2.5 py-1.5 text-xs ${msg.tone === "red" ? "bg-rose-50 text-rose-700" : msg.tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>
      )}
      {active && active.senderId === sender.id && activeMeta && (
        <div className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {!activeDone && <Spinner />} {activeMeta.senderText}
            </span>
            <Badge tone={activeMeta.tone}>{activeMeta.label}</Badge>
          </div>
          {active.reasons.length > 0 && <div className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{active.reasons.join(" · ")}</div>}
          {active.errorMessage && active.errorCode !== "op_under_dest_min" && <div className="mt-0.5 line-clamp-2 text-[11px] text-rose-600">{active.errorMessage}</div>}
        </div>
      )}
      <button
        type="button"
        onClick={send}
        disabled={sendDisabled}
        className={`w-full rounded-2xl bg-emerald-600 font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 disabled:bg-zinc-300 disabled:shadow-none ${compact ? "py-2.5 text-sm" : "py-3.5 text-base"}`}
      >
        {sending ? <Spinner /> : quote ? `Send ${sym}${fmt(amount)} → ₹${fmt(quote.best.destAmount)}` : "Send"}
      </button>
    </div>
  );

  return (
    <Phone title="Send money home" subtitle={sender ? `${sender.name} · ${sender.city}` : "Loading…"} footer={footer}>
      {/* sender picker */}
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {senders.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSenderId(s.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${s.id === senderId ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
          >
            {s.name.split(" ")[0]}
            {s.sanctioned ? " ⚠" : s.kyc !== "PASSED" ? " ?" : ""}
          </button>
        ))}
      </div>

      {sender && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {sender.kyc === "PASSED" ? <Badge tone="green">✓ ID verified</Badge> : <Badge tone="amber">ID not verified</Badge>}
            {sender.sanctioned && <Badge tone="red">Watchlist match</Badge>}
            {Object.values(sender.balances).some((b) => b.frozen) && <Badge tone="red">Funds frozen</Badge>}
          </div>
          {sender.note && <p className="mb-2 rounded-lg bg-zinc-50 p-2 text-[11px] text-zinc-500">{sender.note}</p>}

          {/* wallet balances */}
          <div className="mb-2 grid grid-cols-2 gap-2">
            {(["tAED", "tUSDC"] as const).map((code) => {
              const b = sender.balances[code];
              return (
                <div key={code} className={`rounded-xl ${compact ? "px-2.5 py-1.5" : "p-2.5"} ${b.frozen ? "bg-rose-50" : "bg-zinc-50"}`}>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Wallet {FIAT_LABEL[code]}</div>
                  <div className="font-semibold tabular-nums">{fmt(b.balance)}</div>
                  {!b.authorized && <div className="text-[10px] font-medium text-rose-600">{b.frozen ? "frozen" : "not enabled"}</div>}
                </div>
              );
            })}
          </div>

          {/* mock bank account: one row */}
          <div className="mb-3 rounded-xl border border-zinc-200 px-2.5 py-2">
            {sender.kyc === "PASSED" ? (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Bank ({sender.bank.currency})</div>
                  <div className="text-sm font-semibold tabular-nums">{fmt(sender.bank.balance)}</div>
                </div>
                <input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} inputMode="decimal" className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-sm tabular-nums" aria-label="Amount to add" />
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => action("deposit", () => api("/deposit", { body: { senderId: sender.id, fiatAmount: depositAmt, fiatCurrency: FIAT_LABEL[asset] } }), `Added ${FIAT_LABEL[asset]} ${depositAmt} to your wallet`)}
                  className="whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy === "deposit" ? <Spinner /> : `Add ${FIAT_LABEL[asset]}`}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => action("kyc", () => api("/kyc/verify", { body: { publicKey: sender.publicKey, name: sender.name } }), "Identity verified. Your wallet is now enabled.")}
                className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy === "kyc" ? <Spinner /> : "Verify my identity (mock KYC)"}
              </button>
            )}
          </div>

          {/* amount */}
          <label className="text-xs font-medium text-zinc-500">You send</label>
          <div className={`mb-1 mt-1 flex items-center gap-2 rounded-xl border-2 border-zinc-900 px-3 ${compact ? "py-1.5" : "py-2"}`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`w-full bg-transparent font-bold tabular-nums outline-none ${compact ? "text-xl" : "text-2xl"}`} aria-label="Amount to send" />
            <select value={asset} onChange={(e) => setAsset(e.target.value as "tAED" | "tUSDC")} className="rounded-lg bg-zinc-100 px-2 py-1 text-sm font-semibold" aria-label="Currency">
              <option value="tAED">AED</option>
              <option value="tUSDC">USD</option>
            </select>
          </div>
          {(amountError || overBalance) && <div className="mb-1 text-xs text-rose-600">{amountError ?? `Exceeds wallet balance (${sym}${fmt(balance!.balance)})`}</div>}

          {/* quote */}
          <div className={`mb-3 mt-2 rounded-xl bg-emerald-50 ${compact ? "p-2.5" : "p-3"}`}>
            <div className="text-xs font-medium text-emerald-800">{recipient.name.split(" ")[0] || "Recipient"} gets</div>
            <div className={`font-bold tabular-nums text-emerald-900 ${compact ? "text-xl" : "text-2xl"}`}>
              {quote ? `₹${fmt(quote.best.destAmount)}` : quoting ? <Spinner /> : "—"}
            </div>
            {quote && (
              <div className="mt-1 space-y-0.5 text-[11px] text-emerald-900/70">
                <div>
                  1 {FIAT_LABEL[asset]} = ₹{fmt(quote.effectiveRate, 4)} · guaranteed min ₹{fmt(quote.destMin)}
                </div>
                <div>Fee: ${quote.networkFee.usd} network · no transfer fee</div>
                <div className="flex items-center justify-between">
                  <span>Arrives in ~10 seconds</span>
                  <span className={secsLeft <= 5 ? "font-semibold text-amber-700" : ""}>{quoting ? "refreshing…" : `rate held ${secsLeft}s`}</span>
                </div>
                {quote.priceImpactWarning && <div className="font-semibold text-amber-700">⚠ Large amount: {quote.best.costVsMidPct}% below market rate. Consider sending less.</div>}
              </div>
            )}
            {quoteErr && <div className="mt-1 text-xs text-rose-600">{quoteErr}</div>}
          </div>

          {/* recipient */}
          <div className="space-y-2">
            <input value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} placeholder="Recipient name" className={field} aria-label="Recipient name" />
            <input value={recipient.upiId} onChange={(e) => setRecipient({ ...recipient, upiId: e.target.value })} placeholder="UPI ID (e.g. name@okaxis)" className={field} aria-label="UPI ID" />
            <select value={recipient.purpose} onChange={(e) => setRecipient({ ...recipient, purpose: e.target.value })} className={field} aria-label="Purpose">
              {["Family support", "Education", "Medical expenses", "Savings", "Gift"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <div className="text-[10px] text-zinc-400">Try UPI fail@upi (bank rejects → refund) or blocked@upi (sanctions hit).</div>
          </div>
        </>
      )}
    </Phone>
  );
}
