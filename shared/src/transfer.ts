import type { AssetCode } from "./constants";
import type { RailRecipient } from "./corridors";
import { Big } from "./money";

export const STATUSES = [
  "CREATED",
  "COMPLIANCE_CHECK",
  "BLOCKED",
  "FLAGGED_FOR_REVIEW",
  "EXPIRED",
  "APPROVED",
  "SUBMITTED",
  "ON_CHAIN_FAILED",
  "SETTLED_ON_CHAIN",
  "PAYOUT_PENDING",
  "PAYOUT_COMPLETE",
  "PAYOUT_FAILED",
  "REFUND_PENDING",
  "REFUNDED",
  "REFUND_FAILED",
] as const;
export type TransferStatus = (typeof STATUSES)[number];

/**
 * CREATED → COMPLIANCE_CHECK → (BLOCKED | FLAGGED_FOR_REVIEW | APPROVED)
 * FLAGGED_FOR_REVIEW → (APPROVED | BLOCKED | EXPIRED)
 * APPROVED → SUBMITTED (or BLOCKED if the submit-time re-check fails)
 * SUBMITTED → (ON_CHAIN_FAILED | SETTLED_ON_CHAIN)
 * SETTLED_ON_CHAIN → PAYOUT_PENDING → (PAYOUT_COMPLETE | PAYOUT_FAILED → REFUND_PENDING → REFUNDED | REFUND_FAILED)
 */
export const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  CREATED: ["COMPLIANCE_CHECK"],
  COMPLIANCE_CHECK: ["BLOCKED", "FLAGGED_FOR_REVIEW", "APPROVED"],
  FLAGGED_FOR_REVIEW: ["APPROVED", "BLOCKED", "EXPIRED"],
  APPROVED: ["SUBMITTED", "BLOCKED"],
  SUBMITTED: ["ON_CHAIN_FAILED", "SETTLED_ON_CHAIN"],
  SETTLED_ON_CHAIN: ["PAYOUT_PENDING"],
  PAYOUT_PENDING: ["PAYOUT_COMPLETE", "PAYOUT_FAILED"],
  PAYOUT_FAILED: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED", "REFUND_FAILED"],
  BLOCKED: [],
  EXPIRED: [],
  ON_CHAIN_FAILED: [],
  PAYOUT_COMPLETE: [],
  REFUNDED: [],
  REFUND_FAILED: [],
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL: TransferStatus[] = STATUSES.filter((s) => TRANSITIONS[s].length === 0);

/** Statuses whose amount does NOT count toward the daily limit. */
export const NON_COUNTING: TransferStatus[] = ["BLOCKED", "EXPIRED", "ON_CHAIN_FAILED", "REFUNDED"];

/** Beneficiary + payout-rail details (UPI, IFSC, ABA, IBAN, sort code, Zengin, BSB, Interac, PayNow, GCash, CLABE). */
export type Recipient = RailRecipient;

export interface TravelRule {
  originatorName: string;
  originatorAccount: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  purpose: string;
}

export interface TransferEvent {
  status: TransferStatus;
  at: number;
  detail?: string;
}

/** Public view of a transfer (safe to send to the browser). */
export interface TransferView {
  id: string;
  batchId?: string;
  senderId: string;
  senderName: string;
  sendAsset: AssetCode;
  sendAmount: string;
  destAsset: AssetCode;
  quotedDest: string;
  destMin: string;
  usdEquiv: string;
  route: string[];
  rejectedRoutes: { route: string[]; destAmount: string }[];
  recipient: Recipient;
  status: TransferStatus;
  reasons: string[];
  errorCode?: string;
  errorMessage?: string;
  txHash?: string;
  feeStroops?: string;
  receivedAmount?: string;
  payoutRef?: string;
  refundTx?: string;
  createdAt: number;
  updatedAt: number;
  events: TransferEvent[];
}

// ---------------- compliance (pure) ----------------

export interface ComplianceInput {
  senderKycPassed: boolean;
  senderAuthorizedOnChain: boolean;
  receiverAnchorAuthorizedOnChain: boolean;
  senderSanctioned: boolean;
  recipientSanctioned: boolean;
  usdAmount: string;
  usdUsedToday: string;
  reviewThresholdUsd: string;
  dailyLimitUsd: string;
}

export type ComplianceDecision = { decision: "BLOCKED" | "FLAGGED_FOR_REVIEW" | "APPROVED"; reasons: string[] };

export function evaluateCompliance(i: ComplianceInput): ComplianceDecision {
  const block: string[] = [];
  if (!i.senderKycPassed) block.push("Sender has not passed KYC");
  if (!i.senderAuthorizedOnChain) block.push("Sender wallet not authorized on-chain (KYC missing or frozen)");
  if (!i.receiverAnchorAuthorizedOnChain) block.push("Receiving anchor not authorized for destination asset");
  if (i.senderSanctioned) block.push("Sender matches sanctions list");
  if (i.recipientSanctioned) block.push("Recipient matches sanctions list");
  if (new Big(i.usdUsedToday).plus(i.usdAmount).gt(i.dailyLimitUsd))
    block.push(`Daily limit exceeded (USD ${i.dailyLimitUsd} per sender per day)`);
  if (block.length) return { decision: "BLOCKED", reasons: block };
  if (new Big(i.usdAmount).gt(i.reviewThresholdUsd))
    return { decision: "FLAGGED_FOR_REVIEW", reasons: [`Amount above USD ${i.reviewThresholdUsd}: manual review + Travel Rule data required`] };
  return { decision: "APPROVED", reasons: [] };
}

/** Memo is TEXT, max 28 bytes. */
export function newTransferId(prefix: "T" | "B" = "T"): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${Date.now().toString(36).toUpperCase()}${rand}`;
}

/** Simulated payout outcome (pure, testable). */
export function payoutShouldFail(r: Recipient): boolean {
  // Mock bank: rejects fail@… handles, and any account / IBAN / CLABE / mobile ending in 0000.
  if (r.upiId?.toLowerCase() === "fail@upi" || r.email?.toLowerCase().startsWith("fail@")) return true;
  return [r.bankAcct, r.iban, r.clabe, r.mobile].some((v) => v?.replace(/[\s-]/g, "").endsWith("0000"));
}
