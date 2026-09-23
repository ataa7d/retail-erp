/**
 * Pure money/VAT calculation. No I/O, no DB — this is the single place
 * net/vat/gross get computed from a line's raw inputs, so every caller
 * (POS, wholesale, returns, purchasing) produces numbers that satisfy the
 * database's fn_amounts_balance CHECK by construction, not by luck.
 */

export interface LineInput {
  qty: number;
  unitPrice: number;
  discountAmount: number;
  vatRate: number; // percent, e.g. 15, 5, 0
  priceIncludesVat: boolean;
}

export interface LineAmounts {
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

/** Round-half-up to 2 decimals. The only place rounding happens (rule D). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes net/vat/gross for one line. The third value is always derived
 * by addition/subtraction of the other two, never by its own independent
 * formula — that's what guarantees net + vat === gross exactly, regardless
 * of whether the price was entered inclusive or exclusive of VAT.
 */
export function calculateLineAmounts(input: LineInput): LineAmounts {
  const { qty, unitPrice, discountAmount, vatRate, priceIncludesVat } = input;
  const extended = qty * unitPrice - discountAmount;

  if (priceIncludesVat) {
    const grossAmount = round2(extended);
    const netAmount = round2(grossAmount / (1 + vatRate / 100));
    const vatAmount = round2(grossAmount - netAmount);
    return { netAmount, vatAmount, grossAmount };
  }

  const netAmount = round2(extended);
  const vatAmount = round2(netAmount * (vatRate / 100));
  const grossAmount = round2(netAmount + vatAmount);
  return { netAmount, vatAmount, grossAmount };
}

/**
 * Allocates `total` across `weights` proportionally, rounding each share to
 * 2 decimals and giving the rounding remainder to the LAST entry, so the
 * allocated amounts always sum to exactly `total` (rule D). Used for
 * spreading a header charge (delivery fee, document discount) across lines
 * — never add a header amount directly inside a line-level query (rule B).
 */
export function allocateAmount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares =
    weightSum === 0
      ? weights.map(() => total / weights.length)
      : weights.map((w) => (total * w) / weightSum);

  const amounts = shares.map(round2);
  const allocatedSum = round2(amounts.reduce((a, b) => a + b, 0));
  const remainder = round2(total - allocatedSum);
  const lastIndex = amounts.length - 1;
  amounts[lastIndex] = round2(amounts[lastIndex]! + remainder);

  return amounts;
}
