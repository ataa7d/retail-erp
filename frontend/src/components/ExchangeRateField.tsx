import { useEffect, useState } from "react";
import { Field, TextInput } from "./FormField";
import { useBaseCurrency, useExchangeRateLookup } from "../lib/currency";

interface Props {
  currency: string;
  date: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/**
 * Rate input for a foreign-currency document. Pre-fills from the rate on
 * file for the document date, but stays editable (the bank's actual
 * contract rate is often slightly different) -- once the user types their
 * own rate, later date changes no longer overwrite it. Renders nothing for
 * the base currency, where the rate is always 1.
 */
export default function ExchangeRateField({ currency, date, value, onChange, label }: Props) {
  const baseCurrency = useBaseCurrency();
  const lookup = useExchangeRateLookup(currency, date);
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    setEdited(false);
  }, [currency]);

  useEffect(() => {
    if (!edited && lookup && !lookup.isBaseCurrency) {
      onChange(lookup.rate != null ? String(lookup.rate) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, edited]);

  if (!currency || currency === baseCurrency) return null;

  return (
    <Field label={label ?? `Exchange Rate (${baseCurrency} per 1 ${currency})`} required>
      <TextInput
        type="number"
        min="0.00000001"
        step="any"
        required
        value={value}
        onChange={(e) => {
          setEdited(true);
          onChange(e.target.value);
        }}
      />
      <span className="mt-1 block text-xs text-slate-400">
        {lookup?.rate != null
          ? `Rate on file: ${lookup.rate} (as of ${new Date(lookup.rateDate!).toLocaleDateString()})${edited && Number(value) !== lookup.rate ? " — overridden" : ""}`
          : lookup
            ? `No ${currency} rate on file for this date — enter one, or add it under Accounting › Exchange Rates.`
            : ""}
      </span>
    </Field>
  );
}
