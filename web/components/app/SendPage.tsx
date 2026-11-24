"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Big, fmt } from "@remit/shared/money";
import { ApiError, api, type Recipient, type TransferView } from "@/lib/api";
import { useQuote } from "@/lib/useQuote";
import { useSession } from "@/lib/session";
import { AddMoneyDialog, useRates } from "./HomePage";
import { Alert, ASSET_OF, Button, Card, Field, Input, Select, Spinner, Tracker, recipientLine } from "./kit";
import { Shell } from "./Shell";

type Step = 0 | 1 | 2 | 3;
type Saved = Recipient & { lastSentAt: number; count: number };
const PURPOSES = ["Family support", "Education", "Medical expenses", "Savings", "Gift", "Rent / housing"];

function Steps({ step }: { step: Step }) {
  const labels = ["Amount", "Recipient", "Review", "Done"];
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-500"}`}>{i < step ? "✓" : i + 1}</span>
          <span className={i === step ? "font-semibold" : "text-zinc-500"}>{l}</span>
          {i < labels.length - 1 && <span className="mx-1 h-px w-10 bg-zinc-300" />}
        </li>
      ))}
    </ol>
  );
}

export function SendPage() {
  const { user, wallet, transfers } = useSession();
  const { config } = useRates();
  const [step, setStep] = useState<Step>(0);
  const [cur, setCur] = useState<"AED" | "USD">("AED");
  const [amount, setAmount] = useState("100");
  const [method, setMethod] = useState<"upi" | "bank">("upi");
  const [r, setR] = useState({ name: "", upiId: "", bankAcct: "", ifsc: "" });
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sentId, setSentId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);

  // Pre-fill from ?amount=&cur= (quick send) once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = p.get("amount");
    const c = p.get("cur");
    if (a) setAmount(a);
    if (c === "AED" || c === "USD") setCur(c);
    else if (user) setCur(user.sendCurrency);
    api<Saved[]>("/me/recipients").then(setSaved).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const asset = ASSET_OF[cur];
  const { quote, error: quoteErr, loading, secsLeft, amountError, refresh } = useQuote(asset, amount, { paused: step === 3 });
  const balance = wallet?.balances?.[asset];
  const overBalance = !amountError && balance && new Big(amount).gt(balance.balance);
  const usdEq = quote && config ? new Big(amount).times(cur === "USD" ? 1 : new Big(1).div("3.6725")) : undefined;
  const needsReview = usdEq && config ? usdEq.gt(config.compliance.REVIEW_THRESHOLD_USD) : false;

  const recipient: Recipient = useMemo(
    () => (method === "upi" ? { name: r.name.trim(), upiId: r.upiId.trim() } : { name: r.name.trim(), bankAcct: r.bankAcct.trim(), ...(r.ifsc ? { ifsc: r.ifsc.trim().toUpperCase() } : {}) }),
    [method, r],
  );
  const recipientErr = !r.name.trim()
    ? "Enter the recipient's name"
    : method === "upi"
      ? !/^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/.test(r.upiId.trim()) ? "Enter a valid UPI ID, e.g. name@okaxis" : undefined
      : !/^\d{9,18}$/.test(r.bankAcct.trim())
        ? "Account number: 9–18 digits"
        : !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(r.ifsc.trim().toUpperCase())
          ? "Enter a valid IFSC, e.g. SBIN0001234"
          : undefined;

  const canSend = wallet?.walletStatus === "READY" && wallet.kyc === "VERIFIED" && !wallet.restricted;
  const sent: TransferView | undefined = sentId ? transfers.find((t) => t.id === sentId) : undefined;

  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await api<{ transferId: string }>("/me/transfer", { body: { quoteId: quote.quoteId, recipient, purpose } });
      setSentId(res.transferId);
      setStep(3);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "QUOTE_EXPIRED") {
        const before = quote.best.destAmount;
        const fresh = await refresh();
        setNotice(fresh ? `The rate was refreshed: they now receive ₹${fmt(fresh.best.destAmount)} (was ₹${fmt(before)}). Please confirm again.` : "Rate expired. Please try again.");
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The rate moved before settlement: offer a fresh quote, never resend silently.
  const rateMoved = sent?.status === "ON_CHAIN_FAILED" && sent.errorCode === "op_under_dest_min";

  return (
    <Shell title="Send money">
      <Steps step={step} />
      {!canSend && step < 3 && (
        <div className="mb-5">
          <Alert tone="warn">
            {wallet?.restricted ? (
              "Your account is restricted, so sending is unavailable."
            ) : wallet?.walletStatus !== "READY" ? (
              "Your wallet is still being set up."
            ) : (
              <>
                You need to verify your identity before sending.{" "}
                <Link href="/verify" className="font-semibold underline">
                  Verify now
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="p-6">
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">How much are you sending?</h2>
              <div>
                <div className="flex items-center gap-3 rounded-2xl border-2 border-zinc-900 px-4 py-3">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus className="w-full bg-transparent text-4xl font-bold tabular-nums outline-none" aria-label="Amount to send" />
                  <select value={cur} onChange={(e) => setCur(e.target.value as "AED" | "USD")} className="rounded-xl bg-zinc-100 px-3 py-2 text-base font-semibold" aria-label="Currency">
                    <option value="AED">AED</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className={overBalance || amountError ? "text-rose-600" : "text-zinc-500"}>
                    {amountError ?? (overBalance ? "More than your balance" : `Balance: ${cur} ${balance ? fmt(balance.balance) : "—"}`)}
                  </span>
                  {canSend && (
                    <button onClick={() => setAddOpen(true)} className="font-medium text-emerald-700 hover:underline">
                      + Add money
                    </button>
                  )}
                </div>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-5">
                <div className="text-sm text-emerald-800">Recipient gets</div>
                <div className="text-4xl font-bold tabular-nums text-emerald-900">{quote && !amountError ? `₹${fmt(quote.best.destAmount)}` : loading ? <Spinner /> : "—"}</div>
                {quote && !amountError && (
                  <div className="mt-2 text-sm text-emerald-900/75">
                    Guaranteed at least ₹{fmt(quote.destMin)} · rate held for {secsLeft}s
                  </div>
                )}
                {quote?.priceImpactWarning && <div className="mt-2 text-sm font-semibold text-amber-800">This is a large amount for current liquidity: {quote.best.costVsMidPct}% below the market rate. Consider sending less.</div>}
                {quoteErr && <div className="mt-2 text-sm text-rose-700">{quoteErr}</div>}
              </div>
              <Button className="w-full py-3" disabled={!quote || !!amountError || !!overBalance || !canSend} onClick={() => setStep(1)}>
                Continue
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Who are you sending to?</h2>
              {saved.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-zinc-700">Recent recipients</div>
                  <div className="flex flex-wrap gap-2">
                    {saved.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setMethod(s.upiId ? "upi" : "bank");
                          setR({ name: s.name, upiId: s.upiId ?? "", bankAcct: s.bankAcct ?? "", ifsc: s.ifsc ?? "" });
                        }}
                        className="rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm hover:border-emerald-500 hover:bg-emerald-50"
                      >
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-xs text-zinc-500">{recipientLine(s)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Recipient's full name">
                <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Lakshmi Kumar" />
              </Field>
              <div>
                <div className="mb-1 text-sm font-medium text-zinc-700">How should they receive it?</div>
                <div className="grid grid-cols-2 gap-2">
                  {(["upi", "bank"] as const).map((m) => (
                    <button key={m} onClick={() => setMethod(m)} className={`rounded-xl border-2 px-4 py-3 text-left text-sm ${method === m ? "border-emerald-500 bg-emerald-50" : "border-zinc-200 hover:border-zinc-300"}`}>
                      <div className="font-semibold">{m === "upi" ? "UPI" : "Bank account"}</div>
                      <div className="text-xs text-zinc-500">{m === "upi" ? "Instant to any UPI app" : "Any Indian bank via IFSC"}</div>
                    </button>
                  ))}
                </div>
              </div>
              {method === "upi" ? (
                <Field label="UPI ID" hint="Testing: fail@upi = bank rejects (you get refunded) · blocked@upi = sanctions hit">
                  <Input value={r.upiId} onChange={(e) => setR({ ...r, upiId: e.target.value })} placeholder="name@okaxis" />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Account number">
                    <Input value={r.bankAcct} onChange={(e) => setR({ ...r, bankAcct: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                  </Field>
                  <Field label="IFSC code">
                    <Input value={r.ifsc} onChange={(e) => setR({ ...r, ifsc: e.target.value.toUpperCase() })} placeholder="SBIN0001234" />
                  </Field>
                </div>
              )}
              <Field label="Purpose of transfer" hint="Required by regulation">
                <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                  {PURPOSES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              {r.name && recipientErr && <div className="text-sm text-rose-600">{recipientErr}</div>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={!!recipientErr} onClick={() => setStep(2)}>
                  Review
                </Button>
              </div>
            </div>
          )}

          {step === 2 && quote && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Review your transfer</h2>
              <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-sm">
                {[
                  ["You send", `${cur} ${fmt(amount)}`],
                  ["Transfer fee", `${cur} 0.00`],
                  ["Network fee", `$${quote.networkFee.usd} (paid by us)`],
                  ["Exchange rate", `1 ${cur} = ₹${fmt(quote.effectiveRate, 4)}`],
                  ["Recipient", `${recipient.name} · ${recipientLine(recipient)}`],
                  ["Purpose", purpose],
                  ["Arrives", "In about 10 seconds"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-emerald-50 px-4 py-3">
                  <dt className="font-semibold text-emerald-900">They receive</dt>
                  <dd className="text-right">
                    <div className="text-xl font-bold tabular-nums text-emerald-900">₹{fmt(quote.best.destAmount)}</div>
                    <div className="text-xs text-emerald-800">guaranteed at least ₹{fmt(quote.destMin)}</div>
                  </dd>
                </div>
              </dl>
              <div className="text-xs text-zinc-500">Rate held for {secsLeft}s, then refreshed automatically.</div>
              {needsReview && <Alert tone="info">Transfers above USD {config?.compliance.REVIEW_THRESHOLD_USD} get a quick manual review, usually within minutes.</Alert>}
              {notice && <Alert tone="warn">{notice}</Alert>}
              {error && <Alert tone="error">{error}</Alert>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button className="flex-1 py-3" disabled={busy || loading} onClick={confirm}>
                  {busy ? <Spinner /> : `Confirm and send ${cur} ${fmt(amount)}`}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              {!sent ? (
                <div className="flex items-center gap-3 text-zinc-600">
                  <Spinner /> Sending…
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {sent.status === "PAYOUT_COMPLETE" ? `₹${fmt(sent.receivedAmount ?? sent.quotedDest)} delivered to ${sent.recipient.name}` : `Sending ₹${fmt(sent.quotedDest)} to ${sent.recipient.name}`}
                    </h2>
                    <p className="text-sm text-zinc-500">Reference {sent.id}</p>
                  </div>
                  <Tracker t={sent} />
                  {rateMoved && (
                    <Alert tone="warn">
                      The exchange rate moved before your transfer settled, so we didn&apos;t send it and nothing was charged.{" "}
                      <button
                        className="font-semibold underline"
                        onClick={() => {
                          setSentId(undefined);
                          setStep(2);
                          refresh();
                        }}
                      >
                        Review the new rate
                      </button>
                    </Alert>
                  )}
                  {sent.status === "PAYOUT_COMPLETE" && (
                    <Alert tone="ok">
                      Credited to {recipientLine(sent.recipient)}. Bank reference <b>{sent.payoutRef}</b>.
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Link href={`/activity?id=${sent.id}`}>
                      <Button variant="secondary">View receipt</Button>
                    </Link>
                    <Button
                      onClick={() => {
                        setSentId(undefined);
                        setStep(0);
                        setError(undefined);
                        setNotice(undefined);
                        refresh();
                      }}
                    >
                      Send another
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        {/* summary sidebar */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Summary</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">You send</span>
                <span className="font-semibold tabular-nums">
                  {cur} {amountError ? "—" : fmt(amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Fees</span>
                <span className="font-semibold">{cur} 0.00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">They get</span>
                <span className="font-semibold tabular-nums text-emerald-700">{quote ? `₹${fmt(quote.best.destAmount)}` : "—"}</span>
              </div>
              {r.name && step > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">To</span>
                  <span className="font-semibold">{r.name}</span>
                </div>
              )}
            </div>
          </Card>
          {quote && config && !amountError && (
            <Card className="p-5 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Compared with a bank wire</div>
              <div className="mt-2 text-zinc-600">
                A typical bank wire charges about {config.traditional.FEE_PCT}% and takes {config.traditional.SETTLEMENT}. Your family would get roughly{" "}
                <b>₹{fmt(new Big(quote.best.destAmount).div(new Big(1).minus(new Big(quote.best.costVsMidPct).div(100))).times(new Big(1).minus(new Big(config.traditional.FEE_PCT).div(100))))}</b>.
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">Illustrative, World Bank Remittance Prices Worldwide average.</div>
            </Card>
          )}
          <Card className="p-5 text-xs text-zinc-500">
            🔒 Your transfer is checked against sanctions lists and settled on the Stellar network. If the recipient&apos;s bank rejects it, the money comes back to you automatically.
          </Card>
        </div>
      </div>
      <AddMoneyDialog open={addOpen} onClose={() => setAddOpen(false)} defaultCurrency={cur} />
    </Shell>
  );
}
