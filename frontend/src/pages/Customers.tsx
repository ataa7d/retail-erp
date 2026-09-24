import { useState, type FormEvent } from "react";
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
  is_active: boolean;
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
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">B2B / ZATCA Standard-Invoice Terms</p>
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

export default function Customers() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Customer>("/api/customers");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const priceListLabel = (id: string | null) => (id ? priceLists?.find((pl) => pl.id === id)?.name_en ?? "—" : "—");

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.customer_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "type", header: "Type", render: (r) => <span className="capitalize text-slate-600">{r.customer_type}</span> },
    { key: "terms", header: "Payment Terms", render: (r) => `${r.payment_terms_days}d`, numeric: true },
    { key: "credit", header: "Credit Limit", render: (r) => (r.credit_limit ? Number(r.credit_limit).toFixed(2) : "—"), numeric: true },
    { key: "priceList", header: "Price List", render: (r) => priceListLabel(r.default_price_list_id) },
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
        <Modal title={`${detailCustomer.name_en} — B2B Terms`} onClose={() => setDetailId(null)}>
          <EditTermsForm customer={detailCustomer} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}
