import { describe, expect, it } from "vitest";
import { allocateAmount, calculateLineAmounts, round2 } from "../src/money.js";

describe("calculateLineAmounts", () => {
  it("computes a VAT-inclusive retail line correctly", () => {
    const result = calculateLineAmounts({
      qty: 1,
      unitPrice: 115,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: true,
    });
    expect(result).toEqual({ netAmount: 100, vatAmount: 15, grossAmount: 115 });
  });

  it("computes a VAT-exclusive wholesale line correctly", () => {
    const result = calculateLineAmounts({
      qty: 1,
      unitPrice: 100,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: false,
    });
    expect(result).toEqual({ netAmount: 100, vatAmount: 15, grossAmount: 115 });
  });

  it("does not apply the retail formula to a wholesale (exclusive) line", () => {
    // The historical bug: amount * rate/(100+rate) applied to an exclusive
    // price understates VAT because that formula only makes sense when the
    // price already includes VAT.
    const result = calculateLineAmounts({
      qty: 10,
      unitPrice: 43.5,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: false,
    });
    // Correct: net = 435.00, vat = 15% of 435 = 65.25, gross = 500.25
    expect(result).toEqual({ netAmount: 435, vatAmount: 65.25, grossAmount: 500.25 });
    // The wrong retail formula would have given vat = 500.25 * 15/115 = 65.25 * (100/115)... a smaller number
    const wrongRetailFormula = round2((result.netAmount * 15) / 115);
    expect(wrongRetailFormula).not.toBe(result.vatAmount);
  });

  it("does not apply the rate on top of an already-inclusive price", () => {
    // The historical bug: vat = gross * rate% applied to a VAT-inclusive
    // price double-counts VAT.
    const result = calculateLineAmounts({
      qty: 1,
      unitPrice: 115,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: true,
    });
    const wrongRateOnGross = round2(115 * 0.15); // 17.25 -- wrong
    expect(result.vatAmount).not.toBe(wrongRateOnGross);
    expect(result.vatAmount).toBe(15);
  });

  it("handles a mixed 15% / 5% / zero-rated document, every line self-consistent", () => {
    const lines = [
      calculateLineAmounts({ qty: 2, unitPrice: 50, discountAmount: 0, vatRate: 15, priceIncludesVat: false }),
      calculateLineAmounts({ qty: 1, unitPrice: 200, discountAmount: 0, vatRate: 5, priceIncludesVat: false }),
      calculateLineAmounts({ qty: 3, unitPrice: 30, discountAmount: 0, vatRate: 0, priceIncludesVat: false }),
    ];

    for (const line of lines) {
      expect(round2(line.netAmount + line.vatAmount)).toBe(line.grossAmount);
    }

    expect(lines[0]).toEqual({ netAmount: 100, vatAmount: 15, grossAmount: 115 });
    expect(lines[1]).toEqual({ netAmount: 200, vatAmount: 10, grossAmount: 210 });
    expect(lines[2]).toEqual({ netAmount: 90, vatAmount: 0, grossAmount: 90 });

    const headerNet = round2(lines.reduce((sum, l) => sum + l.netAmount, 0));
    const headerVat = round2(lines.reduce((sum, l) => sum + l.vatAmount, 0));
    const headerGross = round2(lines.reduce((sum, l) => sum + l.grossAmount, 0));
    expect(round2(headerNet + headerVat)).toBe(headerGross);
    expect(headerNet).toBe(390);
    expect(headerVat).toBe(25);
    expect(headerGross).toBe(415);
  });

  it("recomputes a partial return from its own qty, never by scaling the original line", () => {
    const originalQty = 7;
    const returnQty = 2;
    const unitPrice = 10.06;

    const original = calculateLineAmounts({
      qty: originalQty,
      unitPrice,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: true,
    });

    const returned = calculateLineAmounts({
      qty: returnQty,
      unitPrice,
      discountAmount: 0,
      vatRate: 15,
      priceIncludesVat: true,
    });

    // Correct: a fresh calculation for qty=2.
    expect(returned).toEqual({ netAmount: 17.5, vatAmount: 2.62, grossAmount: 20.12 });

    // What you'd get if you (wrongly) scaled the original line's net/vat by
    // the returned fraction of the quantity instead of recomputing — off by
    // a cent on both net and vat despite matching gross, which misreports
    // the VAT return even though the total "looks right".
    const wrongScaledNet = round2((original.netAmount * returnQty) / originalQty);
    const wrongScaledVat = round2((original.vatAmount * returnQty) / originalQty);
    expect(wrongScaledNet).not.toBe(returned.netAmount);
    expect(wrongScaledVat).not.toBe(returned.vatAmount);

    expect(round2(returned.netAmount + returned.vatAmount)).toBe(returned.grossAmount);
  });

  it("applies a line discount before splitting VAT, on whichever basis the price is entered", () => {
    const inclusive = calculateLineAmounts({
      qty: 2,
      unitPrice: 60,
      discountAmount: 10,
      vatRate: 15,
      priceIncludesVat: true,
    });
    // extended = 120 - 10 = 110 (gross), net = 110/1.15 = 95.652...-> 95.65, vat = 14.35
    expect(inclusive).toEqual({ netAmount: 95.65, vatAmount: 14.35, grossAmount: 110 });
  });
});

describe("allocateAmount", () => {
  it("allocates a header charge across lines summing exactly to the charge", () => {
    // The historical bug: adding a header amount inside a line-level query
    // multiplies it by the line count (19.13 delivery fee on 5 lines -> 95.65).
    const weights = [20, 20, 20, 20, 20];
    const amounts = allocateAmount(19.13, weights);
    expect(amounts.length).toBe(5);
    expect(round2(amounts.reduce((a, b) => a + b, 0))).toBe(19.13);
    for (const a of amounts) {
      expect(a).not.toBe(19.13); // not multiplied onto every line
    }
  });

  it("gives the rounding remainder to the last line, not distributed arbitrarily", () => {
    const amounts = allocateAmount(10, [1, 1, 1]); // 3.333... each
    expect(amounts[0]).toBe(3.33);
    expect(amounts[1]).toBe(3.33);
    expect(amounts[2]).toBe(3.34); // remainder absorbed here
    expect(round2(amounts.reduce((a, b) => a + b, 0))).toBe(10);
  });

  it("sums to exactly the total across 1000 random allocations", () => {
    for (let i = 0; i < 1000; i++) {
      const lineCount = 1 + Math.floor(Math.random() * 20);
      const weights = Array.from({ length: lineCount }, () => Math.random() * 100 + 1);
      const total = round2(Math.random() * 10000);

      const amounts = allocateAmount(total, weights);
      const sum = round2(amounts.reduce((a, b) => a + b, 0));

      expect(sum).toBe(total);
    }
  });

  it("handles an all-zero-weight edge case by splitting evenly, still summing exactly", () => {
    const amounts = allocateAmount(9.99, [0, 0, 0]);
    expect(round2(amounts.reduce((a, b) => a + b, 0))).toBe(9.99);
  });
});
