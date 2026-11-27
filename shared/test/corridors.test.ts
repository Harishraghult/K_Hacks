import { describe, expect, it } from "vitest";
import {
  ALL_ASSETS,
  CORRIDORS,
  corridorOf,
  CURRENCY_LIST,
  RAILS,
  isValidClabe,
  isValidSepaIban,
  normalizeRecipient,
  isValidAbaRouting,
  isValidUaeIban,
  midRate,
  payoutShouldFail,
  railOf,
  recipientLine,
  validateRecipientFor,
  type FxSnapshot,
} from "../src/index.js";

const upi = { name: "Lakshmi", upiId: "lakshmi@okaxis" };
const inBank = { name: "Lakshmi", bankAcct: "123456789012", ifsc: "SBIN0001234" };
const ach = { name: "John", bankAcct: "123456789", routingNumber: "021000021" };
const iban = { name: "Fatima", iban: "AE07 0331 2345 6789 0123 456" };

describe("corridors", () => {
  it("covers every ordered pair of the 11 currencies (110 corridors), never same-currency", () => {
    expect(ALL_ASSETS).toHaveLength(11);
    expect(CORRIDORS).toHaveLength(11 * 10);
    for (const from of ALL_ASSETS) for (const to of ALL_ASSETS) expect(!!corridorOf(from, to)).toBe(from !== to);
    expect(new Set(CORRIDORS.map((c) => c.id)).size).toBe(110);
    for (const id of ["USD-EUR", "EUR-JPY", "JPY-INR", "GBP-PHP", "MXN-CAD", "SGD-AUD", "AED-INR"]) expect(CORRIDORS.some((c) => c.id === id)).toBe(true);
  });
  it("mid rates are consistent in every direction", () => {
    const fx: FxSnapshot = { rates: { USD: "1", EUR: "0.86", GBP: "0.75", JPY: "155", CAD: "1.38", AUD: "1.52", SGD: "1.30", AED: "3.6725", INR: "92.92", PHP: "58.5", MXN: "18.5" }, inrPerUsd: "92.92", aedPerUsd: "3.6725", asOf: "x", source: "fallback" };
    for (const c of CORRIDORS) expect(Number(midRate(fx, c.from, c.to)) * Number(midRate(fx, c.to, c.from))).toBeCloseTo(1, 9);
    expect(Number(midRate(fx, "tINR", "tAED"))).toBeCloseTo(0.039523, 5);
    expect(Number(midRate(fx, "tEUR", "tJPY"))).toBeCloseTo(180.2326, 3);
    expect(Number(midRate(fx, "tGBP", "tINR"))).toBeCloseTo(123.8933, 3);
  });
  it("every currency has a rail whose demo samples validate (and the fail sample is rejected by the mock bank)", () => {
    for (const cur of CURRENCY_LIST) {
      expect(cur.rails.length).toBeGreaterThan(0);
      for (const rail of cur.rails) {
        expect(validateRecipientFor(cur.asset, { name: "X", ...RAILS[rail].sample }), `${cur.fiat} ${rail}`).toBeUndefined();
        expect(validateRecipientFor(cur.asset, { name: "X", ...RAILS[rail].failSample }), `${cur.fiat} ${rail} fail`).toBeUndefined();
        expect(payoutShouldFail({ name: "X", ...RAILS[rail].sample })).toBe(false);
        expect(payoutShouldFail({ name: "X", ...RAILS[rail].failSample })).toBe(true);
      }
    }
  });
});

describe("new rails", () => {
  it("SEPA IBAN, CLABE checksums", () => {
    expect(isValidSepaIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidSepaIban("DE88370400440532013000")).toBe(false);
    expect(isValidSepaIban("AE070331234567890123456")).toBe(false); // not euro-area
    expect(isValidClabe("002010077777777771")).toBe(true);
    expect(isValidClabe("002010077777777772")).toBe(false);
  });
  it("validates each rail and normalises input", () => {
    expect(validateRecipientFor("tGBP", { name: "x", sortCode: "20-00-00", bankAcct: "55779911" })).toBeUndefined();
    expect(validateRecipientFor("tGBP", { name: "x", sortCode: "20-00", bankAcct: "55779911" })).toMatch(/Sort code/);
    expect(validateRecipientFor("tJPY", { name: "x", bankCode: "0005", branchCode: "001", bankAcct: "123456" })).toMatch(/7 digits/);
    expect(validateRecipientFor("tCAD", { name: "x", email: "not-an-email" })).toMatch(/e-mail/);
    expect(validateRecipientFor("tSGD", { name: "x", mobile: "+63 917 123 4567" })).toMatch(/Singapore/);
    expect(validateRecipientFor("tPHP", { name: "x", mobile: "+639171234567" })).toBeUndefined();
    expect(validateRecipientFor("tEUR", { name: "x", upiId: "a@okaxis" })).toMatch(/SEPA/);
    expect(validateRecipientFor("tMXN", { name: "x", iban: "DE89370400440532013000" })).toMatch(/CLABE/);
    expect(normalizeRecipient("tGBP", { name: " x ", sortCode: "20-00-00", bankAcct: "5577 9911" })).toEqual({ name: "x", sortCode: "200000", bankAcct: "55779911" });
    expect(normalizeRecipient("tEUR", { name: "x", iban: "de89 3704 0044 0532 0130 00" }).iban).toBe("DE89370400440532013000");
  });
});

describe("payout rails", () => {
  it("validates routing numbers (ABA checksum) and UAE IBANs (mod-97)", () => {
    expect(isValidAbaRouting("021000021")).toBe(true);
    expect(isValidAbaRouting("021000022")).toBe(false);
    expect(isValidAbaRouting("12345")).toBe(false);
    expect(isValidUaeIban("AE070331234567890123456")).toBe(true);
    expect(isValidUaeIban("ae07 0331 2345 6789 0123 456")).toBe(true);
    expect(isValidUaeIban("AE080331234567890123456")).toBe(false);
    expect(isValidUaeIban("GB82WEST12345698765432")).toBe(false);
  });
  it("accepts the right rail for each destination", () => {
    expect(validateRecipientFor("tINR", upi)).toBeUndefined();
    expect(validateRecipientFor("tINR", inBank)).toBeUndefined();
    expect(validateRecipientFor("tUSDC", ach)).toBeUndefined();
    expect(validateRecipientFor("tAED", iban)).toBeUndefined();
    expect(railOf("tINR", upi)).toBe("UPI");
    expect(railOf("tINR", inBank)).toBe("IN_BANK");
    expect(railOf("tUSDC", ach)).toBe("US_ACH");
    expect(railOf("tAED", iban)).toBe("AE_IBAN");
  });
  it("rejects a rail that does not match the destination currency", () => {
    expect(validateRecipientFor("tUSDC", upi)).toMatch(/US bank/);
    expect(validateRecipientFor("tAED", upi)).toMatch(/IBAN/);
    expect(validateRecipientFor("tINR", iban)).toMatch(/UPI/);
    expect(validateRecipientFor("tAED", ach)).toMatch(/IBAN/);
  });
  it("rejects malformed details", () => {
    expect(validateRecipientFor("tINR", { name: "x", bankAcct: "123456789" })).toMatch(/IFSC/);
    expect(validateRecipientFor("tUSDC", { ...ach, routingNumber: "123456789" })).toMatch(/routing/);
    expect(validateRecipientFor("tAED", { name: "x", iban: "AE000000" })).toMatch(/IBAN/);
    expect(validateRecipientFor("tINR", { name: " ", upiId: "a@b" })).toMatch(/name/);
  });
  it("simulated bank rejections on every rail", () => {
    expect(payoutShouldFail({ name: "x", bankAcct: "1230000", routingNumber: "021000021" })).toBe(true);
    expect(payoutShouldFail({ name: "x", iban: "AE05 0331 2345 6789 0120 000" })).toBe(true);
    expect(payoutShouldFail(iban)).toBe(false);
  });
  it("formats recipient lines per rail", () => {
    expect(recipientLine(upi)).toBe("UPI · lakshmi@okaxis");
    expect(recipientLine(iban)).toBe("IBAN ••3456");
    expect(recipientLine(ach)).toBe("ACH ••6789 · RTN 021000021");
  });
});
