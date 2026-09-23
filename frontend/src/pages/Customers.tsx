import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
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

export default function Customers() {
  const { t, i18n } = useTranslation();
  const { data, error } = useApiList<Customer>("/api/customers");

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
    />
  );
}
