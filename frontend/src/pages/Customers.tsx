import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface PriceList {
  id: string;
  code: string;
  name_en: string;
}

interface Customer {
  id: string;
  customer_code: string;
  name_en: string;
  name_ar: string;
  customer_type: string;
  cr_number: string | null;
  vat_registration_number: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  credit_limit: string | null;
  payment_terms_days: number;
  default_price_list_id: string | null;
  is_loyalty_member: boolean;
  loyalty_card_number: string | null;
  loyalty_points_balance: number;
  lifetime_points_earned: number;
  loyalty_tier_id: string | null;
  tags: string[];
  is_active: boolean;
}

interface LoyaltyTransaction {
  id: string;
  transaction_type: string;
  points: number;
  balance_after: number;
  sales_invoice_number: string | null;
  created_at: string;
}

interface CustomerNote {
  id: string;
  note: string;
  created_at: string;
  author_email: string | null;
}

interface PurchaseHistoryLine {
  description: string;
  qty: string;
  grossAmount: string;
}

interface PurchaseHistoryRow {
  id: string;
  document_number: string;
  invoice_date: string;
  document_status: string;
  gross_amount: string;
  currency: string;
  lines: PurchaseHistoryLine[];
}

function NewCustomerForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const [customerCode, setCustomerCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [customerType, setCustomerType] = useState("retail");
  const [crNumber, setCrNumber] = useState("");
  const [vatRegistrationNumber, setVatRegistrationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState(0);
  const [defaultPriceListId, setDefaultPriceListId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isB2b = customerType === "wholesale" || customerType === "credit";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/customers", {
        method: "POST",
        token,
        companyId,
        body: {
          customerCode,
          nameEn,
          nameAr,
          customerType,
          crNumber: crNumber || null,
          vatRegistrationNumber: vatRegistrationNumber || null,
          address: address || null,
          city: city || null,
          phone: phone || null,
          email: email || null,
          creditLimit: creditLimit ? Number(creditLimit) : null,
          paymentTermsDays,
          defaultPriceListId: defaultPriceListId || null,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create customer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Customer Code" required>
        <TextInput required value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <Field label="Type">
        <SelectInput value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
          <option value="credit">Credit</option>
        </SelectInput>
      </Field>

      {isB2b && (
        <div className="mb-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">B2B / ZATCA Standard-Invoice Terms</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CR Number">
              <TextInput value={crNumber} onChange={(e) => setCrNumber(e.target.value)} />
            </Field>
            <Field label="VAT Registration #">
              <TextInput value={vatRegistrationNumber} onChange={(e) => setVatRegistrationNumber(e.target.value)} />
            </Field>
            <Field label="City">
              <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="Phone">
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
          <Field label="Address">
            <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit Limit">
              <TextInput type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </Field>
            <Field label="Default Price List">
              <SelectInput value={defaultPriceListId} onChange={(e) => setDefaultPriceListId(e.target.value)}>
                <option value="">None</option>
                {priceLists?.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name_en}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        </div>
      )}

      <Field label="Payment Terms (days)">
        <TextInput type="number" min={0} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Create Customer" />
    </form>
  );
}

function EditTermsForm({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const [crNumber, setCrNumber] = useState(customer.cr_number ?? "");
  const [vatRegistrationNumber, setVatRegistrationNumber] = useState(customer.vat_registration_number ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const [creditLimit, setCreditLimit] = useState(customer.credit_limit ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(customer.payment_terms_days);
  const [defaultPriceListId, setDefaultPriceListId] = useState(customer.default_price_list_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/customers/${customer.id}/terms`, {
        method: "POST",
        token,
        companyId,
        body: {
          crNumber: crNumber || null,
          vatRegistrationNumber: vatRegistrationNumber || null,
          address: address || null,
          city: city || null,
          creditLimit: creditLimit ? Number(creditLimit) : null,
          paymentTermsDays,
          defaultPriceListId: defaultPriceListId || null,
        },
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save terms");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CR Number">
          <TextInput value={crNumber} onChange={(e) => setCrNumber(e.target.value)} />
        </Field>
        <Field label="VAT Registration #">
          <TextInput value={vatRegistrationNumber} onChange={(e) => setVatRegistrationNumber(e.target.value)} />
        </Field>
        <Field label="City">
          <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Credit Limit">
          <TextInput type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
        </Field>
      </div>
      <Field label="Address">
        <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment Terms (days)">
          <TextInput type="number" min={0} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
        </Field>
        <Field label="Default Price List">
          <SelectInput value={defaultPriceListId} onChange={(e) => setDefaultPriceListId(e.target.value)}>
            <option value="">None</option>
            {priceLists?.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Terms"}
      </button>
    </div>
  );
}

function LoyaltyPanel({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: tiers } = useApiList<{ id: string; name: string }>("/api/loyalty-tiers");
  const [isLoyaltyMember, setIsLoyaltyMember] = useState(customer.is_loyalty_member);
  const [loyaltyCardNumber, setLoyaltyCardNumber] = useState(customer.loyalty_card_number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[] | null>(null);
  const tierName = tiers?.find((t) => t.id === customer.loyalty_tier_id)?.name ?? null;

  useEffect(() => {
    apiRequest<LoyaltyTransaction[]>(`/api/customers/${customer.id}/loyalty-transactions`, { token, companyId }).then(setTransactions);
  }, [customer.id, token, companyId]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/customers/${customer.id}/loyalty`, {
        method: "POST",
        token,
        companyId,
        body: { isLoyaltyMember, loyaltyCardNumber: loyaltyCardNumber || null },
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save loyalty enrollment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Loyalty Program</p>
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={isLoyaltyMember} onChange={(e) => setIsLoyaltyMember(e.target.checked)} />
        Enrolled in loyalty program
      </label>
      {isLoyaltyMember && (
        <Field label="Loyalty Card Number">
          <TextInput value={loyaltyCardNumber} onChange={(e) => setLoyaltyCardNumber(e.target.value)} placeholder="Optional" />
        </Field>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mb-3 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Loyalty Enrollment"}
      </button>

      {customer.is_loyalty_member && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Current Balance</span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{customer.loyalty_points_balance} points</span>
          </div>
          {tierName && (
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Tier</span>
              <span className="font-semibold text-brand-600 dark:text-brand-400">{tierName}</span>
            </div>
          )}
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-slate-400 dark:text-slate-500">Lifetime Points Earned</span>
            <span className="text-slate-500 dark:text-slate-400">{customer.lifetime_points_earned}</span>
          </div>
          {transactions === null ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">Loading history...</p>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">No point activity yet.</p>
          ) : (
            <div className="space-y-1">
              {transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className="capitalize text-slate-600 dark:text-slate-300">
                    {t.transaction_type}
                    {t.sales_invoice_number && ` (${t.sales_invoice_number})`}
                  </span>
                  <span className={`tabular-nums font-medium ${t.points < 0 ? "text-red-600" : "text-green-600"}`}>
                    {t.points > 0 ? "+" : ""}
                    {t.points}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ customer }: { customer: Customer }) {
  const { token, companyId, hasPermission } = useAuth();
  const [notes, setNotes] = useState<CustomerNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    apiRequest<CustomerNote[]>(`/api/customers/${customer.id}/notes`, { token, companyId }).then(setNotes);
  }

  useEffect(reload, [customer.id, token, companyId]);

  async function addNote() {
    if (!draft.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/customers/${customer.id}/notes`, { method: "POST", token, companyId, body: { note: draft.trim() } });
      setDraft("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes</p>
      {hasPermission("sales.customer.notes.manage") && (
        <div className="mb-2 flex gap-2">
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note..." />
          <button
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {notes === null ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading...</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">No notes yet.</p>
      ) : (
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs">
              <p className="text-slate-700 dark:text-slate-200">{n.note}</p>
              <p className="mt-1 text-slate-400 dark:text-slate-500">
                {n.author_email ?? "Unknown"} · {new Date(n.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagsPanel({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const { token, companyId, hasPermission } = useAuth();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function setTags(tags: string[]) {
    setSaving(true);
    try {
      await apiRequest(`/api/customers/${customer.id}/tags`, { method: "POST", token, companyId, body: { tags } });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = draft.trim();
    if (!tag || customer.tags.includes(tag)) return;
    setDraft("");
    setTags([...customer.tags, tag]);
  }

  const canManage = hasPermission("sales.customer.tags.manage");

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Tags</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {customer.tags.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">No tags.</span>}
        {customer.tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          >
            {tag}
            {canManage && (
              <button
                onClick={() => setTags(customer.tags.filter((t) => t !== tag))}
                disabled={saving}
                className="text-brand-500 hover:text-brand-700"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {canManage && (
        <div className="flex gap-2">
          <TextInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="e.g. VIP, Frequent Buyer"
          />
          <button
            onClick={addTag}
            disabled={saving || !draft.trim()}
            className="shrink-0 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Add Tag
          </button>
        </div>
      )}
    </div>
  );
}

function PurchaseHistoryPanel({ customer }: { customer: Customer }) {
  const { token, companyId } = useAuth();
  const [result, setResult] = useState<{ rows: PurchaseHistoryRow[]; total: number } | null>(null);

  useEffect(() => {
    apiRequest<{ rows: PurchaseHistoryRow[]; total: number }>(`/api/customers/${customer.id}/purchase-history`, {
      token,
      companyId,
    }).then(setResult);
  }, [customer.id, token, companyId]);

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Purchase History</p>
      {result === null ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading...</p>
      ) : result.rows.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">No orders yet.</p>
      ) : (
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {result.rows.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-500 dark:text-slate-400">{r.document_number}</span>
                <span className="text-slate-400 dark:text-slate-500">{new Date(r.invoice_date).toLocaleDateString()}</span>
              </div>
              <div className="mt-1 space-y-0.5">
                {r.lines.map((l, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span>
                      {l.description} × {l.qty}
                    </span>
                    <span className="tabular-nums">{Number(l.grossAmount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-100 dark:border-slate-800 pt-1 text-xs font-medium text-slate-900 dark:text-slate-100">
                <span>Total</span>
                <span className="tabular-nums">
                  {Number(r.gross_amount).toFixed(2)} {r.currency}
                </span>
              </div>
            </div>
          ))}
          {result.total > result.rows.length && (
            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
              Showing {result.rows.length} of {result.total} orders.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Customers() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Customer>("/api/customers");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const priceListLabel = (id: string | null) => (id ? priceLists?.find((pl) => pl.id === id)?.name_en ?? "—" : "—");

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.customer_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "type", header: "Type", render: (r) => <span className="capitalize text-slate-600 dark:text-slate-300">{r.customer_type}</span> },
    { key: "terms", header: "Payment Terms", render: (r) => `${r.payment_terms_days}d`, numeric: true },
    { key: "credit", header: "Credit Limit", render: (r) => (r.credit_limit ? Number(r.credit_limit).toFixed(2) : "—"), numeric: true },
    { key: "priceList", header: "Price List", render: (r) => priceListLabel(r.default_price_list_id) },
    { key: "loyalty", header: "Loyalty", render: (r) => (r.is_loyalty_member ? `${r.loyalty_points_balance} pts` : "—"), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  const detailCustomer = data?.find((c) => c.id === detailId) ?? null;

  return (
    <>
      <ListPage
        title={t("nav.customers")}
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.customer_code} ${r.name_en} ${r.name_ar}`}
        emptyIcon={Users}
        emptyText="No customers found."
        searchPlaceholder="Search by code or name..."
        actionLabel="New Customer"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setDetailId(r.id)}
      />
      {showNew && (
        <Modal title="New Customer" onClose={() => setShowNew(false)}>
          <NewCustomerForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {detailCustomer && (
        <Modal title={detailCustomer.name_en} onClose={() => setDetailId(null)}>
          <EditTermsForm customer={detailCustomer} onChanged={reload} />
          <LoyaltyPanel customer={detailCustomer} onChanged={reload} />
          <TagsPanel customer={detailCustomer} onChanged={reload} />
          <NotesPanel customer={detailCustomer} />
          <PurchaseHistoryPanel customer={detailCustomer} />
        </Modal>
      )}
    </>
  );
}
