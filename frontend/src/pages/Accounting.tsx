import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, ScrollText, Wallet, Banknote, Clock, Plus, Trash2, Link2, CheckCircle2, Lock, Unlock, CalendarCheck, Coins, Percent } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import ExchangeRateField from "../components/ExchangeRateField";
import { useBaseCurrency, formatMoney } from "../lib/currency";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface Account {
  id: string;
  parent_id: string | null;
  account_code: string;
  name_en: string;
  name_ar: string;
  account_type: string;
  normal_balance: string;
  is_header: boolean;
  is_active: boolean;
}

interface FiscalPeriod {
  id: string;
  fiscal_year_id: string;
  period_number: number;
  start_date: string;
  end_date: string;
  year_name: string;
  status: string;
}

interface FiscalYear {
  id: string;
  year_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface BankAccount {
  id: string;
  bank_name: string;
  account_name: string;
}

interface Customer {
  id: string;
  name_en: string;
}

interface Supplier {
  id: string;
  name_en: string;
  currency: string;
}

interface Journal {
  id: string;
  journal_number: string;
  journal_date: string;
  source_type: string;
  document_status: string;
}

interface Receipt {
  id: string;
  document_number: string;
  receipt_date: string;
  payment_method: string;
  amount: string;
  document_status: string;
  customer_name_en: string;
}

interface Payment {
  id: string;
  document_number: string;
  payment_date: string;
  payment_method: string;
  amount: string;
  document_status: string;
  supplier_name_en: string;
  currency: string;
  exchange_rate: string;
  base_amount: string | null;
}

interface ExchangeRate {
  id: string;
  currency: string;
  rate_date: string;
  rate: string;
}

interface AgeingRow {
  sales_invoice_id?: string;
  supplier_invoice_id?: string;
  customer_id?: string;
  supplier_id?: string;
  document_number: string;
  invoice_date: string;
  due_date: string;
  open_amount: string;
  days_overdue: number;
  ageing_bucket: string;
  customer_name_en?: string;
  supplier_name_en?: string;
  currency?: string;
}

interface FullBankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  account_number: string | null;
  iban: string | null;
  currency: string;
  gl_account_id: string;
  is_active: boolean;
}

interface StatementLine {
  id: string;
  statement_date: string;
  description: string | null;
  amount: string;
  reference: string | null;
  matched_journal_line_id: string | null;
  matched_journal_number: string | null;
  bank_reconciliation_id: string | null;
}

interface UnmatchedJournalLine {
  id: string;
  debit_amount: string;
  credit_amount: string;
  description: string | null;
  journal_number: string;
  journal_date: string;
}

interface Reconciliation {
  id: string;
  statement_date: string;
  statement_ending_balance: string;
  document_status: string;
  line_count: string;
}

function useOpenPeriods() {
  const { data } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  return data?.filter((p) => p.status === "open") ?? [];
}

// ---- Chart of Accounts ----

function NewAccountForm({ accounts, onClose, onCreated }: { accounts: Account[]; onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [accountCode, setAccountCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [accountType, setAccountType] = useState<"asset" | "liability" | "equity" | "revenue" | "expense">("expense");
  const [normalBalance, setNormalBalance] = useState<"debit" | "credit">("debit");
  const [parentId, setParentId] = useState("");
  const [isHeader, setIsHeader] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const headerAccounts = accounts.filter((a) => a.is_header);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/chart-of-accounts", {
        method: "POST",
        token,
        companyId,
        body: { accountCode, nameEn, nameAr, accountType, normalBalance, parentId: parentId || null, isHeader },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Account Code" required>
        <TextInput required value={accountCode} onChange={(e) => setAccountCode(e.target.value)} placeholder="e.g. 1160" />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Type" required>
          <SelectInput required value={accountType} onChange={(e) => setAccountType(e.target.value as typeof accountType)}>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </SelectInput>
        </Field>
        <Field label="Normal Balance" required>
          <SelectInput required value={normalBalance} onChange={(e) => setNormalBalance(e.target.value as typeof normalBalance)}>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </SelectInput>
        </Field>
      </div>
      <Field label="Parent (Group) Account">
        <SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">None — top level</option>
          {headerAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_code} — {a.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isHeader} onChange={(e) => setIsHeader(e.target.checked)} />
        This is a header/group account (organizes other accounts, never posted to directly)
      </label>
      <p className="mb-3 text-xs text-slate-400">
        Type, normal balance, and code can't be changed after creation — every journal line and report groups by them.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Account" />
    </form>
  );
}

function EditAccountForm({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const { token, companyId } = useAuth();
  const [nameEn, setNameEn] = useState(account.name_en);
  const [nameAr, setNameAr] = useState(account.name_ar);
  const [isActive, setIsActive] = useState(account.is_active);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/chart-of-accounts/${account.id}`, {
        method: "POST",
        token,
        companyId,
        body: { nameEn, nameAr, isActive },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
        <span className="font-mono text-xs">{account.account_code}</span>
        <span className="capitalize">
          {account.account_type} · {account.normal_balance}
        </span>
      </div>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <p className="mb-3 text-xs text-slate-400">
        Retire an account no longer used by unchecking Active instead of deleting it — its history stays intact.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Save Account" />
    </form>
  );
}

function ChartOfAccountsTab() {
  const { data, error, reload } = useApiList<Account>("/api/chart-of-accounts");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const columns: Column<Account>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.account_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <span className={`${r.is_header ? "font-semibold text-slate-900" : "ps-4 text-slate-700"} ${r.is_active ? "" : "text-slate-400"}`}>
          {r.name_en}
          {!r.is_active && " (inactive)"}
        </span>
      ),
    },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
  ];
  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.account_code} ${r.name_en}`}
        emptyIcon={BookOpen}
        emptyText="No accounts found."
        searchPlaceholder="Search accounts..."
        actionLabel="New Account"
        onAction={() => setShowNew(true)}
        onRowClick={setEditing}
      />
      {showNew && (
        <Modal title="New Account" onClose={() => setShowNew(false)}>
          <NewAccountForm accounts={data ?? []} onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.account_code}`} onClose={() => setEditing(null)}>
          <EditAccountForm account={editing} onClose={() => setEditing(null)} onSaved={reload} />
        </Modal>
      )}
    </>
  );
}

// ---- Tax Codes ----

interface TaxCode {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  rate: string;
  tax_type: string;
  is_active: boolean;
}

function NewTaxCodeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [rate, setRate] = useState("15");
  const [taxType, setTaxType] = useState<"standard" | "zero_rated" | "exempt">("standard");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/tax-codes", {
        method: "POST",
        token,
        companyId,
        body: { code, nameEn, nameAr, rate: Number(rate), taxType },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tax code");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Code" required>
        <TextInput required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VAT15" />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <Field label="Type" required>
        <SelectInput
          value={taxType}
          onChange={(e) => {
            const next = e.target.value as typeof taxType;
            setTaxType(next);
            if (next !== "standard") setRate("0");
          }}
        >
          <option value="standard">Standard</option>
          <option value="zero_rated">Zero-rated (export)</option>
          <option value="exempt">Exempt</option>
        </SelectInput>
      </Field>
      <Field label="Rate (%)" required>
        <TextInput type="number" min={0} max={100} step="0.01" required value={rate} disabled={taxType !== "standard"} onChange={(e) => setRate(e.target.value)} />
      </Field>
      {taxType !== "standard" && <p className="mb-3 text-xs text-slate-400">Zero-rated and exempt codes are always 0%.</p>}
      <FormActions error={error} submitting={submitting} submitLabel="Create Tax Code" />
    </form>
  );
}

function TaxCodesTab() {
  const { token, companyId } = useAuth();
  const { data, error, reload } = useApiList<TaxCode>("/api/tax-codes");
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(taxCode: TaxCode) {
    setBusyId(taxCode.id);
    try {
      await apiRequest(`/api/tax-codes/${taxCode.id}/${taxCode.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<TaxCode>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name_en}</span> },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.tax_type.replace("_", " ")}</span> },
    { key: "rate", header: "Rate", render: (r) => `${Number(r.rate).toFixed(2)}%`, numeric: true },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={r.is_active ? "active" : "inactive"} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(r);
            }}
            disabled={busyId === r.id}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
          >
            {r.is_active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.code} ${r.name_en}`}
        emptyIcon={Percent}
        emptyText="No tax codes yet."
        searchPlaceholder="Search tax codes..."
        actionLabel="New Tax Code"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Tax Code" onClose={() => setShowNew(false)}>
          <NewTaxCodeForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

// ---- Journals ----

interface JournalLineDraft {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
}

export function NewJournalForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: accounts } = useApiList<Account>("/api/chart-of-accounts");
  const postableAccounts = accounts?.filter((a) => !a.is_header) ?? [];
  const openPeriods = useOpenPeriods();

  const [journalDate, setJournalDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<JournalLineDraft[]>([
    { accountId: "", debitAmount: "", creditAmount: "", description: "" },
    { accountId: "", debitAmount: "", creditAmount: "", description: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debitAmount) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.creditAmount) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  function updateLine(index: number, patch: Partial<JournalLineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { accountId: "", debitAmount: "", creditAmount: "", description: "" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!balanced) {
      setError("Debits and credits must balance before posting.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/journals", {
        method: "POST",
        token,
        companyId,
        body: {
          journalDate,
          fiscalPeriodId,
          memo: memo || undefined,
          lines: lines
            .filter((l) => l.accountId)
            .map((l) => ({
              accountId: l.accountId,
              debitAmount: Number(l.debitAmount) || 0,
              creditAmount: Number(l.creditAmount) || 0,
              description: l.description || undefined,
            })),
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post journal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Journal Date" required>
          <TextInput type="date" required value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
        </Field>
        <Field label="Fiscal Period" required>
          <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
            <option value="">Select...</option>
            {openPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.year_name} — P{p.period_number}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Memo">
        <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-slate-200 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SelectInput value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })} className="min-w-0 flex-1">
                <option value="">Account...</option>
                {postableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.name_en}
                  </option>
                ))}
              </SelectInput>
              <button type="button" onClick={() => removeLine(i)} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex gap-1.5">
              <TextInput
                type="number"
                min={0}
                step="0.01"
                placeholder="Debit"
                value={line.debitAmount}
                onChange={(e) => updateLine(i, { debitAmount: e.target.value, creditAmount: e.target.value ? "" : line.creditAmount })}
                className="min-w-0 flex-1"
              />
              <TextInput
                type="number"
                min={0}
                step="0.01"
                placeholder="Credit"
                value={line.creditAmount}
                onChange={(e) => updateLine(i, { creditAmount: e.target.value, debitAmount: e.target.value ? "" : line.debitAmount })}
                className="min-w-0 flex-1"
              />
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <Plus size={14} /> Add line
      </button>

      <div className={`mt-3 flex justify-between rounded-md px-3 py-2 text-sm font-medium ${balanced ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
        <span>Debit: {totalDebit.toFixed(2)}</span>
        <span>Credit: {totalCredit.toFixed(2)}</span>
        <span>{balanced ? "Balanced ✓" : "Not balanced"}</span>
      </div>

      <FormActions error={error} submitting={submitting} submitLabel="Post Journal" />
    </form>
  );
}

function JournalsTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<Journal>("/api/journals");

  const columns: Column<Journal>[] = [
    { key: "number", header: "Journal #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.journal_number}</span> },
    { key: "date", header: "Date", render: (r) => new Date(r.journal_date).toLocaleDateString() },
    { key: "source", header: "Source", render: (r) => <span className="capitalize">{r.source_type.replace(/_/g, " ")}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => r.journal_number}
        emptyIcon={ScrollText}
        emptyText="No journals yet."
        searchPlaceholder="Search journals..."
        actionLabel="New Journal Entry"
        onAction={() => navigate("/accounting/journals/new", { state: { fromTab: "journals" } })}
      />
    </>
  );
}

// ---- Invoice allocation picker (shared by customer receipts and supplier payments) ----

function InvoiceAllocationPicker({
  invoices,
  amount,
  allocations,
  onChange,
  invoiceIdKey,
}: {
  invoices: AgeingRow[];
  amount: number;
  allocations: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  invoiceIdKey: "sales_invoice_id" | "supplier_invoice_id";
}) {
  const totalAllocated = Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0);
  const remaining = round2(amount - totalAllocated);

  function setLine(invoiceId: string, value: number) {
    const next = { ...allocations };
    if (value > 0) next[invoiceId] = value;
    else delete next[invoiceId];
    onChange(next);
  }

  function autoAllocateOldestFirst() {
    let left = amount;
    const next: Record<string, number> = {};
    for (const inv of invoices) {
      const invoiceId = inv[invoiceIdKey];
      if (!invoiceId || left <= 0) continue;
      const open = Number(inv.open_amount);
      const apply = round2(Math.min(open, left));
      if (apply > 0) {
        next[invoiceId] = apply;
        left = round2(left - apply);
      }
    }
    onChange(next);
  }

  if (invoices.length === 0) {
    return <p className="mb-3 text-xs text-slate-400">No open invoices for this customer/supplier — will post as unapplied cash.</p>;
  }

  return (
    <div className="mb-3 rounded border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-medium text-slate-600">Apply to open invoices (optional)</span>
        <button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={autoAllocateOldestFirst}>
          Auto-apply oldest first
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {invoices.map((inv) => {
          const invoiceId = inv[invoiceIdKey];
          if (!invoiceId) return null;
          const open = Number(inv.open_amount);
          const value = allocations[invoiceId] ?? 0;
          return (
            <div key={invoiceId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-slate-700">{inv.document_number}</div>
                <div className="text-[11px] text-slate-400">
                  Due {new Date(inv.due_date).toLocaleDateString()} · Open {open.toFixed(2)}
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={open}
                step="0.01"
                value={value || ""}
                placeholder="0.00"
                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-xs"
                onChange={(e) => setLine(invoiceId, Math.min(open, Number(e.target.value) || 0))}
              />
              <button
                type="button"
                className="text-[11px] font-medium text-blue-600 hover:underline"
                onClick={() => setLine(invoiceId, round2(Math.min(open, remaining + value)))}
              >
                Full
              </button>
            </div>
          );
        })}
      </div>
      <div className={`flex justify-between border-t border-slate-200 px-3 py-1.5 text-xs ${remaining < 0 ? "text-red-600" : "text-slate-500"}`}>
        <span>Applied: {totalAllocated.toFixed(2)}</span>
        <span>Unapplied: {remaining.toFixed(2)}</span>
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Customer Receipts ----

export function NewReceiptForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: bankAccounts } = useApiList<BankAccount>("/api/bank-accounts");
  const { data: arAgeing } = useApiList<AgeingRow>("/api/ar-ageing");
  const openPeriods = useOpenPeriods();

  const [customerId, setCustomerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openInvoices = useMemo(() => (arAgeing ?? []).filter((r) => r.customer_id === customerId), [arAgeing, customerId]);

  function selectCustomer(id: string) {
    setCustomerId(id);
    setAllocations({});
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const allocationList = Object.entries(allocations)
        .filter(([, v]) => v > 0)
        .map(([salesInvoiceId, allocatedAmount]) => ({ salesInvoiceId, allocatedAmount }));
      await apiRequest("/api/customer-receipts", {
        method: "POST",
        token,
        companyId,
        body: {
          customerId,
          bankAccountId: bankAccountId || null,
          receiptDate,
          fiscalPeriodId,
          paymentMethod,
          amount,
          allocations: allocationList.length > 0 ? allocationList : undefined,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post receipt");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Customer" required>
        <SelectInput required value={customerId} onChange={(e) => selectCustomer(e.target.value)}>
          <option value="">Select...</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Payment Method" required>
        <SelectInput value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
        </SelectInput>
      </Field>
      {paymentMethod !== "cash" && (
        <Field label="Bank Account">
          <SelectInput value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bank_name} — {b.account_name}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <Field label="Amount" required>
        <TextInput type="number" min={0.01} step="0.01" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </Field>
      {customerId && (
        <InvoiceAllocationPicker
          invoices={openInvoices}
          amount={amount}
          allocations={allocations}
          onChange={setAllocations}
          invoiceIdKey="sales_invoice_id"
        />
      )}
      <Field label="Receipt Date" required>
        <TextInput type="date" required value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
      </Field>
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — P{p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Post Receipt" />
    </form>
  );
}

function CustomerReceiptsTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<Receipt>("/api/customer-receipts");

  const columns: Column<Receipt>[] = [
    { key: "number", header: "Receipt #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.receipt_date).toLocaleDateString() },
    { key: "amount", header: "Amount", render: (r) => Number(r.amount).toFixed(2), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.document_number} ${r.customer_name_en}`}
        emptyIcon={Wallet}
        emptyText="No customer receipts yet."
        searchPlaceholder="Search receipts..."
        actionLabel="New Receipt"
        onAction={() => navigate("/accounting/receipts/new", { state: { fromTab: "receipts" } })}
      />
    </>
  );
}

// ---- Supplier Payments ----

export function NewPaymentForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { data: suppliers } = useApiList<Supplier>("/api/suppliers");
  const { data: bankAccounts } = useApiList<BankAccount>("/api/bank-accounts");
  const { data: apAgeing } = useApiList<AgeingRow>("/api/ap-ageing");
  const openPeriods = useOpenPeriods();

  const [supplierId, setSupplierId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState(baseCurrency);
  const [exchangeRate, setExchangeRate] = useState("1");
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openInvoices = useMemo(() => (apAgeing ?? []).filter((r) => r.supplier_id === supplierId), [apAgeing, supplierId]);

  function selectSupplier(id: string) {
    setSupplierId(id);
    const supplier = suppliers?.find((s) => s.id === id);
    if (supplier) setCurrency(supplier.currency);
    setAllocations({});
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const allocationList = Object.entries(allocations)
        .filter(([, v]) => v > 0)
        .map(([supplierInvoiceId, allocatedAmount]) => ({ supplierInvoiceId, allocatedAmount }));
      await apiRequest("/api/supplier-payments", {
        method: "POST",
        token,
        companyId,
        body: {
          supplierId,
          bankAccountId: bankAccountId || null,
          paymentDate,
          fiscalPeriodId,
          paymentMethod,
          amount,
          currency,
          exchangeRate: currency === baseCurrency ? null : Number(exchangeRate),
          allocations: allocationList.length > 0 ? allocationList : undefined,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Supplier" required>
        <SelectInput required value={supplierId} onChange={(e) => selectSupplier(e.target.value)}>
          <option value="">Select...</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en} ({s.currency})
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Payment Method" required>
        <SelectInput value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="card">Bank Transfer</option>
        </SelectInput>
      </Field>
      {paymentMethod !== "cash" && (
        <Field label="Bank Account">
          <SelectInput value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bank_name} — {b.account_name}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" required>
          <TextInput type="number" min={0.01} step="0.01" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Currency" required>
          <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </Field>
      </div>
      <ExchangeRateField currency={currency} date={paymentDate} value={exchangeRate} onChange={setExchangeRate} label={`Exchange Rate (${baseCurrency} per 1 ${currency}, today's bank rate)`} />
      {supplierId && (
        <InvoiceAllocationPicker
          invoices={openInvoices}
          amount={amount}
          allocations={allocations}
          onChange={setAllocations}
          invoiceIdKey="supplier_invoice_id"
        />
      )}
      <Field label="Payment Date" required>
        <TextInput type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </Field>
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — P{p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Post Payment" />
    </form>
  );
}

function SupplierPaymentsTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<Payment>("/api/supplier-payments");
  const baseCurrency = useBaseCurrency();

  const columns: Column<Payment>[] = [
    { key: "number", header: "Payment #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.payment_date).toLocaleDateString() },
    { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount, r.currency !== baseCurrency ? r.currency : undefined), numeric: true },
    {
      key: "base",
      header: `${baseCurrency} Equiv.`,
      render: (r) => (r.currency !== baseCurrency && r.base_amount ? formatMoney(r.base_amount) : "—"),
      numeric: true,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
        emptyIcon={Banknote}
        emptyText="No supplier payments yet."
        searchPlaceholder="Search payments..."
        actionLabel="New Payment"
        onAction={() => navigate("/accounting/payments/new", { state: { fromTab: "payments" } })}
      />
    </>
  );
}

// ---- Ageing ----

function ArAgeingTab() {
  const { data, error } = useApiList<AgeingRow>("/api/ar-ageing");
  const columns: Column<AgeingRow>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en },
    { key: "due", header: "Due Date", render: (r) => new Date(r.due_date).toLocaleDateString() },
    { key: "open", header: "Open Amount", render: (r) => Number(r.open_amount).toFixed(2), numeric: true },
    { key: "bucket", header: "Bucket", render: (r) => <StatusBadge status={r.ageing_bucket === "current" ? "active" : "draft"} /> },
  ];
  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.document_number}
      getSearchText={(r) => `${r.document_number} ${r.customer_name_en}`}
      emptyIcon={Clock}
      emptyText="Nothing outstanding."
      searchPlaceholder="Search..."
    />
  );
}

function ApAgeingTab() {
  const { data, error } = useApiList<AgeingRow>("/api/ap-ageing");
  const columns: Column<AgeingRow>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "due", header: "Due Date", render: (r) => new Date(r.due_date).toLocaleDateString() },
    { key: "open", header: "Open Amount", render: (r) => formatMoney(r.open_amount, r.currency), numeric: true },
    { key: "bucket", header: "Bucket", render: (r) => <StatusBadge status={r.ageing_bucket === "current" ? "active" : "draft"} /> },
  ];
  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.document_number}
      getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
      emptyIcon={Clock}
      emptyText="Nothing outstanding."
      searchPlaceholder="Search..."
    />
  );
}

// ---- Exchange Rates ----

function NewExchangeRateForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [currency, setCurrency] = useState("");
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/exchange-rates", {
        method: "POST",
        token,
        companyId,
        body: { currency: currency.toUpperCase(), rateDate, rate: Number(rate) },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save rate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Currency" required>
        <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
      </Field>
      <Field label="Date" required>
        <TextInput type="date" required value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
      </Field>
      <Field label="Rate" required>
        <TextInput type="number" min="0.00000001" step="any" required value={rate} onChange={(e) => setRate(e.target.value)} placeholder="3.75" />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        How many units of the base currency one unit of this currency buys on this date. Re-entering the same currency and date corrects that day's rate.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Save Rate" />
    </form>
  );
}

function ExchangeRatesTab() {
  const { data, error, reload } = useApiList<ExchangeRate>("/api/exchange-rates");
  const baseCurrency = useBaseCurrency();
  const [showNew, setShowNew] = useState(false);

  const columns: Column<ExchangeRate>[] = [
    { key: "currency", header: "Currency", render: (r) => <span className="font-medium text-slate-900">{r.currency}</span> },
    { key: "date", header: "Date", render: (r) => new Date(r.rate_date).toLocaleDateString() },
    { key: "rate", header: `Rate (${baseCurrency} per 1 unit)`, render: (r) => Number(r.rate).toFixed(4), numeric: true },
  ];

  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-slate-500">
        Documents in a foreign currency snapshot the latest rate on or before their own date when posted, so correcting or adding a rate
        here never changes anything already posted. A document can also override this with its own rate (e.g. the bank's actual contract rate).
      </p>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => r.currency}
        emptyIcon={Coins}
        emptyText="No exchange rates entered yet."
        searchPlaceholder="Search currency..."
        actionLabel="New Rate"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Exchange Rate" onClose={() => setShowNew(false)}>
          <NewExchangeRateForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

// ---- Bank Reconciliation ----

function NewStatementLineForm({ bankAccountId, onClose, onCreated }: { bankAccountId: string; onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/bank-statement-lines", {
        method: "POST",
        token,
        companyId,
        body: { bankAccountId, statementDate, description: description || undefined, amount: Number(amount), reference: reference || undefined },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add statement line");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Statement Date" required>
        <TextInput type="date" required value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
      </Field>
      <Field label="Description">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Amount" required>
        <TextInput type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Positive = deposit, negative = withdrawal" />
      </Field>
      <Field label="Reference">
        <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Add Line" />
    </form>
  );
}

function MatchStatementLineForm({
  bankAccountId,
  line,
  onClose,
  onMatched,
}: {
  bankAccountId: string;
  line: StatementLine;
  onClose: () => void;
  onMatched: () => void;
}) {
  const { token, companyId } = useAuth();
  const { data: candidates } = useApiList<UnmatchedJournalLine>(`/api/bank-accounts/${bankAccountId}/unmatched-journal-lines`);
  const [journalLineId, setJournalLineId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/bank-statement-lines/${line.id}/match`, { method: "POST", token, companyId, body: { journalLineId } });
      onMatched();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to match");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {line.description || "(no description)"} · {Number(line.amount).toFixed(2)} · {new Date(line.statement_date).toLocaleDateString()}
      </div>
      <Field label="Matching Journal Line" required>
        <SelectInput required value={journalLineId} onChange={(e) => setJournalLineId(e.target.value)}>
          <option value="">Select...</option>
          {candidates?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.journal_number} — {new Date(c.journal_date).toLocaleDateString()} — {c.description ?? (Number(c.debit_amount) > 0 ? "Dr" : "Cr")}{" "}
              {(Number(c.debit_amount) || Number(c.credit_amount)).toFixed(2)}
            </option>
          ))}
        </SelectInput>
      </Field>
      {candidates?.length === 0 && <p className="mb-3 text-xs text-slate-400">No unmatched posted journal lines on this bank's GL account.</p>}
      <FormActions error={error} submitting={submitting} submitLabel="Match" />
    </form>
  );
}

function NewReconciliationForm({ bankAccountId, onClose, onCreated }: { bankAccountId: string; onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: lines } = useApiList<StatementLine>(`/api/bank-statement-lines?bankAccountId=${bankAccountId}`);
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [statementEndingBalance, setStatementEndingBalance] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Eligible: matched to a journal line, not already swept into a
  // reconciliation, dated on or before the chosen statement date.
  const eligible = (lines ?? []).filter(
    (l) => l.matched_journal_line_id && !l.bank_reconciliation_id && l.statement_date <= statementDate,
  );

  useEffect(() => {
    setSelected(new Set(eligible.map((l) => l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementDate, lines]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runningTotal = eligible.filter((l) => selected.has(l.id)).reduce((s, l) => s + Number(l.amount), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one matched line to reconcile.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/bank-reconciliations", {
        method: "POST",
        token,
        companyId,
        body: { bankAccountId, statementDate, statementEndingBalance: Number(statementEndingBalance), statementLineIds: [...selected] },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post reconciliation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Statement Date" required>
          <TextInput type="date" required value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
        </Field>
        <Field label="Statement Ending Balance" required>
          <TextInput type="number" step="0.01" required value={statementEndingBalance} onChange={(e) => setStatementEndingBalance(e.target.value)} />
        </Field>
      </div>

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Matched lines up to this date ({eligible.length})</div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {eligible.length === 0 && <p className="p-2 text-xs text-slate-400">No matched, unreconciled lines on or before this date.</p>}
        {eligible.map((l) => (
          <label key={l.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
              {l.description || "(no description)"}
            </span>
            <span className="tabular-nums text-slate-500">{Number(l.amount).toFixed(2)}</span>
          </label>
        ))}
      </div>

      <div
        className={`mt-3 flex justify-between rounded-md px-3 py-2 text-sm font-medium ${
          Math.abs(runningTotal - Number(statementEndingBalance || 0)) < 0.005 && statementEndingBalance !== ""
            ? "bg-green-50 text-green-700"
            : "bg-amber-50 text-amber-700"
        }`}
      >
        <span>Running Total: {runningTotal.toFixed(2)}</span>
        <span>Declared Ending Balance: {Number(statementEndingBalance || 0).toFixed(2)}</span>
      </div>

      <p className="mb-3 mt-2 text-xs text-slate-400">
        Posting requires the running total of every reconciled line for this account, up to this date, to equal the declared ending balance exactly.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Reconciliation" />
    </form>
  );
}

function NewBankAccountForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: accounts } = useApiList<Account>("/api/chart-of-accounts");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [glAccountId, setGlAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Any non-header leaf account can be linked -- usually an asset account
  // under Cash & Bank, but this app doesn't force a specific sub-tree, so
  // the picker shows every leaf account rather than guessing which ones
  // are "bank-shaped".
  const leafAccounts = (accounts ?? []).filter((a) => !a.is_header);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/bank-accounts", {
        method: "POST",
        token,
        companyId,
        body: {
          bankName,
          accountName,
          accountNumber: accountNumber || null,
          iban: iban || null,
          currency,
          glAccountId,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create bank account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Bank Name" required>
        <TextInput required value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </Field>
      <Field label="Account Name" required>
        <TextInput required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Number">
          <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </Field>
        <Field label="IBAN">
          <TextInput value={iban} onChange={(e) => setIban(e.target.value)} />
        </Field>
      </div>
      <Field label="Currency" required>
        <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
      </Field>
      <Field label="GL Account" required>
        <SelectInput required value={glAccountId} onChange={(e) => setGlAccountId(e.target.value)}>
          <option value="">Select...</option>
          {leafAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_code} — {a.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        The GL account and currency can't be changed after creation — reconciliations tie back to this specific account.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Bank Account" />
    </form>
  );
}

function EditBankAccountForm({ account, onClose, onSaved }: { account: FullBankAccount; onClose: () => void; onSaved: () => void }) {
  const { token, companyId } = useAuth();
  const [bankName, setBankName] = useState(account.bank_name);
  const [accountName, setAccountName] = useState(account.account_name);
  const [accountNumber, setAccountNumber] = useState(account.account_number ?? "");
  const [iban, setIban] = useState(account.iban ?? "");
  const [isActive, setIsActive] = useState(account.is_active);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/bank-accounts/${account.id}`, {
        method: "POST",
        token,
        companyId,
        body: { bankName, accountName, accountNumber: accountNumber || null, iban: iban || null, isActive },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save bank account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs text-slate-500">Currency {account.currency} — GL account and currency can't be changed here.</div>
      <Field label="Bank Name" required>
        <TextInput required value={bankName} onChange={(e) => setBankName(e.target.value)} />
      </Field>
      <Field label="Account Name" required>
        <TextInput required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Number">
          <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </Field>
        <Field label="IBAN">
          <TextInput value={iban} onChange={(e) => setIban(e.target.value)} />
        </Field>
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <FormActions error={error} submitting={submitting} submitLabel="Save Bank Account" />
    </form>
  );
}

function BankAccountsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data: accounts, reload } = useApiList<FullBankAccount>("/api/bank-accounts");
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function refresh() {
    reload();
    onChanged();
  }

  return (
    <Modal title="Bank Accounts" onClose={onClose}>
      {!showNew ? (
        <button onClick={() => setShowNew(true)} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
          <Plus size={14} /> New Bank Account
        </button>
      ) : (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <NewBankAccountForm onClose={() => setShowNew(false)} onCreated={refresh} />
        </div>
      )}
      <div className="space-y-2">
        {accounts?.map((a) =>
          editingId === a.id ? (
            <EditBankAccountForm key={a.id} account={a} onClose={() => setEditingId(null)} onSaved={refresh} />
          ) : (
            <div key={a.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-slate-900">
                  {a.bank_name} — {a.account_name}
                </div>
                <div className="text-xs text-slate-400">
                  {a.currency}
                  {a.account_number ? ` · ${a.account_number}` : ""}
                  {!a.is_active ? " · inactive" : ""}
                </div>
              </div>
              <button onClick={() => setEditingId(a.id)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Edit
              </button>
            </div>
          ),
        )}
        {accounts?.length === 0 && !showNew && <p className="text-sm text-slate-400">No bank accounts yet.</p>}
      </div>
    </Modal>
  );
}

function BankReconciliationTab() {
  const { data: bankAccounts, reload: reloadBankAccounts } = useApiList<FullBankAccount>("/api/bank-accounts");
  const [bankAccountId, setBankAccountId] = useState("");
  const [showManageAccounts, setShowManageAccounts] = useState(false);
  useEffect(() => {
    if (bankAccounts && bankAccounts.length > 0 && !bankAccountId) setBankAccountId(bankAccounts[0]!.id);
  }, [bankAccounts, bankAccountId]);

  const { data: lines, reload: reloadLines } = useApiList<StatementLine>(
    bankAccountId ? `/api/bank-statement-lines?bankAccountId=${bankAccountId}` : null,
  );
  const { data: reconciliations, reload: reloadReconciliations } = useApiList<Reconciliation>(
    bankAccountId ? `/api/bank-reconciliations?bankAccountId=${bankAccountId}` : null,
  );

  const [showAddLine, setShowAddLine] = useState(false);
  const [matchingLine, setMatchingLine] = useState<StatementLine | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);

  function reloadAll() {
    reloadLines();
    reloadReconciliations();
  }

  if (!bankAccounts || bankAccounts.length === 0) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-400">No bank accounts set up yet.</p>
        <button
          onClick={() => setShowManageAccounts(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          <Plus size={15} /> New Bank Account
        </button>
        {showManageAccounts && (
          <BankAccountsModal onClose={() => setShowManageAccounts(false)} onChanged={reloadBankAccounts} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <SelectInput value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="w-64">
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bank_name} — {b.account_name}
            </option>
          ))}
        </SelectInput>
        <div className="flex gap-2">
          <button onClick={() => setShowManageAccounts(true)} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Manage Accounts
          </button>
          <button onClick={() => setShowAddLine(true)} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Plus size={15} /> Statement Line
          </button>
          <button onClick={() => setShowReconcile(true)} className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600">
            <CheckCircle2 size={15} /> New Reconciliation
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900">Statement Lines</div>
        {!lines || lines.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No statement lines yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 text-start">Date</th>
                <th className="px-4 py-2.5 text-start">Description</th>
                <th className="px-4 py-2.5 text-end">Amount</th>
                <th className="px-4 py-2.5 text-start">Match</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">{new Date(l.statement_date).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">{l.description ?? "—"}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{Number(l.amount).toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    {l.bank_reconciliation_id ? (
                      <StatusBadge status="posted" />
                    ) : l.matched_journal_line_id ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        <Link2 size={11} /> {l.matched_journal_number}
                      </span>
                    ) : (
                      <button onClick={() => setMatchingLine(l)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                        Match...
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900">Reconciliations</div>
        {!reconciliations || reconciliations.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No reconciliations yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 text-start">Statement Date</th>
                <th className="px-4 py-2.5 text-end">Ending Balance</th>
                <th className="px-4 py-2.5 text-end">Lines</th>
                <th className="px-4 py-2.5 text-start">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5">{new Date(r.statement_date).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{Number(r.statement_ending_balance).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{r.line_count}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.document_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddLine && (
        <Modal title="Add Statement Line" onClose={() => setShowAddLine(false)}>
          <NewStatementLineForm bankAccountId={bankAccountId} onClose={() => setShowAddLine(false)} onCreated={reloadLines} />
        </Modal>
      )}
      {matchingLine && (
        <Modal title="Match Statement Line" onClose={() => setMatchingLine(null)}>
          <MatchStatementLineForm bankAccountId={bankAccountId} line={matchingLine} onClose={() => setMatchingLine(null)} onMatched={reloadLines} />
        </Modal>
      )}
      {showReconcile && (
        <Modal title="New Bank Reconciliation" onClose={() => setShowReconcile(false)}>
          <NewReconciliationForm bankAccountId={bankAccountId} onClose={() => setShowReconcile(false)} onCreated={reloadAll} />
        </Modal>
      )}
      {showManageAccounts && (
        <BankAccountsModal onClose={() => setShowManageAccounts(false)} onChanged={reloadBankAccounts} />
      )}
    </div>
  );
}

// ---- Period / Fiscal Year Close ----

function ClosePeriodConfirm({
  period,
  onClose,
  onDone,
}: {
  period: FiscalPeriod;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token, companyId } = useAuth();
  const closing = period.status === "open";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/fiscal-periods/${period.id}/${closing ? "close" : "reopen"}`, { method: "POST", token, companyId });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        {closing ? (
          <>
            Close <strong>{period.year_name} — Period {period.period_number}</strong> ({new Date(period.start_date).toLocaleDateString()} –{" "}
            {new Date(period.end_date).toLocaleDateString()})? No further journals can post into it until reopened. Periods must close in
            order — earlier open periods will block this.
          </>
        ) : (
          <>
            Reopen <strong>{period.year_name} — Period {period.period_number}</strong>? This allows posting into it again.
          </>
        )}
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={handleConfirm}
        disabled={submitting}
        className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Working..." : closing ? "Close Period" : "Reopen Period"}
      </button>
    </div>
  );
}

function CloseFiscalYearConfirm({ year, onClose, onDone }: { year: FiscalYear; onClose: () => void; onDone: () => void }) {
  const { token, companyId } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/fiscal-years/${year.id}/close`, { method: "POST", token, companyId });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close fiscal year");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        Close fiscal year <strong>{year.year_name}</strong>? This generates closing entries zeroing every revenue/expense account into
        Retained Earnings, posts them into the year's last period, then closes that period and the year itself. All earlier periods must
        already be closed.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={handleConfirm}
        disabled={submitting}
        className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Closing..." : "Close Fiscal Year"}
      </button>
    </div>
  );
}

function PeriodCloseTab() {
  const { data: years, reload: reloadYears } = useApiList<FiscalYear>("/api/fiscal-years");
  const { data: periods, reload: reloadPeriods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const [periodAction, setPeriodAction] = useState<FiscalPeriod | null>(null);
  const [yearAction, setYearAction] = useState<FiscalYear | null>(null);

  function reloadAll() {
    reloadYears();
    reloadPeriods();
  }

  if (!years || !periods) return <p className="text-sm text-slate-400">Loading...</p>;

  return (
    <div className="space-y-6">
      {years.map((year) => {
        const yearPeriods = periods.filter((p) => p.fiscal_year_id === year.id).sort((a, b) => a.period_number - b.period_number);
        return (
          <div key={year.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{year.year_name}</span>
                <StatusBadge status={year.status} />
              </div>
              {year.status === "open" && (
                <button
                  onClick={() => setYearAction(year)}
                  className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
                >
                  <CalendarCheck size={13} /> Close Fiscal Year
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-start">Period</th>
                  <th className="px-4 py-2 text-start">Dates</th>
                  <th className="px-4 py-2 text-start">Status</th>
                  <th className="px-4 py-2 text-start">Action</th>
                </tr>
              </thead>
              <tbody>
                {yearPeriods.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2">P{p.period_number}</td>
                    <td className="px-4 py-2 text-slate-500">
                      {new Date(p.start_date).toLocaleDateString()} – {new Date(p.end_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setPeriodAction(p)}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        {p.status === "open" ? (
                          <>
                            <Lock size={12} /> Close
                          </>
                        ) : (
                          <>
                            <Unlock size={12} /> Reopen
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {periodAction && (
        <Modal title={periodAction.status === "open" ? "Close Period" : "Reopen Period"} onClose={() => setPeriodAction(null)}>
          <ClosePeriodConfirm period={periodAction} onClose={() => setPeriodAction(null)} onDone={reloadAll} />
        </Modal>
      )}
      {yearAction && (
        <Modal title="Close Fiscal Year" onClose={() => setYearAction(null)}>
          <CloseFiscalYearConfirm year={yearAction} onClose={() => setYearAction(null)} onDone={reloadAll} />
        </Modal>
      )}
    </div>
  );
}

interface Budget {
  id: string;
  name: string;
  status: string;
  year_name: string;
  created_at: string;
  created_by_email: string | null;
  line_count: string;
}

interface BudgetLine {
  id: string;
  fiscal_period_id: string;
  account_id: string;
  amount: string;
  period_number: number;
  account_code: string;
  account_name_en: string;
}

interface BudgetDetail extends Budget {
  fiscal_year_id: string;
  lines: BudgetLine[];
}

function NewBudgetForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: fiscalYears } = useApiList<FiscalYear>("/api/fiscal-years");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/budgets", { method: "POST", token, companyId, body: { fiscalYearId, name } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create budget");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Fiscal Year" required>
        <SelectInput required value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
          <option value="">Select...</option>
          {fiscalYears?.map((fy) => (
            <option key={fy.id} value={fy.id}>
              {fy.year_name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Budget Name" required>
        <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FY2026 Original Budget" />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        Multiple named budgets can exist per fiscal year (an original plan, a mid-year revision) -- only an approved one counts toward
        the Budget vs Actual report.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Budget" />
    </form>
  );
}

export function BudgetDetailModal({ budgetId, onChanged }: { budgetId: string; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const { data: accounts } = useApiList<Account>("/api/chart-of-accounts");
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const budgetableAccounts = accounts?.filter((a) => !a.is_header && (a.account_type === "revenue" || a.account_type === "expense")) ?? [];
  const yearPeriods = periods?.filter((p) => p.fiscal_year_id === detail?.fiscal_year_id) ?? [];

  async function reload() {
    const d = await apiRequest<BudgetDetail>(`/api/budgets/${budgetId}`, { token, companyId });
    setDetail(d);
  }

  useEffect(() => {
    if (!token || !companyId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetId, token, companyId]);

  async function setLine(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/budgets/${budgetId}/lines`, {
        method: "POST",
        token,
        companyId,
        body: { fiscalPeriodId, accountId, amount: Number(amount) },
      });
      setFiscalPeriodId("");
      setAccountId("");
      setAmount("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save budget line");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus() {
    if (!detail) return;
    setBusy(true);
    try {
      await apiRequest(`/api/budgets/${budgetId}/status`, {
        method: "POST",
        token,
        companyId,
        body: { status: detail.status === "approved" ? "draft" : "approved" },
      });
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400">Loading...</p>;
  const isApproved = detail.status === "approved";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900">{detail.name}</div>
          <div className="text-xs text-slate-500">{detail.year_name}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          <button
            onClick={toggleStatus}
            disabled={busy}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isApproved ? "Reopen to Draft" : "Approve"}
          </button>
        </div>
      </div>

      <div className="mb-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {detail.lines.length === 0 && <p className="text-xs text-slate-400">No budget lines yet.</p>}
        {detail.lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              P{l.period_number} — {l.account_name_en} <span className="font-mono text-xs text-slate-400">({l.account_code})</span>
            </span>
            <span className="font-medium tabular-nums text-slate-900">{Number(l.amount).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {isApproved ? (
        <p className="text-xs text-slate-400">This budget is approved. Reopen it to draft to change amounts.</p>
      ) : (
        <form onSubmit={setLine} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period">
              <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
                <option value="">Select...</option>
                {yearPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    P{p.period_number} ({new Date(p.start_date).toLocaleDateString()})
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Account">
              <SelectInput required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select...</option>
                {budgetableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.name_en}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <Field label="Amount">
            <TextInput required type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Set Line"}
          </button>
        </form>
      )}
    </div>
  );
}

function BudgetsTab() {
  const navigate = useNavigate();
  const { data, error, reload } = useApiList<Budget>("/api/budgets");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<Budget>[] = [
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: "year", header: "Fiscal Year", render: (r) => r.year_name },
    { key: "lines", header: "Lines", render: (r) => r.line_count, numeric: true },
    { key: "created", header: "Created", render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.name} ${r.year_name}`}
        emptyIcon={Coins}
        emptyText="No budgets yet."
        searchPlaceholder="Search budgets..."
        actionLabel="New Budget"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => navigate(`/accounting/budgets/${r.id}`, { state: { fromTab: "budgets" } })}
      />
      {showNew && (
        <Modal title="New Budget" onClose={() => setShowNew(false)}>
          <NewBudgetForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

export default function Accounting() {
  const { t } = useTranslation();
  const location = useLocation();
  const tabs = useMemo(
    () => [
      { key: "coa", label: "Chart of Accounts", content: <ChartOfAccountsTab /> },
      { key: "tax-codes", label: "Tax Codes", content: <TaxCodesTab /> },
      { key: "journals", label: "Journals", content: <JournalsTab /> },
      { key: "receipts", label: "Customer Receipts", content: <CustomerReceiptsTab /> },
      { key: "payments", label: "Supplier Payments", content: <SupplierPaymentsTab /> },
      { key: "bank", label: "Bank Reconciliation", content: <BankReconciliationTab /> },
      { key: "ar", label: "AR Ageing", content: <ArAgeingTab /> },
      { key: "ap", label: "AP Ageing", content: <ApAgeingTab /> },
      { key: "fx", label: "Exchange Rates", content: <ExchangeRatesTab /> },
      { key: "close", label: "Period Close", content: <PeriodCloseTab /> },
      { key: "budgets", label: "Budgets", content: <BudgetsTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.accounting")}</h1>
      <Tabs tabs={tabs} initialActive={(location.state as { fromTab?: string } | null)?.fromTab} />
    </div>
  );
}
