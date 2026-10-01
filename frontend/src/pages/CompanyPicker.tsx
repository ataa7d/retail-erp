import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ChevronRight, Plus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";

// A short curated list, not a full ISO-3166 picker -- country here mostly
// exists to pre-fill a sensible default currency; the field stays a plain
// text input afterward so nothing is blocked from using a country/currency
// combination not in this list.
const COUNTRIES: Array<[string, string]> = [
  ["Saudi Arabia", "SAR"],
  ["United Arab Emirates", "AED"],
  ["Kuwait", "KWD"],
  ["Bahrain", "BHD"],
  ["Qatar", "QAR"],
  ["Oman", "OMR"],
  ["Egypt", "EGP"],
  ["Jordan", "JOD"],
  ["United States", "USD"],
  ["United Kingdom", "GBP"],
];

function NewCompanyForm({ onClose }: { onClose: () => void }) {
  const { createCompany } = useAuth();
  const navigate = useNavigate();
  const [companyCode, setCompanyCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0]![0]);
  const [baseCurrency, setBaseCurrency] = useState(COUNTRIES[0]![1]);
  const [vatRate, setVatRate] = useState("15");
  const [fiscalYearStart, setFiscalYearStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function selectCountry(name: string) {
    setCountry(name);
    const match = COUNTRIES.find((c) => c[0] === name);
    if (match) setBaseCurrency(match[1]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createCompany({
        companyCode,
        nameEn,
        nameAr,
        country,
        baseCurrency: baseCurrency.toUpperCase(),
        vatRate: Number(vatRate),
        fiscalYearStart,
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name (English)" required>
          <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="Name (Arabic)" required>
          <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
      </div>
      <Field label="Company Code" required>
        <TextInput required value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toUpperCase())} placeholder="e.g. UAE01" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" required>
          <SelectInput required value={country} onChange={(e) => selectCountry(e.target.value)}>
            {COUNTRIES.map(([name]) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Base Currency" required>
          <TextInput required value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Default VAT Rate %" required>
          <TextInput required type="number" min={0} max={100} step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
        </Field>
        <Field label="Fiscal Year Start" required>
          <TextInput required type="date" value={fiscalYearStart} onChange={(e) => setFiscalYearStart(e.target.value)} />
        </Field>
      </div>
      <p className="mb-3 mt-1 text-xs text-slate-400 dark:text-slate-500">
        Sets up a head office, a main store, a fiscal year (12 monthly periods), a starter chart of accounts, and tax
        codes at the rate above. You become this company's Administrator.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Company" />
      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        Cancel
      </button>
    </form>
  );
}

export default function CompanyPicker() {
  const { t } = useTranslation();
  const { companies, selectCompany } = useAuth();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);

  async function pick(companyId: string) {
    await selectCompany(companyId);
    navigate("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-900 bg-[radial-gradient(circle_at_top,rgba(122,180,245,0.18),transparent_55%)]">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white p-8 shadow-2xl dark:bg-slate-800">
        {showNew ? (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Company</h1>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Set up a new company with its own country and currency.</p>
            <NewCompanyForm onClose={() => setShowNew(false)} />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{t("companyPicker.title")}</h1>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">{t("companyPicker.subtitle")}</p>

            {companies.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t("companyPicker.none")}</p>}

            <div className="space-y-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c.id)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-start text-sm transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-slate-600 dark:hover:bg-brand-500/10"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-600 dark:bg-slate-700 dark:text-slate-400">
                    <Building2 size={17} />
                  </span>
                  <span className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{c.name_en}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {c.company_code} · {c.base_currency}
                    </div>
                  </span>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-brand-500 dark:text-slate-600" />
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowNew(true)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400"
            >
              <Plus size={16} /> New Company
            </button>
          </>
        )}
      </div>
    </div>
  );
}
