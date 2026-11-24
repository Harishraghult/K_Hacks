import type { Quote, TransferView } from "@remit/shared";

export const ANCHOR_URL = process.env.NEXT_PUBLIC_ANCHOR_URL ?? "http://localhost:4000";

export interface SenderBalance {
  balance: string;
  authorized: boolean;
  trustline: boolean;
  frozen: boolean;
}
export interface Sender {
  id: string;
  name: string;
  city: string;
  note?: string;
  publicKey: string;
  kyc: "PASSED" | "NOT_VERIFIED";
  sanctioned: boolean;
  balances: Record<"tUSDC" | "tAED", SenderBalance>;
  bank: { currency: "USD" | "AED"; balance: string };
  defaultAsset: "tUSDC" | "tAED";
}
export interface AppConfig {
  explorer: string;
  traditional: { FEE_PCT: string; SETTLEMENT: string; SOURCE: string; SOURCE_URL: string };
  compliance: { REVIEW_THRESHOLD_USD: string; DAILY_LIMIT_USD: string; REVIEW_EXPIRY_MIN: number };
  quoteTtlSec: number;
  xlmUsdReference: string;
  anchorRecv: string;
}
export interface Health {
  ok: boolean;
  horizon: { reachable: boolean; latestLedger?: number };
  needsBootstrap: boolean;
  missingAccounts: string[];
  watcher: { connected: boolean; cursor?: string; lastEventAt?: number; reconnects: number; lastError?: string };
  fx: { inrPerUsd: string; aedPerUsd: string; asOf: string; source: string };
  pools: { id: string; pair: string; price: string; target: string; driftPct: string }[];
}
export interface Unmatched {
  op_id: string;
  tx_hash: string;
  memo: string | null;
  amount: string;
  asset: string;
  reason: string;
  at: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; admin?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ANCHOR_URL + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.admin ? { "x-admin-token": init.admin } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, `Cannot reach the anchor server at ${ANCHOR_URL}. Is it running?`, "OFFLINE");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`, json.code);
  return json as T;
}

export type { Quote, TransferView };
export type { Recipient } from "@remit/shared";
