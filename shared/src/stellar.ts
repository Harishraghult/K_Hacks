import { Horizon, Keypair, TransactionBuilder, BASE_FEE, type xdr, type Memo } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, TX_TIMEOUT_SEC, MAX_FEE_STROOPS } from "./constants.js";
import { StellarTxError, extractResultCodes, friendlyMessage } from "./errors.js";

export const server = new Horizon.Server(HORIZON_URL);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-source-account mutex: serialises submissions so sequence numbers never collide. */
const locks = new Map<string, Promise<unknown>>();
export function withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(account) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  const tail = next.catch(() => undefined);
  locks.set(account, tail);
  tail.then(() => {
    if (locks.get(account) === tail) locks.delete(account);
  });
  return next;
}

export interface SubmitResult {
  hash: string;
  ledger: number;
  feeCharged: string; // stroops
}

async function getTxIfExists(hash: string) {
  try {
    return await server.transactions().transaction(hash).call();
  } catch {
    return undefined;
  }
}

async function baseFee(): Promise<number> {
  try {
    return Math.max(await server.fetchBaseFee(), Number(BASE_FEE));
  } catch {
    return Number(BASE_FEE);
  }
}

/**
 * Builds, signs and submits a tx with the given ops.
 * - serialised per source account
 * - tx_bad_seq: reload sequence, retry once
 * - tx_insufficient_fee: retry with higher fee (capped)
 * - timeout / 5xx: look the hash up before deciding anything (never double-send)
 */
export async function submitOps(
  source: Keypair,
  ops: xdr.Operation[],
  opts: { signers?: Keypair[]; memo?: Memo; onHash?: (hash: string) => void } = {},
): Promise<SubmitResult> {
  return withAccountLock(source.publicKey(), async () => {
    let fee = await baseFee();
    let seqRetries = 0;
    let feeRetries = 0;
    for (;;) {
      const account = await server.loadAccount(source.publicKey());
      const b = new TransactionBuilder(account, { fee: String(fee), networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(
        TX_TIMEOUT_SEC,
      );
      ops.forEach((op) => b.addOperation(op));
      if (opts.memo) b.addMemo(opts.memo);
      const tx = b.build();
      tx.sign(source, ...(opts.signers ?? []));
      const hash = Buffer.from(tx.hash()).toString("hex");
      opts.onHash?.(hash);
      try {
        const r = (await server.submitTransaction(tx)) as unknown as { hash: string; ledger: number; fee_charged?: string | number };
        const found = r.fee_charged === undefined ? await getTxIfExists(r.hash) : undefined;
        return { hash: r.hash, ledger: r.ledger, feeCharged: String(r.fee_charged ?? found?.fee_charged ?? fee * ops.length) };
      } catch (err) {
        const codes = extractResultCodes(err);
        if (!codes) {
          // Timeout / 504 / network error: the tx may still land. Poll by hash until it lands or its time bound passes.
          console.warn(`[stellar] submit of ${hash.slice(0, 8)} errored without result codes; checking by hash`);
          const deadline = Date.now() + (TX_TIMEOUT_SEC + 15) * 1000;
          while (Date.now() < deadline) {
            const found = await getTxIfExists(hash);
            if (found) {
              if (found.successful) return { hash, ledger: found.ledger_attr, feeCharged: String(found.fee_charged) };
              throw new StellarTxError({ transaction: "tx_failed" }, "Transaction failed on-chain.", hash);
            }
            await sleep(3000);
          }
          throw new StellarTxError({ transaction: "tx_too_late" }, friendlyMessage({ transaction: "tx_too_late" }), hash);
        }
        console.warn(`[stellar] tx ${hash.slice(0, 8)} rejected: ${JSON.stringify(codes)}`);
        if (codes.transaction === "tx_bad_seq" && seqRetries++ < 1) continue;
        if (codes.transaction === "tx_insufficient_fee" && feeRetries++ < 3 && fee * 2 <= MAX_FEE_STROOPS) {
          fee *= 2;
          continue;
        }
        throw new StellarTxError(codes, friendlyMessage(codes), hash);
      }
    }
  });
}

export async function loadAccountOrNull(pub: string) {
  try {
    return await server.loadAccount(pub);
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}
