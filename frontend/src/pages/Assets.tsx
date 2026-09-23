import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Building2, CalendarClock } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
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

interface AssetCategory {
  id: string;
  code: string;
  name_en: string;
}

interface FiscalPeriod {
  id: string;
  period_number: number;
  year_name: string;
  status: string;
}

interface DepreciationRun {
  id: string;
  document_number: string;
  run_date: string;
  document_status: string;
}

function AcquireAssetForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: categories } = useApiList<AssetCategory>("/api/asset-categories");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const [assetCategoryId, setAssetCategoryId] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [acquisitionCost, setAcquisitionCost] = useState(0);
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/fixed-assets", {
        method: "POST",
        token,
        companyId,
        body: { assetCategoryId, assetCode, nameEn, nameAr, acquisitionDate, acquisitionCost, salvageValue: 0, fiscalPeriodId },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to acquire asset");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Category" required>
        <SelectInput required value={assetCategoryId} onChange={(e) => setAssetCategoryId(e.target.value)}>
          <option value="">Select a category...</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Asset Code" required>
        <TextInput required value={assetCode} onChange={(e) => setAssetCode(e.target.value)} />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <Field label="Acquisition Date" required>
        <TextInput type="date" required value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
      </Field>
      <Field label="Acquisition Cost" required>
        <TextInput type="number" min={0.01} step="0.01" required value={acquisitionCost} onChange={(e) => setAcquisitionCost(Number(e.target.value))} />
      </Field>
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select a period...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — Period {p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>
      <p className="mb-3 text-xs text-slate-400">Books a cash-purchase journal (Dr Fixed Asset / Cr Cash) immediately.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Acquire Asset" />
    </form>
  );
}

function NewDepreciationRunForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/depreciation-runs", {
        method: "POST",
        token,
        companyId,
        body: { fiscalPeriodId, runDate },
      });
      await apiRequest(`/api/depreciation-runs/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create depreciation run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select a period...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — Period {p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Run Date" required>
        <TextInput type="date" required value={runDate} onChange={(e) => setRunDate(e.target.value)} />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        Computes straight-line depreciation for every active asset and posts the GL journal immediately.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Post" />
    </form>
  );
}

function AssetsTab() {
  const { i18n } = useTranslation();
  const { data, error, reload } = useApiList<FixedAsset>("/api/fixed-assets");
  const [showNew, setShowNew] = useState(false);

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
    <>
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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="Acquire Fixed Asset" onClose={() => setShowNew(false)}>
          <AcquireAssetForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function DepreciationRunsTab() {
  const { data, error, reload } = useApiList<DepreciationRun>("/api/depreciation-runs");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<DepreciationRun>[] = [
    { key: "number", header: "Run #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "date", header: "Run Date", render: (r) => new Date(r.run_date).toLocaleDateString() },
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
        getSearchText={(r) => r.document_number}
        emptyIcon={CalendarClock}
        emptyText="No depreciation runs yet."
        searchPlaceholder="Search runs..."
        actionLabel="New Depreciation Run"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Depreciation Run" onClose={() => setShowNew(false)}>
          <NewDepreciationRunForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
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
