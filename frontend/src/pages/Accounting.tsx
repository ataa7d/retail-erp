import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ScrollText, Wallet, Banknote, Clock, Plus, Trash2, Link2, CheckCircle2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface Account {
  id: string;
  account_code: string;
  name_en: string;
  name_ar: string;
  account_type: string;
  is_header: boolean;
}

interface FiscalPeriod {
  id: string;
  period_number: number;
  year_name: string;
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
}

interface AgeingRow {
  document_number: string;
  invoice_date: string;
  due_date: string;
  open_amount: string;
  days_overdue: number;
  ageing_bucket: string;
  customer_name_en?: string;
  supplier_name_en?: string;
}

interface FullBankAccount {
  id: string;
  bank_name: string;
  account_name: string;
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

function ChartOfAccountsTab() {
  const { data, error } = useApiList<Account>("/api/chart-of-accounts");
  const columns: Column<Account>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => <span className={r.is_header ? "font-semibold text-slate-900" : "ps-4 text-slate-700"}>{r.name_en}</span> },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
  ];
  return (
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
    />
  );
}

// ---- Journals ----

interface JournalLineDraft {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
}

function NewJournalForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
  const { data, error, reload } = useApiList<Journal>("/api/journals");
  const [showNew, setShowNew] = useState(false);

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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Manual Journal Entry" onClose={() => setShowNew(false)}>
          <NewJournalForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

// ---- Customer Receipts ----

function NewReceiptForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: bankAccounts } = useApiList<BankAccount>("/api/bank-accounts");
  const openPeriods = useOpenPeriods();

  const [customerId, setCustomerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/customer-receipts", {
        method: "POST",
        token,
        companyId,
        body: { customerId, bankAccountId: bankAccountId || null, receiptDate, fiscalPeriodId, paymentMethod, amount },
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
        <SelectInput required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
      <p className="mb-3 text-xs text-slate-400">Posted as unapplied cash — allocating to a specific invoice isn't in this form yet.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Receipt" />
    </form>
  );
}

function CustomerReceiptsTab() {
  const { data, error, reload } = useApiList<Receipt>("/api/customer-receipts");
  const [showNew, setShowNew] = useState(false);

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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Customer Receipt" onClose={() => setShowNew(false)}>
          <NewReceiptForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

// ---- Supplier Payments ----

function NewPaymentForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: suppliers } = useApiList<Supplier>("/api/suppliers");
  const { data: bankAccounts } = useApiList<BankAccount>("/api/bank-accounts");
  const openPeriods = useOpenPeriods();

  const [supplierId, setSupplierId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/supplier-payments", {
        method: "POST",
        token,
        companyId,
        body: { supplierId, bankAccountId: bankAccountId || null, paymentDate, fiscalPeriodId, paymentMethod, amount },
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
        <SelectInput required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select...</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en}
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
      <Field label="Amount" required>
        <TextInput type="number" min={0.01} step="0.01" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </Field>
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
      <p className="mb-3 text-xs text-slate-400">Posted as unapplied cash — allocating to a specific invoice isn't in this form yet.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Payment" />
    </form>
  );
}

function SupplierPaymentsTab() {
  const { data, error, reload } = useApiList<Payment>("/api/supplier-payments");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<Payment>[] = [
    { key: "number", header: "Payment #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.payment_date).toLocaleDateString() },
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
        getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
        emptyIcon={Banknote}
        emptyText="No supplier payments yet."
        searchPlaceholder="Search payments..."
        actionLabel="New Payment"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Supplier Payment" onClose={() => setShowNew(false)}>
          <NewPaymentForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
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
      getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
      emptyIcon={Clock}
      emptyText="Nothing outstanding."
      searchPlaceholder="Search..."
    />
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

function BankReconciliationTab() {
  const { data: bankAccounts } = useApiList<FullBankAccount>("/api/bank-accounts");
  const [bankAccountId, setBankAccountId] = useState("");
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
    return <p className="text-sm text-slate-400">No bank accounts set up yet.</p>;
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
    </div>
  );
}

export default function Accounting() {
  const { t } = useTranslation();
  const tabs = useMemo(
    () => [
      { key: "coa", label: "Chart of Accounts", content: <ChartOfAccountsTab /> },
      { key: "journals", label: "Journals", content: <JournalsTab /> },
      { key: "receipts", label: "Customer Receipts", content: <CustomerReceiptsTab /> },
      { key: "payments", label: "Supplier Payments", content: <SupplierPaymentsTab /> },
      { key: "bank", label: "Bank Reconciliation", content: <BankReconciliationTab /> },
      { key: "ar", label: "AR Ageing", content: <ArAgeingTab /> },
      { key: "ap", label: "AP Ageing", content: <ApAgeingTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.accounting")}</h1>
      <Tabs tabs={tabs} />
    </div>
  );
}
