/** npm run demo:seed — a few completed transfers so the UI isn't empty. Needs the anchor running. */
const BASE = process.env.ANCHOR_URL ?? "http://localhost:4000";

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(BASE + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${p}: ${json.error}`);
  return json;
}

const seeds = [
  { senderId: "SENDER_1", asset: "tAED", amount: "250", recipient: { name: "Lakshmi Kumar", upiId: "lakshmi@okaxis" }, purpose: "Family support" },
  { senderId: "SENDER_2", asset: "tUSDC", amount: "75", recipient: { name: "Lakshmi Kumar", upiId: "lakshmi@okaxis" }, purpose: "Education" },
  { senderId: "SENDER_3", asset: "tAED", amount: "120", recipient: { name: "Lakshmi Kumar", upiId: "lakshmi@okaxis" }, purpose: "Medical expenses" },
];

const ids: string[] = [];
for (const s of seeds) {
  const q = await call("GET", `/quote?sendAsset=${s.asset}&sendAmount=${s.amount}&destAsset=tINR`);
  const t = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: s.senderId, recipient: s.recipient, purpose: s.purpose });
  console.log(`• ${s.senderId} ${s.amount} ${s.asset} → ${t.transferId} (${t.status})`);
  ids.push(t.transferId);
}
for (const id of ids) {
  for (let i = 0; i < 60; i++) {
    const t = await call("GET", `/transfer/${id}`);
    if (["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED", "REFUNDED"].includes(t.status)) {
      console.log(`  ${id}: ${t.status} ₹${t.receivedAmount ?? "-"} ${t.payoutRef ?? ""}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
export {};
