import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { apiRequest } from "./api";

export function useBaseCurrency(): string {
  const { companies, companyId } = useAuth();
  return companies.find((c) => c.id === companyId)?.base_currency ?? "SAR";
}

export function formatMoney(amount: number | string | null | undefined, currency?: string): string {
  const n = Number(amount ?? 0);
  const text = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${text} ${currency}` : text;
}

interface RateLookup {
  rate: number | null;
  rateDate: string | null;
  isBaseCurrency: boolean;
}

/** The rate on file for `currency` on or before `date` (1 for the base currency). */
export function useExchangeRateLookup(currency: string, date: string) {
  const { token, companyId } = useAuth();
  const [result, setResult] = useState<RateLookup | null>(null);

  useEffect(() => {
    if (!currency || !date || !token || !companyId || !/^[A-Z]{3}$/.test(currency)) {
      setResult(null);
      return;
    }
    let cancelled = false;
    apiRequest<RateLookup>(`/api/exchange-rates/lookup?currency=${currency}&date=${date}`, { token, companyId })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currency, date, token, companyId]);

  return result;
}
