// Mirrors CompanyPicker.tsx's COUNTRIES list -- dial code for each country
// a company can be set up with, so a phone number captured anywhere in the
// app (POS customer capture, customer records) gets its country prefix
// added automatically from the company's own `country` field, never typed
// or picked by whoever's entering the number.
export const COUNTRY_DIAL_CODES: Record<string, string> = {
  "Saudi Arabia": "966",
  "United Arab Emirates": "971",
  Kuwait: "965",
  Bahrain: "973",
  Qatar: "974",
  Oman: "968",
  Egypt: "20",
  Jordan: "962",
  "United States": "1",
  "United Kingdom": "44",
};

const DEFAULT_DIAL_CODE = COUNTRY_DIAL_CODES["Saudi Arabia"]!;

/**
 * Normalizes a locally-typed phone number ("0501234567", "50 123 4567") to
 * digits prefixed with the company's country dial code, so it matches
 * whatever's stored for lookup regardless of how either was typed. A
 * number already carrying the dial code (or any "+") is left alone.
 */
export function normalizePhone(raw: string, country: string): string {
  const digits = raw.replace(/\D/g, "");
  const dialCode = COUNTRY_DIAL_CODES[country] ?? DEFAULT_DIAL_CODE;
  if (digits.startsWith(dialCode)) return digits;
  const local = digits.replace(/^0+/, ""); // strip a leading national trunk "0"
  return `${dialCode}${local}`;
}
