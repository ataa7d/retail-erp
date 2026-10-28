import { useApiList } from "./useApiList";

interface TaxCodeForDefault {
  rate: string;
  tax_type: "standard" | "zero_rated" | "exempt";
  is_active: boolean;
  is_default: boolean;
}

// Fallback only -- every company gets a default standard-rate tax code at
// creation (companyBootstrapService.ts), so this never actually applies.
// Kept so a form still shows something sane if that code is ever deactivated
// without a replacement default being set (Accounting > Tax Codes).
const FALLBACK_VAT_RATE = "15";

/**
 * The company's default standard-rate tax code (Accounting > Tax Codes,
 * tax_codes.is_default), as a plain percentage string for seeding a new
 * document line -- e.g. "15", not "15.00". Centralizes the lookup every
 * transaction form needs instead of each one hardcoding "15" and never
 * correcting it for a company whose default rate differs.
 */
export function useDefaultVatRate(): string {
  const { data: taxCodes } = useApiList<TaxCodeForDefault>("/api/tax-codes");
  const rate = taxCodes?.find((t) => t.is_default && t.is_active)?.rate;
  return rate !== undefined ? String(Number(rate)) : FALLBACK_VAT_RATE;
}
