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

interface Customer {
  id: string;
  customer_code: string;
  name_en: string;
  name_ar: string;
  customer_type: string;
  vat_registration_number: string | null;
  credit_limit: string | null;
  payment_terms_days: number;
  is_loyalty_member: boolean;
  is_active: boolean;
}

function NewCustomerForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [customerCode, setCustomerCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [customerType, setCustomerType] = useState("retail");
  const [paymentTermsDays, setPaymentTermsDays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/customers", {
        method: "POST",
        token,
        companyId,
        body: { customerCode, nameEn, nameAr, customerType, paymentTermsDays },
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
      <Field label="Payment Terms (days)">
        <TextInput type="number" min={0} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Create Customer" />
    </form>
  );
}

export default function Customers() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Customer>("/api/customers");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.customer_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "type", header: "Type", render: (r) => <span className="capitalize text-slate-600">{r.customer_type}</span> },
    { key: "terms", header: "Payment Terms", render: (r) => `${r.payment_terms_days}d`, numeric: true },
    { key: "loyalty", header: "Loyalty", render: (r) => (r.is_loyalty_member ? "Yes" : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

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
      />
      {showNew && (
        <Modal title="New Customer" onClose={() => setShowNew(false)}>
          <NewCustomerForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}
