import { Operation, type xdr } from "@stellar/stellar-sdk";
import {
  ISSUER_FOR,
  assetOf,
  hopToAsset,
  keypair,
  loadAccountOrNull,
  server,
  submitOps,
  type AccountBook,
  type AccountName,
  type AssetCode,
  type PathHop,
} from "@remit/shared";

export interface LineState {
  exists: boolean;
  authorized: boolean;
  balance: string;
}

export async function trustlines(book: AccountBook, pub: string, codes: AssetCode[]): Promise<Record<string, LineState>> {
  const acc = await loadAccountOrNull(pub);
  const out: Record<string, LineState> = {};
  for (const code of codes) {
    const a = assetOf(book, code);
    const line = acc?.balances.find(
      (b) => "asset_code" in b && b.asset_code === a.getCode() && "asset_issuer" in b && b.asset_issuer === a.getIssuer(),
    ) as { balance: string; is_authorized: boolean } | undefined;
    out[code] = { exists: !!line, authorized: !!line?.is_authorized, balance: line?.balance ?? "0" };
  }
  return out;
}

/** Issuer (de)authorises a holder's trustlines. Skips lines already in the desired state. */
export async function setAuthorized(book: AccountBook, pub: string, codes: AssetCode[], authorized: boolean) {
  const lines = await trustlines(book, pub, codes);
  const done: AssetCode[] = [];
  for (const code of codes) {
    if (!lines[code].exists || lines[code].authorized === authorized) continue;
    await submitOps(keypair(book, ISSUER_FOR[code] as AccountName), [
      Operation.setTrustLineFlags({ trustor: pub, asset: assetOf(book, code), flags: { authorized } }),
    ]);
    done.push(code);
  }
  return done;
}

export function pathPaymentOp(hops: PathHop[], sendAmount: string, destination: string, destMin: string, source?: string): xdr.Operation {
  return Operation.pathPaymentStrictSend({
    sendAsset: hopToAsset(hops[0]),
    sendAmount,
    destination,
    destAsset: hopToAsset(hops[hops.length - 1]),
    destMin,
    path: hops.slice(1, -1).map(hopToAsset),
    ...(source ? { source } : {}),
  });
}

/** Reads what each path-payment op in a tx actually delivered, in op order. */
export async function deliveredAmounts(txHash: string): Promise<{ id: string; amount: string }[]> {
  const ops = await server.operations().forTransaction(txHash).limit(100).call();
  return ops.records.map((o) => ({ id: o.id, amount: (o as unknown as { amount?: string }).amount ?? "0" }));
}
