import { useTranslation } from "react-i18next";
import { ShoppingCart, Truck } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Tabs from "../components/Tabs";
import type { Column } from "../components/DataTable";

interface PurchaseOrder {
  id: string;
  document_number: string;
  order_date: string;
  expected_date: string | null;
  document_status: string;
  gross_amount: string;
  supplier_name_en: string;
  supplier_name_ar: string;
}

interface Supplier {
  id: string;
  supplier_code: string;
  name_en: string;
  name_ar: string;
  city: string | null;
  country: string | null;
  payment_terms_days: number;
  is_active: boolean;
}

function PurchaseOrdersTab() {
  const { i18n } = useTranslation();
  const { data, error } = useApiList<PurchaseOrder>("/api/purchase-orders");

  const columns: Column<PurchaseOrder>[] = [
    { key: "number", header: "PO #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.supplier_name_ar : r.supplier_name_en}</span>,
    },
    { key: "date", header: "Order Date", render: (r) => new Date(r.order_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => Number(r.gross_amount).toFixed(2), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
      emptyIcon={ShoppingCart}
      emptyText="No purchase orders yet."
      searchPlaceholder="Search purchase orders..."
    />
  );
}

function SuppliersTab() {
  const { data, error } = useApiList<Supplier>("/api/suppliers");

  const columns: Column<Supplier>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.supplier_code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name_en}</span> },
    { key: "location", header: "Location", render: (r) => [r.city, r.country].filter(Boolean).join(", ") || "—" },
    { key: "terms", header: "Payment Terms", render: (r) => `${r.payment_terms_days}d`, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.supplier_code} ${r.name_en}`}
      emptyIcon={Truck}
      emptyText="No suppliers yet."
      searchPlaceholder="Search suppliers..."
    />
  );
}

export default function Purchasing() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.purchasing")}</h1>
      <Tabs
        tabs={[
          { key: "pos", label: "Purchase Orders", content: <PurchaseOrdersTab /> },
          { key: "suppliers", label: "Suppliers", content: <SuppliersTab /> },
        ]}
      />
    </div>
  );
}
