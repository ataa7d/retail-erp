import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import type { Column } from "../components/DataTable";

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
}

interface Item {
  id: string;
  item_code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  variants: ItemVariant[];
}

export default function Items() {
  const { t, i18n } = useTranslation();
  const { data, error } = useApiList<Item>("/api/items");

  const columns: Column<Item>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.item_code}</span> },
    {
      key: "name",
      header: i18n.language.startsWith("ar") ? "الاسم" : "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "variants", header: "Variants", render: (r) => r.variants.length, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title={t("nav.items")}
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.item_code} ${r.name_en} ${r.name_ar}`}
      emptyIcon={Package}
      emptyText="No items found."
      searchPlaceholder="Search by code or name..."
      actionLabel="New Item"
    />
  );
}
