"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Big, fmt } from "@remit/shared/money";
import { CURRENCY, RAILS, RAILS_FOR, railOf, validateRecipientFor, type Rail } from "@remit/shared/corridors";
import { ApiError, api, type FiatCode, type Recipient, type TransferView } from "@/lib/api";
import { useQuote } from "@/lib/useQuote";
import { useSession } from "@/lib/session";
import { AddMoneyDialog, useRates } from "./HomePage";
import { Alert, ASSET_OF, Button, Card, CurrencySelect, FIATS, Field, Input, RailFields, Select, Spinner, Tracker, amt, countryOf, destOfRecipient, emptyRailForm, recipientFor, recipientLine } from "./kit";
import { Shell } from "./Shell";

type Step = 0 | 1 | 2 | 3;
type Saved = Recipient & { lastSentAt: number; count: number };
const PURPOSES = ["Family support", "Education", "Medical expenses", "Savings", "Gift", "Rent / housing", "Business payment"];

/** USD value of 1 unit of `fiat`, from the quote's FX snapshot. */
function usdPer(fiat: FiatCode, fx: { rates: Record<FiatCode, string> }) {
  return new Big(1).div(fx.rates[fiat]);
}

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
  const [cur, setCur] = useState<FiatCode>("AED");
  const [to, setTo] = useState<FiatCode>("INR");
  const [amount, setAmount] = useState("100");
  const [method, setMethod] = useState<Rail>("UPI");
  const [r, setR] = useState(emptyRailForm);
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
    const c = p.get("cur") as FiatCode | null;
    const t = p.get("to") as FiatCode | null;
    if (a) setAmount(a);
    const from = c && FIATS.includes(c) ? c : user?.sendCurrency ?? "AED";
    setCur(from);
    if (t && FIATS.includes(t) && t !== from) setTo(t);
    else if (from === "INR") setTo("USD");
    api<Saved[]>("/me/recipients").then(setSaved).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const asset = ASSET_OF[cur];
  const destAsset = ASSET_OF[to];
  const rails = RAILS_FOR[destAsset];
  // Keep the payout method valid for the chosen destination currency.
  useEffect(() => {
    if (!rails.includes(method)) setMethod(rails[0]);
  }, [rails, method]);
  const { quote, error: quoteErr, loading, secsLeft, amountError, refresh } = useQuote(asset, amount, destAsset, { paused: step === 3 });
  const balance = wallet?.balances?.[asset];
  const overBalance = !amountError && balance && new Big(amount).gt(balance.balance);
  const usdEq = quote && config && !amountError ? new Big(amount).times(usdPer(cur, quote.fx)) : undefined;
  const needsReview = usdEq && config ? usdEq.gt(config.compliance.REVIEW_THRESHOLD_USD) : false;
  const D = (v: string | number, dp?: number) => amt(destAsset, v, dp);

  const recipient: Recipient = useMemo(() => recipientFor(method, r), [method, r]);
  const recipientErr = rails.includes(method) ? validateRecipientFor(destAsset, recipient) : "Choose how they receive it";

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
        setNotice(fresh ? `The rate was refreshed: they now receive ${D(fresh.best.destAmount)} (was ${D(before)}). Please confirm again.` : "Rate expired. Please try again.");
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
                  <input id="send-amount" name="sendAmount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus className="w-full bg-transparent text-4xl font-bold tabular-nums outline-none" aria-label="Amount to send" />
                  <CurrencySelect
                    id="send-currency"
                    label="code"
                    value={cur}
                    onChange={(c) => {
                      setCur(c);
                      if (c === to) setTo(FIATS.find((f) => f !== c)!);
                    }}
                    className="rounded-xl bg-zinc-100 px-3 py-2 text-base font-semibold"
                  />
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className={overBalance || amountError ? "text-rose-600" : "text-zinc-500"}>
                    {amountError ?? (overBalance ? "More than your balance" : `Balance: ${cur} ${balance ? fmt(balance.balance) : "—"}`)}
                  </span>
                  {canSend && (
                    <button type="button" onClick={() => setAddOpen(true)} className="font-medium text-emerald-700 hover:underline">
                      + Add money
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="receive-currency" className="mb-1 block text-sm font-medium text-zinc-700">
                  They receive in
                </label>
                <CurrencySelect id="receive-currency" value={to} onChange={setTo} exclude={cur} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium" />
                <div className="mt-1 text-xs text-zinc-500">
                  {CURRENCY[destAsset].flag} {countryOf(destAsset)} · paid out via {RAILS_FOR[destAsset].map((x) => RAILS[x].short).join(" or ")} · {FIATS.length} currencies, {FIATS.length * (FIATS.length - 1)} routes
                </div>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-5">
                <div className="text-sm text-emerald-800">
                  Recipient gets ({CURRENCY[asset].fiat} → {to})
                </div>
                <div className="text-4xl font-bold tabular-nums text-emerald-900">{quote && !amountError ? D(quote.best.destAmount) : loading ? <Spinner /> : "—"}</div>
                {quote && !amountError && (
                  <div className="mt-2 text-sm text-emerald-900/75">
                    Guaranteed at least {D(quote.destMin)} · rate held for {secsLeft}s
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
                    {saved.filter((s) => destOfRecipient(s) && destOfRecipient(s) !== cur).map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          // Switching to this recipient also switches the receive currency to theirs.
                          const f = destOfRecipient(s)!;
                          setTo(f);
                          setMethod(railOf(ASSET_OF[f], s)!);
                          const form = emptyRailForm();
                          for (const [k, v] of Object.entries(s)) if (k in form && typeof v === "string") form[k as keyof typeof form] = v;
                          setR(form);
                        }}
                        className="rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm hover:border-emerald-500 hover:bg-emerald-50"
                      >
                        <div className="pointer-events-none font-semibold">{s.name}</div>
                        <div className="pointer-events-none text-xs text-zinc-500">{recipientLine(s)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Recipient's full name" id="recipient-name">
                <Input id="recipient-name" name="recipientName" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Lakshmi Kumar" />
              </Field>
              <div>
                <div className="mb-1 text-sm font-medium text-zinc-700">
                  How should they receive {to} in {countryOf(destAsset)}?
                </div>
                <div className={`grid gap-2 ${rails.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {rails.map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-xl border-2 px-4 py-3 text-left text-sm ${method === m ? "border-emerald-500 bg-emerald-50" : "border-zinc-200 hover:border-zinc-300"}`}>
                      <div className="font-semibold">{RAILS[m].label}</div>
                      <div className="text-xs text-zinc-500">{RAILS[m].help}</div>
                    </button>
                  ))}
                </div>
              </div>
              {rails.includes(method) && <RailFields rail={method} form={r} setForm={setR} />}
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
                  ["Route", `${countryOf(asset)} → ${countryOf(destAsset)} (${cur} → ${to})`],
                  ["Exchange rate", `1 ${cur} = ${D(quote.effectiveRate, 4)}`],
                  ["Recipient", `${recipient.name} · ${recipientLine(recipient)}`],
                  ["Paid out via", RAILS[method].label],
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
                    <div className="text-xl font-bold tabular-nums text-emerald-900">{D(quote.best.destAmount)}</div>
                    <div className="text-xs text-emerald-800">guaranteed at least {D(quote.destMin)}</div>
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
                <Button className="flex-1 py-3" disabled={busy || !quote} onClick={confirm}>
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
                      {sent.status === "PAYOUT_COMPLETE" ? `${amt(sent.destAsset, sent.receivedAmount ?? sent.quotedDest)} delivered to ${sent.recipient.name}` : `Sending ${amt(sent.destAsset, sent.quotedDest)} to ${sent.recipient.name}`}
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
                      Credited to {recipientLine(sent.recipient)}. Payout reference <b>{sent.payoutRef}</b>.
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
                <span className="font-semibold tabular-nums text-emerald-700">{quote ? D(quote.best.destAmount) : "—"}</span>
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
                A typical bank wire charges about {config.traditional.FEE_PCT}% and takes {config.traditional.SETTLEMENT}. Your recipient would get roughly{" "}
                <b>{CURRENCY[destAsset].symbol}{fmt(new Big(quote.best.destAmount).div(new Big(1).minus(new Big(quote.best.costVsMidPct).div(100))).times(new Big(1).minus(new Big(config.traditional.FEE_PCT).div(100))))}</b>.
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
