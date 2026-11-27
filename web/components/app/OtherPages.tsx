"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { fmt, stroopsToXlm } from "@remit/shared/money";
import { api, type TransferView } from "@/lib/api";
import { useSession, type Profile } from "@/lib/session";
import { ASSET_OF_COUNTRY, CURRENCY, RAILS, railOf } from "@remit/shared/corridors";

const ID_FOR_COUNTRY: Partial<Record<string, string>> = { US: "US_STATE_ID", AE: "EMIRATES_ID", IN: "AADHAAR", EU: "NATIONAL_ID", GB: "DRIVERS_LICENSE", JP: "RESIDENCE_PERMIT" };
import { Alert, Button, Card, CUR, Field, Input, Pill, STATUS, Select, Spinner, Tracker, amt, countryOf, dateTime, recipientLine } from "./kit";
import { Shell } from "./Shell";

const EXPLORER = "https://stellar.expert/explorer/testnet";

// ---------------- Activity ----------------

const FILTERS: { key: string; label: string; match: (t: TransferView) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "progress", label: "In progress", match: (t) => ["Processing", "On its way", "Crediting", "Under review", "Returning"].includes(STATUS[t.status].label) },
  { key: "done", label: "Delivered", match: (t) => t.status === "PAYOUT_COMPLETE" },
  { key: "issues", label: "Not delivered", match: (t) => ["BLOCKED", "ON_CHAIN_FAILED", "EXPIRED", "REFUNDED", "REFUND_FAILED"].includes(t.status) },
];

const EVENT_LABEL: Partial<Record<TransferView["status"], string>> = {
  CREATED: "Transfer created",
  COMPLIANCE_CHECK: "Security checks started",
  APPROVED: "Security checks passed",
  FLAGGED_FOR_REVIEW: "Sent for manual review",
  BLOCKED: "Stopped by compliance",
  EXPIRED: "Review window expired",
  SUBMITTED: "Sent to the Stellar network",
  ON_CHAIN_FAILED: "Network did not accept the transfer",
  SETTLED_ON_CHAIN: "Settled; funds reached our payout partner",
  PAYOUT_PENDING: "Crediting recipient",
  PAYOUT_COMPLETE: "Delivered to recipient",
  PAYOUT_FAILED: "Recipient's bank rejected the credit",
  REFUND_PENDING: "Refund started",
  REFUNDED: "Refunded to your balance",
  REFUND_FAILED: "Refund needs manual action",
};

function Receipt({ t }: { t: TransferView }) {
  const created = t.events[0]?.at ?? t.createdAt;
  const paid = t.events.find((e) => e.status === "PAYOUT_COMPLETE")?.at;
  const rail = railOf(t.destAsset, t.recipient);
  const rows: [string, React.ReactNode][] = [
    ["Route", `${countryOf(t.sendAsset)} → ${countryOf(t.destAsset)}`],
    ["You sent", `${CUR[t.sendAsset]} ${fmt(t.sendAmount)}`],
    ["Transfer fee", `${CUR[t.sendAsset]} 0.00`],
    ["Exchange rate", `1 ${CUR[t.sendAsset]} = ${amt(t.destAsset, Number(t.receivedAmount ?? t.quotedDest) / Number(t.sendAmount), 4)}`],
    [t.receivedAmount ? "They received" : "They'll receive", <b key="r">{amt(t.destAsset, t.receivedAmount ?? t.quotedDest)}</b>],
    ["Recipient", `${t.recipient.name} · ${recipientLine(t.recipient)}`],
    ...(rail ? ([["Paid out via", RAILS[rail].label]] as [string, string][]) : []),
    ["Sent", new Date(created).toLocaleString()],
    ...(paid ? ([["Delivered in", `${((paid - created) / 1000).toFixed(1)} seconds`]] as [string, string][]) : []),
    ...(t.payoutRef ? ([[`Payout reference (${rail ? RAILS[rail].refName : "ref"})`, t.payoutRef]] as [string, string][]) : []),
    ["Our reference", t.id],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-zinc-500">To {t.recipient.name}</div>
          <div className="text-3xl font-bold tabular-nums">{amt(t.destAsset, t.receivedAmount ?? t.quotedDest)}</div>
        </div>
        <Pill status={t.status} />
      </div>
      <Tracker t={t} />
      <p className="text-sm text-zinc-600">{STATUS[t.status].help}</p>
      <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-xl border border-zinc-200 px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-zinc-700">Full history</summary>
        <ol className="mt-2 space-y-1.5">
          {t.events.map((e, i) => (
            <li key={i} className="flex justify-between gap-4 text-xs">
              <span>{EVENT_LABEL[e.status] ?? e.status}</span>
              <span className="tabular-nums text-zinc-500">{new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      </details>
      {t.txHash && (
        <div className="text-xs text-zinc-500">
          Settled on the Stellar network (testnet) for {stroopsToXlm(t.feeStroops ?? "100")} XLM.{" "}
          <a href={`${EXPLORER}/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline">
            View on the blockchain ↗
          </a>
        </div>
      )}
    </div>
  );
}

export function ActivityPage() {
  const { transfers } = useSession();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelected(id);
  }, []);
  const list = transfers.filter(FILTERS.find((f) => f.key === filter)!.match);
  const current = list.find((t) => t.id === selected) ?? list[0];

  return (
    <Shell title="Activity">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <Card>
          <div className="flex gap-2 border-b border-zinc-100 px-4 py-3">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1 text-sm font-medium ${filter === f.key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                {f.label} <span className="opacity-60">{transfers.filter(f.match).length}</span>
              </button>
            ))}
          </div>
          <ul className="max-h-[calc(100vh-220px)] divide-y divide-zinc-100 overflow-y-auto">
            {list.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(t.id);
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      url.searchParams.set("id", t.id);
                      window.history.replaceState(null, "", url.toString());
                    }
                  }}
                  className={`flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-zinc-50 ${current?.id === t.id ? "bg-emerald-50/60" : ""}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-semibold">{t.recipient.name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{t.recipient.name}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {dateTime(t.createdAt)} · {t.id}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{amt(t.destAsset, t.receivedAmount ?? t.quotedDest)}</div>
                    <div className="text-xs tabular-nums text-zinc-500">
                      {CUR[t.sendAsset]} {fmt(t.sendAmount)}
                    </div>
                  </div>
                  <Pill status={t.status} />
                </button>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-4 py-12 text-center text-sm text-zinc-500">
                Nothing here yet.{" "}
                <Link href="/send" className="font-medium text-emerald-700 underline">
                  Send money
                </Link>
              </li>
            )}
          </ul>
        </Card>
        <Card className="h-fit p-6">{current ? <Receipt t={current} /> : <div className="text-sm text-zinc-500">Select a transfer to see its receipt.</div>}</Card>
      </div>
    </Shell>
  );
}

// ---------------- Account ----------------

export function AccountPage() {
  const { user, wallet } = useSession();
  const [copied, setCopied] = useState(false);
  if (!user) return <Shell title="Account">{null}</Shell>;
  return (
    <Shell title="Account">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-semibold">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Name", user.displayName],
              ["Username", `@${user.username}`],
              ["Country", `${CURRENCY[ASSET_OF_COUNTRY[user.country]].flag} ${CURRENCY[ASSET_OF_COUNTRY[user.country]].countryName}`],
              ["Sends in", user.sendCurrency],
              ["Member since", new Date(user.memberSince).toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Identity verification</h2>
          {wallet?.restricted ? (
            <div className="mt-3">
              <Alert tone="error">Restricted after a compliance review. Contact support.</Alert>
            </div>
          ) : user.kyc === "VERIFIED" ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 font-bold text-white">✓</span>
              Verified. You can add and send money.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-zinc-600">Not verified yet. You can&apos;t add or send money until you are.</p>
              <Link href="/verify">
                <Button>Verify now</Button>
              </Link>
            </div>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Linked bank account</h2>
          <p className="mt-1 text-sm text-zinc-500">Simulated for this prototype.</p>
          <div className="mt-3 text-2xl font-bold tabular-nums">{wallet?.bank ? `${wallet.bank.currency} ${fmt(wallet.bank.balance)}` : "—"}</div>
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Your wallet</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Your balance lives in a wallet on the Stellar network (testnet). We hold its keys securely for you.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-zinc-50 p-3">
            <code className="min-w-0 flex-1 truncate text-xs">{user.walletAddress}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(user.walletAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium hover:bg-zinc-200"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <a href={user.walletExplorer} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-emerald-700 underline">
            View on the blockchain ↗
          </a>
        </Card>
      </div>
    </Shell>
  );
}

// ---------------- Verify identity ----------------

export function VerifyPage() {
  const { user, setUser, refreshWallet } = useSession();
  const router = useRouter();
  const [f, setF] = useState({ fullName: "", dob: "", idType: "EMIRATES_ID", idNumber: "", consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (user) {
      setF((x) => ({ ...x, fullName: x.fullName || user.displayName, idType: ID_FOR_COUNTRY[user.country] ?? "PASSPORT" }));
    }
  }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const p = await api<Profile>("/me/kyc", { body: { fullName: f.fullName, dob: f.dob, idType: f.idType, idNumber: f.idNumber } });
      setUser(p);
      await refreshWallet();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Verify your identity">
      <div className="mx-auto max-w-xl">
        {user?.kyc === "VERIFIED" || done ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl font-bold text-white">✓</div>
            <h2 className="mt-4 text-xl font-semibold">You&apos;re verified</h2>
            <p className="mt-1 text-sm text-zinc-600">Your wallet is now enabled on the network. Add money and send your first transfer.</p>
            <Button className="mt-6" onClick={() => router.push("/")}>
              Go to home
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            <p className="text-sm text-zinc-600">
              We&apos;re required by law to verify who you are before moving money. Your details are checked by our verification partner (simulated in this prototype).
            </p>
            {user?.walletStatus === "PROVISIONING" && (
              <div className="mt-4">
                <Alert tone="info">
                  <span className="flex items-center gap-2">
                    <Spinner /> Your wallet is still being set up. You can fill this in meanwhile.
                  </span>
                </Alert>
              </div>
            )}
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Full legal name">
                <Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
              </Field>
              <Field label="Date of birth" hint="You must be 18 or older">
                <Input type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} required max={new Date().toISOString().slice(0, 10)} />
              </Field>
              <div className="grid grid-cols-[180px_1fr] gap-3">
                <Field label="ID type">
                  <Select value={f.idType} onChange={(e) => setF({ ...f, idType: e.target.value })}>
                    <option value="EMIRATES_ID">Emirates ID</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="US_STATE_ID">US state ID</option>
                    <option value="AADHAAR">Aadhaar</option>
                    <option value="PAN">PAN card</option>
                    <option value="NATIONAL_ID">National ID card</option>
                    <option value="DRIVERS_LICENSE">Driving licence</option>
                    <option value="RESIDENCE_PERMIT">Residence card</option>
                  </Select>
                </Field>
                <Field label="ID number">
                  <Input value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} placeholder={{ EMIRATES_ID: "784-1990-1234567-1", AADHAAR: "1234-5678-9012", PAN: "ABCDE1234F" }[f.idType] ?? "A1234567"} required />
                </Field>
              </div>
              <label className="flex items-start gap-2 text-sm text-zinc-600">
                <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-1" />
                I confirm these details are correct and consent to identity and sanctions screening.
              </label>
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" className="w-full py-3" disabled={busy || !f.consent || user?.walletStatus !== "READY"}>
                {busy ? (
                  <>
                    <Spinner /> Verifying…
                  </>
                ) : (
                  "Verify my identity"
                )}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </Shell>
  );
}
