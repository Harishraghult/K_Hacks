/**
 * CLI smoke test for the core money path (no server):
 *   npm run cli:transfer -- [SENDER] [ASSET] [AMOUNT]
 *   e.g. npm run cli:transfer -- SENDER_1 tAED 100
 *        npm run cli:transfer -- UNVERIFIED_1 tAED 1    (expect network rejection)
 */
import { Memo, Operation } from "@stellar/stellar-sdk";
import {
  DEFAULT_SLIPPAGE_BPS,
  EXPLORER_BASE,
  StellarTxError,
  getQuote,
  hopToAsset,
  keypair,
  loadAccounts,
  parseAmount,
  server,
  stroopsToXlm,
  submitOps,
  type AccountName,
  type AssetCode,
} from "@remit/shared";

const [senderArg = "SENDER_1", assetArg = "tAED", amountArg = "100"] = process.argv.slice(2);

async function main() {
  const book = loadAccounts();
  const sender = senderArg as AccountName;
  const sendAsset = assetArg as AssetCode;
  const amount = parseAmount(amountArg);

  const q = await getQuote(book, sendAsset, amount, "tINR", DEFAULT_SLIPPAGE_BPS);
  console.log(`\nQuote ${q.quoteId}: send ${amount} ${sendAsset}`);
  console.log(`  mid rate ${q.midRate} INR/${sendAsset}  (FX ${q.fx.source}, as of ${q.fx.asOf})`);
  console.log(`  BEST  ${q.best.hops.map((h) => h.code).join(" → ")}  = ₹${q.best.destAmount}  (${q.best.costVsMidPct}% vs mid)`);
  for (const r of q.rejected) console.log(`  alt   ${r.hops.map((h) => h.code).join(" → ")}  = ₹${r.destAmount}  (${r.costVsMidPct}% vs mid)`);
  console.log(`  destMin (1% slippage) ₹${q.destMin}; network fee ${q.networkFee.xlm} XLM ≈ $${q.networkFee.usd}`);

  const memo = `T${Date.now().toString(36)}`;
  const t0 = Date.now();
  try {
    const res = await submitOps(keypair(book, sender), [
      Operation.pathPaymentStrictSend({
        sendAsset: hopToAsset(q.best.hops[0]),
        sendAmount: amount,
        destination: book.ANCHOR_RECV.publicKey,
        destAsset: hopToAsset(q.best.hops[q.best.hops.length - 1]),
        destMin: q.destMin,
        path: q.best.hops.slice(1, -1).map(hopToAsset),
      }),
    ], { memo: Memo.text(memo) });
    const ops = await server.operations().forTransaction(res.hash).call();
    const received = (ops.records[0] as unknown as { amount: string }).amount;
    console.log(`\n✔ settled in ${((Date.now() - t0) / 1000).toFixed(1)}s, ledger ${res.ledger}, memo ${memo}`);
    console.log(`  ANCHOR_RECV received ₹${received}; fee charged ${stroopsToXlm(res.feeCharged)} XLM`);
    console.log(`  ${EXPLORER_BASE}/tx/${res.hash}\n`);
  } catch (e) {
    if (e instanceof StellarTxError) {
      console.log(`\n✘ rejected by the network: ${e.primaryCode}\n  ${e.friendly}\n  raw: ${JSON.stringify(e.codes)}\n`);
      process.exit(2);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
