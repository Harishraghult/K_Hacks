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
  // The other corridors
  { senderId: "SENDER_4", asset: "tINR", dest: "tAED", amount: "5000", recipient: { name: "Fatima Al Mansoori", iban: "AE070331234567890123456" }, purpose: "Family support" },
  { senderId: "SENDER_4", asset: "tINR", dest: "tUSDC", amount: "4000", recipient: { name: "John Miller", bankAcct: "123456789", routingNumber: "021000021" }, purpose: "Education" },
  { senderId: "SENDER_1", asset: "tAED", dest: "tUSDC", amount: "100", recipient: { name: "John Miller", bankAcct: "123456789", routingNumber: "021000021" }, purpose: "Gift" },
  { senderId: "SENDER_2", asset: "tUSDC", dest: "tAED", amount: "30", recipient: { name: "Fatima Al Mansoori", iban: "AE070331234567890123456" }, purpose: "Family support" },
  { senderId: "SENDER_5", asset: "tEUR", dest: "tINR", amount: "80", recipient: { name: "Lakshmi Kumar", upiId: "lakshmi@okaxis" }, purpose: "Family support" },
  { senderId: "SENDER_5", asset: "tEUR", dest: "tGBP", amount: "50", recipient: { name: "Oliver Smith", sortCode: "200000", bankAcct: "55779911" }, purpose: "Gift" },
  { senderId: "SENDER_6", asset: "tJPY", dest: "tPHP", amount: "12000", recipient: { name: "Maria Reyes", mobile: "09171234567" }, purpose: "Family support" },
  { senderId: "SENDER_6", asset: "tJPY", dest: "tUSDC", amount: "8000", recipient: { name: "John Miller", routingNumber: "021000021", bankAcct: "123456789" }, purpose: "Education" },
] as { senderId: string; asset: string; dest?: string; amount: string; recipient: Record<string, string>; purpose: string }[];

const ids: string[] = [];
for (const s of seeds) {
  const q = await call("GET", `/quote?sendAsset=${s.asset}&sendAmount=${s.amount}&destAsset=${s.dest ?? "tINR"}`);
  const t = await call("POST", "/transfer", { quoteId: q.quoteId, senderId: s.senderId, recipient: s.recipient, purpose: s.purpose });
  console.log(`• ${s.senderId} ${s.amount} ${s.asset} → ${s.dest ?? "tINR"}: ${t.transferId} (${t.status})`);
  ids.push(t.transferId);
}
for (const id of ids) {
  for (let i = 0; i < 60; i++) {
    const t = await call("GET", `/transfer/${id}`);
    if (["PAYOUT_COMPLETE", "ON_CHAIN_FAILED", "BLOCKED", "REFUNDED"].includes(t.status)) {
      console.log(`  ${id}: ${t.status} ${t.receivedAmount ?? "-"} ${t.destAsset} ${t.payoutRef ?? ""}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
export {};
