"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Big, fmt } from "@remit/shared/money";
import { api, type AppConfig, type Health } from "@/lib/api";
import { useQuote } from "@/lib/useQuote";
import { useSession } from "@/lib/session";
import { Alert, ASSET_OF, Button, Card, CUR, Field, Input, Pill, Select, Spinner, dateTime, recipientLine } from "./kit";
import { Shell } from "./Shell";

export function AddMoneyDialog({ open, onClose, defaultCurrency }: { open: boolean; onClose: () => void; defaultCurrency: "AED" | "USD" }) {
  const { wallet, refreshWallet } = useSession();
  const [amount, setAmount] = useState("200");
  const [currency, setCurrency] = useState<"AED" | "USD">(defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  useEffect(() => {
    if (open) {
      setError(undefined);
      setDone(undefined);
      setCurrency(defaultCurrency);
    }
  }, [open, defaultCurrency]);
  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ amount: string; bankDebited: string }>("/me/deposit", { body: { amount, currency } });
      setDone(`${currency} ${fmt(r.amount)} added to your balance. ${r.bankDebited} taken from your bank.`);
      refreshWallet();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add money">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add money</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100" aria-label="Close">
            ✕
          </button>
        </div>
        {done ? (
          <>
            <Alert tone="ok">{done}</Alert>
            <Button onClick={onClose} className="mt-4 w-full">
              Done
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-zinc-50 p-3 text-sm">
              From your linked bank account
              <div className="font-semibold">
                {wallet?.bank ? `${wallet.bank.currency} ${fmt(wallet.bank.balance)} available` : "—"}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <Field label="Amount" id="add-amount">
                <Input id="add-amount" name="addAmount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
              </Field>
              <Field label="Currency" id="add-currency">
                <Select id="add-currency" name="addCurrency" value={currency} onChange={(e) => setCurrency(e.target.value as "AED" | "USD")}>
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              {["100", "500", "1000"].map((v) => (
                <button key={v} type="button" onClick={() => setAmount(v)} className="rounded-lg border border-zinc-200 px-3 py-1 text-xs hover:bg-zinc-50">
                  {currency} {v}
                </button>
              ))}
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <Button onClick={submit} disabled={busy} className="w-full py-3">
              {busy ? <Spinner /> : `Add ${currency} ${amount}`}
            </Button>
            <p className="text-xs text-zinc-500">Simulated bank transfer. In production this is a card or bank payment through a licensed partner.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function useRates() {
  const [config, setConfig] = useState<AppConfig>();
  const [health, setHealth] = useState<Health>();
  useEffect(() => {
    api<AppConfig>("/config").then(setConfig).catch(() => undefined);
    api<Health>("/health").then(setHealth).catch(() => undefined);
  }, []);
  return { config, fx: health?.fx };
}

export function HomePage() {
  const { user, wallet, transfers, refreshWallet } = useSession();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const cur = user?.sendCurrency ?? "AED";
  const [qAmount, setQAmount] = useState("100");
  const [qCur, setQCur] = useState<"AED" | "USD">(cur);
  useEffect(() => setQCur(cur), [cur]);
  const { quote, loading, amountError } = useQuote(ASSET_OF[qCur], qAmount);
  const { config, fx } = useRates();

  // "You saved" vs a typical bank wire (illustrative fee %, actual received amounts).
  const saved =
    config && fx
      ? transfers
          .filter((t) => t.status === "PAYOUT_COMPLETE" && t.receivedAmount)
          .reduce((acc, t) => {
            const mid = new Big(fx.inrPerUsd).times(t.sendAsset === "tUSDC" ? 1 : new Big(1).div(fx.aedPerUsd));
            const trad = new Big(t.sendAmount).times(mid).times(new Big(1).minus(new Big(config.traditional.FEE_PCT).div(100)));
            return acc.plus(new Big(t.receivedAmount!).minus(trad));
          }, new Big(0))
      : undefined;
  const sentCount = transfers.filter((t) => t.status === "PAYOUT_COMPLETE").length;
  const pending = transfers.filter((t) => !["PAYOUT_COMPLETE", "BLOCKED", "ON_CHAIN_FAILED", "EXPIRED", "REFUNDED", "REFUND_FAILED"].includes(t.status));

  return (
    <Shell title={`Hello, ${user?.displayName.split(" ")[0] ?? ""}`}>
      <div className="space-y-5">
        {/* onboarding / account state */}
        {wallet?.walletStatus === "PROVISIONING" && (
          <Alert tone="info">
            <div className="flex items-center gap-3">
              <Spinner /> Setting up your secure wallet on the Stellar network. This takes a few seconds…
            </div>
          </Alert>
        )}
        {wallet?.walletStatus === "FAILED" && (
          <Alert tone="error">
            We couldn&apos;t finish setting up your wallet: {wallet.walletError}{" "}
            <button type="button" className="font-semibold underline" onClick={() => api("/me/wallet/retry", { body: {} }).then(refreshWallet)}>
              Try again
            </button>
          </Alert>
        )}
        {wallet?.restricted && <Alert tone="error">Your account is restricted after a compliance review, so sending is unavailable. Please contact support.</Alert>}
        {wallet?.walletStatus === "READY" && wallet.kyc !== "VERIFIED" && !wallet.restricted && (
          <Card className="flex items-center justify-between gap-6 border-amber-200 bg-amber-50 p-5">
            <div>
              <div className="font-semibold">Verify your identity to start sending</div>
              <div className="text-sm text-amber-900/80">It takes about a minute. We&apos;re required to check who you are before moving money.</div>
            </div>
            <Link href="/verify">
              <Button>Verify now</Button>
            </Link>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            {/* balances */}
            <div className="grid grid-cols-3 gap-4">
              {(["tAED", "tUSDC"] as const).map((code) => {
                const b = wallet?.balances?.[code];
                return (
                  <Card key={code} className="p-5">
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{CUR[code]} balance</div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">{b ? fmt(b.balance) : "—"}</div>
                    {b?.frozen && <div className="mt-1 text-xs font-semibold text-rose-600">Frozen</div>}
                  </Card>
                );
              })}
              <Card className="flex flex-col justify-between p-5">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Linked bank</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">{wallet?.bank ? `${wallet.bank.currency} ${fmt(wallet.bank.balance)}` : "—"}</div>
                </div>
                <Button variant="secondary" className="mt-3 py-1.5" disabled={wallet?.kyc !== "VERIFIED" || wallet?.restricted} onClick={() => setAddOpen(true)}>
                  + Add money
                </Button>
              </Card>
            </div>

            {/* recent */}
            <Card>
              <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
                <h2 className="font-semibold">Recent transfers</h2>
                <Link href="/activity" className="text-sm font-medium text-emerald-700 hover:underline">
                  See all
                </Link>
              </div>
              <ul className="divide-y divide-zinc-100">
                {transfers.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <Link href={`/activity?id=${t.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-semibold text-emerald-700">{t.recipient.name[0]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{t.recipient.name}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {recipientLine(t.recipient)} · {dateTime(t.createdAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">₹{fmt(t.receivedAmount ?? t.quotedDest)}</div>
                        <div className="text-xs text-zinc-500 tabular-nums">
                          {CUR[t.sendAsset]} {fmt(t.sendAmount)}
                        </div>
                      </div>
                      <Pill status={t.status} />
                    </Link>
                  </li>
                ))}
                {transfers.length === 0 && <li className="px-5 py-10 text-center text-sm text-zinc-500">No transfers yet. Your first one takes about 10 seconds.</li>}
              </ul>
            </Card>
          </div>

          <div className="space-y-5">
            {/* quick send */}
            <Card className="p-5">
              <h2 className="font-semibold">Quick send</h2>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-300 px-3 py-2 focus-within:border-emerald-500">
                <input id="quick-send-amount" name="quickSendAmount" value={qAmount} onChange={(e) => setQAmount(e.target.value)} inputMode="decimal" className="w-full bg-transparent text-2xl font-bold tabular-nums outline-none" aria-label="Quick send amount" />
                <select id="quick-send-currency" name="quickSendCurrency" value={qCur} onChange={(e) => setQCur(e.target.value as "AED" | "USD")} className="rounded-lg bg-zinc-100 px-2 py-1 text-sm font-semibold" aria-label="Quick send currency">
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="mt-3 rounded-xl bg-emerald-50 p-3">
                <div className="text-xs text-emerald-800">They receive</div>
                <div className="text-2xl font-bold tabular-nums text-emerald-900">{amountError ? "—" : quote ? `₹${fmt(quote.best.destAmount)}` : loading ? <Spinner /> : "—"}</div>
                {quote && (
                  <div className="text-xs text-emerald-900/70">
                    1 {qCur} = ₹{fmt(quote.effectiveRate, 4)} · no transfer fee
                  </div>
                )}
              </div>
              <Button className="mt-3 w-full py-3" disabled={!!amountError} onClick={() => router.push(`/send?amount=${encodeURIComponent(qAmount)}&cur=${qCur}`)}>
                Continue
              </Button>
            </Card>

            {/* savings */}
            <Card className="bg-zinc-900 p-5 text-white">
              <div className="text-xs uppercase tracking-wide text-zinc-400">You&apos;ve saved</div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-400">₹{saved ? fmt(saved.gt(0) ? saved : 0) : "0.00"}</div>
              <div className="mt-1 text-xs text-zinc-400">
                across {sentCount} delivered transfer{sentCount === 1 ? "" : "s"}, compared with a typical bank wire ({config?.traditional.FEE_PCT ?? "6.4"}% in fees and FX markup, World Bank average, illustrative).
              </div>
            </Card>

            {pending.length > 0 && (
              <Card className="p-5">
                <h2 className="mb-2 font-semibold">In progress</h2>
                {pending.map((t) => (
                  <Link key={t.id} href={`/activity?id=${t.id}`} className="flex items-center justify-between py-1.5 text-sm hover:underline">
                    <span>{t.recipient.name}</span>
                    <Pill status={t.status} />
                  </Link>
                ))}
              </Card>
            )}
          </div>
        </div>
      </div>
      <AddMoneyDialog open={addOpen} onClose={() => setAddOpen(false)} defaultCurrency={cur} />
    </Shell>
  );
}
