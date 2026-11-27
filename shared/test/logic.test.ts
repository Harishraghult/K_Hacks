import { describe, expect, it } from "vitest";
import {
  AmountError,
  TRANSITIONS,
  STATUSES,
  applySlippage,
  canTransition,
  evaluateCompliance,
  friendlyMessage,
  midRate,
  newTransferId,
  parseAmount,
  payoutShouldFail,
  rankCandidates,
  stroopsToXlm,
  toStellar,
  type ComplianceInput,
  type FxSnapshot,
} from "../src/index.js";

describe("amount math", () => {
  it("normalises valid amounts to 7dp strings", () => {
    expect(parseAmount("100")).toBe("100.0000000");
    expect(parseAmount("0.0000001")).toBe("0.0000001");
    expect(parseAmount(" 5.5 ")).toBe("5.5000000");
  });
  it.each(["0", "-1", "abc", "1e5", "NaN", "", "1.12345678", "Infinity"])("rejects %s", (v) => {
    expect(() => parseAmount(v)).toThrow(AmountError);
  });
  it("rejects amounts above balance", () => {
    expect(() => parseAmount("10.0000001", { max: "10" })).toThrow(/balance/);
    expect(parseAmount("10", { max: "10" })).toBe("10.0000000");
  });
  it("never uses floats: 0.1 + 0.2 style inputs stay exact", () => {
    expect(toStellar("0.30000000000000004")).toBe("0.3000000");
  });
  it("slippage rounds down", () => {
    expect(applySlippage("2514.6915979", 100)).toBe("2489.5446819");
    expect(applySlippage("1", 100)).toBe("0.9900000");
  });
  it("converts stroops", () => {
    expect(stroopsToXlm("100")).toBe("0.0000100");
  });
});

describe("quote selection", () => {
  it("ranks candidates by destination amount, best first", () => {
    const c = (destAmount: string) => ({ hops: [], destAmount, costVsMidPct: "0" });
    const ranked = rankCandidates([c("2492.2"), c("2514.69"), c("100")]);
    expect(ranked.map((r) => r.destAmount)).toEqual(["2514.69", "2492.2", "100"]);
  });
  it("computes mid rates through USD", () => {
    const fx: FxSnapshot = { rates: { USD: "1", EUR: "0.86", GBP: "0.75", JPY: "155", CAD: "1.38", AUD: "1.52", SGD: "1.30", AED: "3.6725", INR: "92.92", PHP: "58.5", MXN: "18.5" }, inrPerUsd: "92.92", aedPerUsd: "3.6725", asOf: "x", source: "fallback" };
    expect(Number(midRate(fx, "tUSDC", "tINR"))).toBeCloseTo(92.92, 6);
    expect(Number(midRate(fx, "tAED", "tINR"))).toBeCloseTo(25.3016, 3);
  });
});

describe("state machine", () => {
  it("allows the happy path", () => {
    const path = ["CREATED", "COMPLIANCE_CHECK", "APPROVED", "SUBMITTED", "SETTLED_ON_CHAIN", "PAYOUT_PENDING", "PAYOUT_COMPLETE"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("allows the refund path", () => {
    expect(canTransition("PAYOUT_PENDING", "PAYOUT_FAILED")).toBe(true);
    expect(canTransition("PAYOUT_FAILED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("REFUND_PENDING", "REFUNDED")).toBe(true);
  });
  it("forbids skipping compliance or paying out twice", () => {
    expect(canTransition("CREATED", "SUBMITTED")).toBe(false);
    expect(canTransition("CREATED", "APPROVED")).toBe(false);
    expect(canTransition("PAYOUT_COMPLETE", "PAYOUT_PENDING")).toBe(false);
    expect(canTransition("BLOCKED", "APPROVED")).toBe(false);
  });
  it("every status has a transition entry", () => {
    for (const s of STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
});

describe("compliance", () => {
  const base: ComplianceInput = {
    senderKycPassed: true,
    senderAuthorizedOnChain: true,
    receiverAnchorAuthorizedOnChain: true,
    senderSanctioned: false,
    recipientSanctioned: false,
    usdAmount: "100",
    usdUsedToday: "0",
    reviewThresholdUsd: "1000",
    dailyLimitUsd: "5000",
  };
  it("approves a clean transfer", () => expect(evaluateCompliance(base).decision).toBe("APPROVED"));
  it("blocks sanctioned sender or recipient", () => {
    expect(evaluateCompliance({ ...base, senderSanctioned: true }).decision).toBe("BLOCKED");
    expect(evaluateCompliance({ ...base, recipientSanctioned: true }).decision).toBe("BLOCKED");
  });
  it("blocks when KYC missing or authorization revoked on-chain", () => {
    expect(evaluateCompliance({ ...base, senderKycPassed: false }).decision).toBe("BLOCKED");
    expect(evaluateCompliance({ ...base, senderAuthorizedOnChain: false }).decision).toBe("BLOCKED");
  });
  it("flags above threshold, exactly-at threshold passes", () => {
    expect(evaluateCompliance({ ...base, usdAmount: "1000.01" }).decision).toBe("FLAGGED_FOR_REVIEW");
    expect(evaluateCompliance({ ...base, usdAmount: "1000" }).decision).toBe("APPROVED");
  });
  it("blocks past the daily limit (block beats flag)", () => {
    const r = evaluateCompliance({ ...base, usdAmount: "1500", usdUsedToday: "4000" });
    expect(r.decision).toBe("BLOCKED");
    expect(r.reasons.join()).toMatch(/Daily limit/);
  });
});

describe("error mapping", () => {
  it("maps op codes to friendly messages", () => {
    expect(friendlyMessage({ transaction: "tx_failed", operations: ["op_under_dest_min"] })).toMatch(/rate moved/);
    expect(friendlyMessage({ transaction: "tx_failed", operations: ["op_src_not_authorized"] })).toMatch(/KYC/);
    expect(friendlyMessage({ transaction: "tx_bad_seq" })).toMatch(/retry/);
  });
  it("falls back to the raw code", () => {
    expect(friendlyMessage({ transaction: "tx_failed", operations: ["op_weird"] })).toMatch(/op_weird/);
  });
});

describe("memo / ids / payout sim", () => {
  it("transfer ids fit a 28-byte text memo", () => {
    for (let i = 0; i < 100; i++) expect(Buffer.byteLength(newTransferId())).toBeLessThanOrEqual(28);
    expect(newTransferId("B").startsWith("B")).toBe(true);
  });
  it("simulated payout failures", () => {
    expect(payoutShouldFail({ name: "x", upiId: "fail@upi" })).toBe(true);
    expect(payoutShouldFail({ name: "x", upiId: "ok@upi" })).toBe(false);
    expect(payoutShouldFail({ name: "x", bankAcct: "123450000" })).toBe(true);
  });
});
