import { useTranslation } from "react-i18next";
import { Building2, CalendarClock } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Tabs from "../components/Tabs";
import type { Column } from "../components/DataTable";

interface FixedAsset {
  id: string;
  asset_code: string;
  name_en: string;
  name_ar: string;
  acquisition_date: string;
  acquisition_cost: string;
  accumulated_depreciation: string;
  status: string;
}

interface DepreciationRun {
  id: string;
  document_number: string;
  run_date: string;
  document_status: string;
}

function AssetsTab() {
  const { i18n } = useTranslation();
  const { data, error } = useApiList<FixedAsset>("/api/fixed-assets");

  const columns: Column<FixedAsset>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.asset_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "cost", header: "Cost", render: (r) => Number(r.acquisition_cost).toFixed(2), numeric: true },
    { key: "depr", header: "Accum. Depreciation", render: (r) => Number(r.accumulated_depreciation).toFixed(2), numeric: true },
    { key: "book", header: "Book Value", render: (r) => (Number(r.acquisition_cost) - Number(r.accumulated_depreciation)).toFixed(2), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.asset_code} ${r.name_en} ${r.name_ar}`}
      emptyIcon={Building2}
      emptyText="No fixed assets yet."
      searchPlaceholder="Search assets..."
      actionLabel="Acquire Asset"
    />
  );
}

function DepreciationRunsTab() {
  const { data, error } = useApiList<DepreciationRun>("/api/depreciation-runs");

  const columns: Column<DepreciationRun>[] = [
    { key: "number", header: "Run #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "date", header: "Run Date", render: (r) => new Date(r.run_date).toLocaleDateString() },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => r.document_number}
      emptyIcon={CalendarClock}
      emptyText="No depreciation runs yet."
      searchPlaceholder="Search runs..."
      actionLabel="New Depreciation Run"
    />
  );
}

export default function Assets() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.assets")}</h1>
      <Tabs
        tabs={[
          { key: "assets", label: "Assets", content: <AssetsTab /> },
          { key: "depreciation", label: "Depreciation Runs", content: <DepreciationRunsTab /> },
        ]}
      />
    </div>
  );
}
