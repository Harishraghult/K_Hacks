/**
 * Integration test against the running anchor server + Stellar testnet.
 *   npm run e2e          (anchor must be running: npm run anchor)
 */
import { CURRENCY_LIST, RAILS } from "@remit/shared/corridors";

const BASE = process.env.ANCHOR_URL ?? "http://localhost:4000";
const ADMIN = process.env.ADMIN_TOKEN ?? "demo-admin";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown, admin = false): Promise<{ status: number; json: Json }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(admin ? { "x-admin-token": ADMIN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

async function waitFor(id: string, done: (s: string) => boolean, timeoutMs = 60000): Promise<Json> {
  const t0 = Date.now();
  for (;;) {
    const { json } = await call("GET", `/transfer/${id}`);
    if (done(json.status)) return json;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting on ${id}, last status ${json.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let failures = 0;
function check(name: string, ok: boolean, info = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${info ? `  — ${info}` : ""}`);
  if (!ok) failures++;
}

const recipient = { name: "Lakshmi Kumar", upiId: "lakshmi@okaxis" };

async function quote(sendAsset: string, amount: string, destAsset = "tINR") {
  const q = await call("GET", `/quote?sendAsset=${sendAsset}&sendAmount=${amount}&destAsset=${destAsset}`);
  if (q.status !== 200) throw new Error(`quote failed: ${JSON.stringify(q.json)}`);
  return q.json;
}

async function happyPath() {
  console.log("\n[1] deposit → quote → transfer → payout (SENDER_1, AED 100)");
  const dep = await call("POST", "/deposit", { senderId: "SENDER_1", fiatAmount: "100", fiatCurrency: "AED" });
  check("deposit mints tAED on-chain", dep.status === 200 && !!dep.json.txHash, dep.json.txHash ?? JSON.stringify(dep.json));
  const q = await quote("tAED", "100");
  check("quote picks best of ≥2 routes", q.rejected.length >= 1 && Number(q.best.destAmount) > Number(q.rejected[0].destAmount), `${q.best.hops.map((h: Json) => h.code).join("→")} ₹${q.best.destAmount} vs ₹${q.rejected[0]?.destAmount}`);
  const t0 = Date.now();
  const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SENDER_1", recipient });
  check("transfer approved", tr.status === 201 && tr.json.status === "APPROVED", JSON.stringify(tr.json.status ?? tr.json));
  const fin = await waitFor(tr.json.transferId, (s) => ["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "PAYOUT_FAILED", "REFUNDED"].includes(s));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check("payout complete with UTR", fin.status === "PAYOUT_COMPLETE" && /^UTR/.test(fin.payoutRef ?? ""), `${fin.status} ${fin.payoutRef ?? ""} ₹${fin.receivedAmount} in ${secs}s`);
  check("received ≥ destMin", Number(fin.receivedAmount) >= Number(fin.destMin));
  check("quote reuse rejected", (await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SENDER_1", recipient })).status === 409);
}

async function sanctioned() {
  console.log("\n[2] sanctioned sender is blocked by the backend");
  const q = await quote("tAED", "50");
  const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SANCTIONED_1", recipient });
  check("status BLOCKED", tr.json.status === "BLOCKED", (tr.json.transfer?.reasons ?? []).join("; "));
  console.log("    sanctioned recipient UPI:");
  const q2 = await quote("tAED", "50");
  const tr2 = await call("POST", "/transfer", { quoteId: q2.quoteId, senderId: "SENDER_2", recipient: { name: "X", upiId: "blocked@upi" } });
  check("recipient on list → BLOCKED", tr2.json.status === "BLOCKED", (tr2.json.transfer?.reasons ?? []).join("; "));
}

async function unverified() {
  console.log("\n[3] unverified wallet: backend bypassed, network rejects");
  const r = await call("POST", "/debug/force-transfer", { senderId: "UNVERIFIED_1", sendAsset: "tAED", amount: "1" });
  const fin = await waitFor(r.json.transferId, (s) => ["ON_CHAIN_FAILED", "PAYOUT_COMPLETE", "SETTLED_ON_CHAIN"].includes(s));
  check("ON_CHAIN_FAILED with op_src_not_authorized", fin.status === "ON_CHAIN_FAILED" && fin.errorCode === "op_src_not_authorized", `${fin.status} ${fin.errorCode}`);
}

async function payoutFailRefund() {
  console.log("\n[4] payout failure → refund to sender");
  const q = await quote("tUSDC", "20");
  const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SENDER_2", recipient: { name: "Bad Account", upiId: "fail@upi" } });
  const fin = await waitFor(tr.json.transferId, (s) => ["REFUNDED", "REFUND_FAILED", "PAYOUT_COMPLETE", "ON_CHAIN_FAILED"].includes(s), 90000);
  check("REFUNDED with refund tx", fin.status === "REFUNDED" && !!fin.refundTx, `${fin.status} ${fin.events.at(-1)?.detail ?? ""}`);
}

async function flaggedReview() {
  console.log("\n[5] large transfer flagged, admin approves");
  await call("POST", "/deposit", { senderId: "SENDER_3", fiatAmount: "4000", fiatCurrency: "AED" });
  const q = await quote("tAED", "4000"); // ≈ USD 1089 > 1000 threshold
  const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SENDER_3", recipient, purpose: "Medical expenses" });
  check("FLAGGED_FOR_REVIEW", tr.json.status === "FLAGGED_FOR_REVIEW", (tr.json.transfer?.reasons ?? []).join("; "));
  check("approve needs admin token", (await call("POST", `/admin/approve/${tr.json.transferId}`)).status === 401);
  const ap = await call("POST", `/admin/approve/${tr.json.transferId}`, undefined, true);
  check("admin approve accepted", ap.status === 200);
  const fin = await waitFor(tr.json.transferId, (s) => ["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED"].includes(s));
  check("approved transfer paid out", fin.status === "PAYOUT_COMPLETE", `${fin.status} ${fin.errorCode ?? ""}`);
}

async function batch() {
  console.log("\n[6] micro-remittance: 10 × USD 5 in one ledger");
  const r = await call("POST", "/transfer/batch", { senderId: "SENDER_2", sendAsset: "tUSDC", amountEach: "5", count: 10, recipient });
  check("batch created", r.status === 201 && r.json.transferIds?.length === 10, JSON.stringify(r.json.error ?? ""));
  const fins = await Promise.all((r.json.transferIds ?? []).map((id: string) => waitFor(id, (s) => ["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED"].includes(s), 90000)));
  const ok = fins.filter((f) => f.status === "PAYOUT_COMPLETE");
  const hashes = new Set(fins.map((f) => f.txHash));
  const fee = fins.reduce((a, f) => a + Number(f.feeStroops ?? 0), 0);
  check("all 10 paid out, single tx", ok.length === 10 && hashes.size === 1, `${ok.length}/10, ${hashes.size} tx, total fee ${fee} stroops`);
  check("10 distinct UTRs", new Set(ok.map((f) => f.payoutRef)).size === ok.length);
}

async function validation() {
  console.log("\n[7] input validation");
  for (const bad of ["0", "-5", "abc", "1.12345678", "NaN"]) {
    const r = await call("GET", `/quote?sendAsset=tAED&sendAmount=${encodeURIComponent(bad)}`);
    check(`rejects amount "${bad}"`, r.status === 400, r.json.error);
  }
  const r = await call("POST", "/transfer", { quoteId: "nope", senderId: "SENDER_1", recipient: { name: "x" } });
  check("rejects recipient without UPI/bank", r.status === 400, r.json.error);
  const big = await quote("tAED", "900000");
  check("price impact warning on huge amount", big.priceImpactWarning === true, `${big.best.costVsMidPct}% vs mid`);
}

// Beneficiaries on each payout rail.
const BENEFICIARY: Record<string, Json> = {
  tINR: recipient,
  tUSDC: { name: "John Miller", bankAcct: "123456789", routingNumber: "021000021" },
  tAED: { name: "Fatima Al Mansoori", iban: "AE070331234567890123456" },
};
const REF_PREFIX: Record<string, RegExp> = { tINR: /^UTR/, tUSDC: /^ACH/, tAED: /^FTS/ };

async function corridors() {
  console.log("\n[9] every corridor: AED/USD/INR → each other currency, real path payment + local payout");
  const dep = await call("POST", "/deposit", { senderId: "SENDER_4", fiatAmount: "3000", fiatCurrency: "INR" });
  check("INR deposit (India sender) mints tINR", dep.status === 200 && !!dep.json.txHash, dep.json.txHash ?? JSON.stringify(dep.json));
  const cases = [
    { from: "tAED", to: "tINR", amount: "20", sender: "SENDER_3" },
    { from: "tAED", to: "tUSDC", amount: "20", sender: "SENDER_3" },
    { from: "tUSDC", to: "tINR", amount: "5", sender: "SENDER_3" },
    { from: "tUSDC", to: "tAED", amount: "5", sender: "SENDER_3" },
    { from: "tINR", to: "tUSDC", amount: "1000", sender: "SENDER_4" },
    { from: "tINR", to: "tAED", amount: "1000", sender: "SENDER_4" },
  ];
  // Sequential per sender (one source account = one sequence number), the two senders in parallel.
  const run = async (c: (typeof cases)[number]) => {
    const q = await quote(c.from, c.amount, c.to);
    const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: c.sender, recipient: BENEFICIARY[c.to] });
    if (tr.status !== 201) return { c, fin: { status: `HTTP ${tr.status}`, error: tr.json.error } as Json, route: "" };
    const fin = await waitFor(tr.json.transferId, (s) => ["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED", "REFUNDED", "REFUND_FAILED"].includes(s), 90000);
    return { c, fin, route: q.best.hops.map((h: Json) => h.code).join("→") };
  };
  const bySender = (s: string) => cases.filter((c) => c.sender === s);
  const results = (
    await Promise.all(["SENDER_3", "SENDER_4"].map(async (s) => {
      const out = [];
      for (const c of bySender(s)) out.push(await run(c));
      return out;
    }))
  ).flat();
  for (const { c, fin, route } of results) {
    const ok = fin.status === "PAYOUT_COMPLETE" && REF_PREFIX[c.to].test(fin.payoutRef ?? "") && fin.destAsset === c.to && Number(fin.receivedAmount) >= Number(fin.destMin);
    check(`${c.from} → ${c.to} paid out`, ok, `${c.amount} ${c.from} via ${route} → ${fin.receivedAmount ?? "-"} ${c.to}, ${fin.status} ${fin.payoutRef ?? fin.error ?? fin.errorCode ?? ""}`);
  }

  console.log("    rail validation:");
  const qUsd = await quote("tAED", "10", "tUSDC");
  const wrong = await call("POST", "/transfer", { quoteId: qUsd.quoteId, senderId: "SENDER_1", recipient: recipient });
  check("USD payout to a UPI ID → 400", wrong.status === 400 && wrong.json.code === "RECIPIENT_RAIL", wrong.json.error);
  const right = await call("POST", "/transfer", { quoteId: qUsd.quoteId, senderId: "SENDER_1", recipient: { ...BENEFICIARY.tUSDC, routingNumber: "021000022" } });
  check("bad ABA checksum → 400 (quote not consumed)", right.status === 400, right.json.error);
  const qAed = await quote("tINR", "500", "tAED");
  const badIban = await call("POST", "/transfer", { quoteId: qAed.quoteId, senderId: "SENDER_4", recipient: { name: "X", iban: "AE080331234567890123456" } });
  check("bad IBAN checksum → 400", badIban.status === 400, badIban.json.error);
  const same = await call("GET", "/quote?sendAsset=tINR&sendAmount=100&destAsset=tINR");
  check("same-currency quote → 400", same.status === 400 && same.json.code === "SAME_CURRENCY", same.json.error);
  const sanc = await call("POST", "/transfer", { quoteId: qAed.quoteId, senderId: "SENDER_4", recipient: { name: "Y", iban: "AE85 0331 2345 6789 0999 999" } });
  check("sanctioned IBAN → BLOCKED", sanc.json.status === "BLOCKED", (sanc.json.transfer?.reasons ?? []).join("; "));

  console.log("    refund on a non-INR corridor:");
  const qr = await quote("tINR", "800", "tAED");
  const rr = await call("POST", "/transfer", { quoteId: qr.quoteId, senderId: "SENDER_4", recipient: { name: "Closed Account", iban: "AE050331234567890120000" } });
  const rfin = await waitFor(rr.json.transferId, (s) => ["REFUNDED", "REFUND_FAILED", "PAYOUT_COMPLETE", "ON_CHAIN_FAILED"].includes(s), 90000);
  check("INR → AED, bank rejects → REFUNDED in INR", rfin.status === "REFUNDED" && !!rfin.refundTx, `${rfin.status} ${rfin.events?.at(-1)?.detail ?? ""}`);
}

/** Every currency gets a "$8-ish" amount in its own units. */
async function usdRates(): Promise<Record<string, string>> {
  return (await call("GET", "/health")).json.fx.rates;
}
const inUnits = (usd: number, perUsd: string, dp: number) => (usd * Number(perUsd)).toFixed(dp === 0 ? 0 : 2);

async function matrix() {
  console.log(`\n[10] route matrix: quote all ${CURRENCY_LIST.length * (CURRENCY_LIST.length - 1)} corridors (≈ USD 10 each) on live testnet liquidity`);
  const rates = await usdRates();
  const pairs = CURRENCY_LIST.flatMap((a) => CURRENCY_LIST.filter((b) => b !== a).map((b) => [a, b] as const));
  const bad: string[] = [];
  let worst = { id: "", cost: -Infinity };
  for (let i = 0; i < pairs.length; i += 5) {
    await Promise.all(
      pairs.slice(i, i + 5).map(async ([a, b]) => {
        const amount = inUnits(10, rates[a.fiat], a.dp);
        const q = await call("GET", `/quote?sendAsset=${a.asset}&sendAmount=${amount}&destAsset=${b.asset}`);
        const id = `${a.fiat}→${b.fiat}`;
        if (q.status !== 200) return bad.push(`${id}: HTTP ${q.status} ${q.json.error}`);
        const cost = Number(q.json.best.costVsMidPct);
        if (cost > worst.cost) worst = { id: `${id} via ${q.json.best.hops.map((h: Json) => h.code).join("→")}`, cost };
        if (!(Number(q.json.best.destAmount) > 0) || cost > 3) bad.push(`${id}: ${q.json.best.destAmount} (${cost}% vs mid)`);
      }),
    );
  }
  check(`all ${pairs.length} corridors quote within 3% of mid`, bad.length === 0, bad.length ? bad.slice(0, 5).join("; ") : `worst ${worst.id} at ${worst.cost}%`);
}

async function currencies() {
  console.log(`\n[11] every currency out AND in: ${CURRENCY_LIST.map((c) => c.fiat).join(" → ")} → ${CURRENCY_LIST[0].fiat} (one real transfer each, every payout rail)`);
  const rates = await usdRates();
  const ring = CURRENCY_LIST.map((c, i) => [c, CURRENCY_LIST[(i + 1) % CURRENCY_LIST.length]] as const);
  for (const [from, to] of ring) {
    const amount = inUnits(8, rates[from.fiat], from.dp);
    const dep = await call("POST", "/deposit", { senderId: "SENDER_6", fiatAmount: inUnits(9, rates[from.fiat], from.dp), fiatCurrency: from.fiat });
    if (dep.status !== 200) {
      check(`${from.fiat} → ${to.fiat}`, false, `deposit failed: ${dep.json.error}`);
      continue;
    }
    const q = await quote(from.asset, amount, to.asset);
    const recipientTo = { name: "E2E Beneficiary", ...RAILS[to.rails[0]].sample };
    const tr = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: "SENDER_6", recipient: recipientTo });
    if (tr.status !== 201) {
      check(`${from.fiat} → ${to.fiat}`, false, `HTTP ${tr.status} ${tr.json.error}`);
      continue;
    }
    const fin = await waitFor(tr.json.transferId, (s) => ["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED", "REFUNDED", "REFUND_FAILED"].includes(s), 90000);
    const rail = RAILS[to.rails[0]];
    check(
      `${from.fiat} → ${to.fiat} via ${rail.short}`,
      fin.status === "PAYOUT_COMPLETE" && (fin.payoutRef ?? "").startsWith(rail.refPrefix) && Number(fin.receivedAmount) >= Number(fin.destMin),
      `${from.symbol}${amount} → ${to.symbol}${fin.receivedAmount ?? "-"} via ${q.best.hops.map((h: Json) => h.code).join("→")}, ${fin.status} ${fin.payoutRef ?? fin.errorCode ?? ""}`,
    );
  }
  console.log("    refund on a new rail (bank rejects a SEPA credit):");
  const qe = await quote("tJPY", "800", "tEUR");
  const re = await call("POST", "/transfer", { quoteId: qe.quoteId, senderId: "SENDER_6", recipient: { name: "Closed Account", ...RAILS.SEPA.failSample } });
  const rfin = await waitFor(re.json.transferId, (s) => ["REFUNDED", "REFUND_FAILED", "PAYOUT_COMPLETE", "ON_CHAIN_FAILED"].includes(s), 90000);
  check("JPY → EUR, SEPA rejects → REFUNDED in JPY", rfin.status === "REFUNDED" && !!rfin.refundTx, `${rfin.status} ${rfin.events?.at(-1)?.detail ?? ""}`);
}

async function stray() {
  console.log("\n[8] stray payment (unknown memo) is not paid out");
  const r = await call("POST", "/admin/simulate-stray-payment", {}, true);
  check("stray payment sent", r.status === 200, r.json.txHash);
  await new Promise((res) => setTimeout(res, 8000));
  const u = await call("GET", "/admin/unmatched", undefined, true);
  check("appears in unmatched list", Array.isArray(u.json) && u.json.some((x: Json) => x.tx_hash === r.json.txHash));
}

// The suite needs the fresh demo state: demo sessions spend balances and may verify the "no KYC" wallet.
{
  const s = (await call("GET", "/senders")).json as Json[];
  const by = (id: string) => s.find((x) => x.id === id) ?? {};
  const problems: string[] = [];
  const sel = process.argv[2];
  // Each check only matters for the suites that spend that balance.
  const need = (...suites: string[]) => !sel || suites.includes(sel);
  if (need("unverified") && by("UNVERIFIED_1").kyc === "PASSED") problems.push("the unverified demo wallet has been verified");
  if (need("happyPath") && Number(by("SENDER_1").bank?.balance ?? 0) < 100) problems.push("Ravi's mock bank is below AED 100");
  if (need("flaggedReview") && Number(by("SENDER_3").bank?.balance ?? 0) < 4000) problems.push("Arjun's mock bank is below AED 4,000");
  if (need("currencies") && Number(by("SENDER_6").bank?.balance ?? 0) < 20000) problems.push("Kenji's mock bank is below JPY 20,000");
  if (need("currencies") && Number(by("SENDER_6").balances?.tJPY?.balance ?? 0) < 1000) problems.push("Kenji's JPY wallet is below 1,000");
  if (need("batch", "payoutFailRefund") && Number(by("SENDER_2").balances?.tUSDC?.balance ?? 0) < 75) problems.push("Maria's USD wallet is below 75");
  if (need("corridors") && Number(by("SENDER_3").balances?.tUSDC?.balance ?? 0) < 10) problems.push("Arjun's USD wallet is below 10");
  if (need("corridors") && Number(by("SENDER_4").bank?.balance ?? 0) < 3000) problems.push("Priya's mock bank is below INR 3,000");
  if (problems.length) {
    console.error(`\nDemo state is used up: ${problems.join("; ")}.\nStop the anchor, run \`npm run demo:reset\`, start it again, then re-run the e2e.\n`);
    process.exit(2);
  }
}

const only = process.argv[2];
const suites: Record<string, () => Promise<void>> = { happyPath, sanctioned, unverified, payoutFailRefund, flaggedReview, batch, validation, stray, corridors, matrix, currencies };
for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue;
  try {
    await fn();
  } catch (e) {
    check(`${name} threw`, false, (e as Error).message);
  }
}
console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
export {};
