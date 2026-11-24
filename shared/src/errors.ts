/** Maps Horizon result codes to user-facing messages. Raw codes are always logged too. */
const OP_MESSAGES: Record<string, string> = {
  op_under_dest_min: "The exchange rate moved since your quote. Please review the new quote and confirm again.",
  op_over_source_max: "The exchange rate moved since your quote. Please review the new quote and confirm again.",
  op_too_few_offers: "Not enough liquidity for this amount right now. Try a smaller amount.",
  op_no_trust: "The receiving account cannot accept this currency yet (missing trustline).",
  op_src_no_trust: "Your wallet is not set up for this currency (missing trustline).",
  op_not_authorized: "Transfer not authorized: the receiving party has not passed KYC or is frozen.",
  op_src_not_authorized: "Transfer not authorized: your wallet has not passed KYC or is frozen.",
  op_underfunded: "Insufficient balance for this transfer.",
  op_low_reserve: "The account does not hold enough XLM for its minimum reserve.",
  op_line_full: "The receiving account has reached its holding limit for this currency.",
  op_no_destination: "The destination account does not exist.",
  op_no_issuer: "The currency issuer does not exist (network may have been reset).",
  op_cross_self: "This trade would match against your own offer.",
  op_malformed: "The transaction was malformed.",
  op_no_account: "The account does not exist (network may have been reset).",
  op_not_clawback_enabled: "Clawback is not enabled for this balance.",
  op_does_not_exist: "The referenced item does not exist.",
};

const TX_MESSAGES: Record<string, string> = {
  tx_bad_seq: "A conflicting transaction was sent at the same time. Please retry.",
  tx_insufficient_fee: "Network is busy; the fee was too low.",
  tx_insufficient_balance: "Not enough XLM to pay the network fee.",
  tx_too_late: "The transaction expired before it was processed.",
  tx_no_source_account: "The source account does not exist (network may have been reset).",
  tx_bad_auth: "Transaction signature invalid.",
};

export interface ResultCodes {
  transaction?: string;
  operations?: string[];
}

export class StellarTxError extends Error {
  constructor(
    public readonly codes: ResultCodes,
    public readonly friendly: string,
    public readonly hash?: string,
  ) {
    super(friendly);
  }
  get primaryCode(): string {
    return this.codes.operations?.find((c) => c !== "op_success") ?? this.codes.transaction ?? "unknown";
  }
}

export function friendlyMessage(codes: ResultCodes): string {
  const op = codes.operations?.find((c) => c !== "op_success");
  if (op && OP_MESSAGES[op]) return OP_MESSAGES[op];
  if (codes.transaction && TX_MESSAGES[codes.transaction]) return TX_MESSAGES[codes.transaction];
  return `Transaction failed (${op ?? codes.transaction ?? "unknown error"}).`;
}

/** Extracts result_codes from a Horizon submission error. */
export function extractResultCodes(err: unknown): ResultCodes | undefined {
  const e = err as { response?: { data?: { extras?: { result_codes?: ResultCodes } } } };
  return e?.response?.data?.extras?.result_codes;
}
