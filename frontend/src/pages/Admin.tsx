import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, KeyRound, ScrollText, Smartphone, RefreshCw, CheckCircle2, XCircle, Circle, AlertTriangle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface AdminUser {
  id: string;
  email: string;
  full_name_en: string;
  full_name_ar: string;
  user_is_active: boolean;
  has_company_access: boolean;
  roles: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  permissions: string[];
}

interface AuditLogEntry {
  id: string;
  table_name: string;
  row_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor_user_id: string | null;
  occurred_at: string;
}

const ACTION_STYLE: Record<AuditLogEntry["action"], string> = {
  INSERT: "bg-green-100 text-green-700",
  UPDATE: "bg-amber-100 text-amber-700",
  DELETE: "bg-red-100 text-red-600",
};

function UsersTab() {
  const { data, error } = useApiList<AdminUser>("/api/admin/users");

  const columns: Column<AdminUser>[] = [
    { key: "email", header: "Email", render: (r) => <span className="font-medium text-slate-900">{r.email}</span> },
    { key: "name", header: "Name", render: (r) => r.full_name_en },
    { key: "roles", header: "Roles", render: (r) => (r.roles.length ? r.roles.join(", ") : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.user_is_active && r.has_company_access ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.email} ${r.full_name_en}`}
      emptyIcon={ShieldCheck}
      emptyText="No users yet."
      searchPlaceholder="Search users..."
      actionLabel="Invite User"
    />
  );
}

function RolesTab() {
  const { data, error } = useApiList<Role>("/api/admin/roles");

  const columns: Column<Role>[] = [
    { key: "name", header: "Role", render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: "description", header: "Description", render: (r) => r.description ?? "—" },
    { key: "permissions", header: "Permissions", render: (r) => r.permissions.length, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => r.name}
      emptyIcon={KeyRound}
      emptyText="No roles yet."
      searchPlaceholder="Search roles..."
      actionLabel="New Role"
    />
  );
}

function AuditLogTab() {
  const { data, error } = useApiList<AuditLogEntry>("/api/admin/audit-log?limit=100");

  const columns: Column<AuditLogEntry>[] = [
    { key: "action", header: "Action", render: (r) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_STYLE[r.action]}`}>{r.action}</span> },
    { key: "table", header: "Table", render: (r) => <span className="font-mono text-xs text-slate-600">{r.table_name}</span> },
    { key: "row", header: "Row", render: (r) => <span className="font-mono text-xs text-slate-400">{r.row_id.slice(0, 8)}…</span> },
    { key: "when", header: "When", render: (r) => new Date(r.occurred_at).toLocaleString() },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.table_name} ${r.action}`}
      emptyIcon={ScrollText}
      emptyText="No audit history yet."
      searchPlaceholder="Search audit log..."
    />
  );
}

interface Store {
  id: string;
  store_code: string;
  name_en: string;
}

interface PosDevice {
  id: string;
  store_id: string;
  device_code: string;
  device_name: string;
  series_prefix: string;
  status: string;
  last_synced_invoice_seq: string | number | null;
  last_synced_credit_note_seq: string | number | null;
}

function NewPosDeviceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const [storeId, setStoreId] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [seriesPrefix, setSeriesPrefix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/pos-devices", {
        method: "POST",
        token,
        companyId,
        body: { storeId, deviceCode, deviceName, seriesPrefix },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to register device");
    } finally {
      setSubmitting(false);
    }
  }

  const storeCode = stores?.find((s) => s.id === storeId)?.store_code ?? "";

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Store" required>
        <SelectInput required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Select...</option>
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en} ({s.store_code})
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Device Code" required>
        <TextInput required value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} placeholder="e.g. POS3" />
      </Field>
      <Field label="Device Name" required>
        <TextInput required value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. Till 3" />
      </Field>
      <Field label="Series Prefix" required>
        <TextInput
          required
          value={seriesPrefix}
          onChange={(e) => setSeriesPrefix(e.target.value.toUpperCase())}
          placeholder={storeCode ? `${storeCode}-POS3-` : "ST01-POS3-"}
        />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        Must look like <span className="font-mono">ST01-POS3-</span> — this prefix is permanent for the device and is prepended to every
        invoice/credit-note number it issues offline, so numbering never collides across devices.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Register Device" />
    </form>
  );
}

function PosDevicesTab() {
  const { token, companyId } = useAuth();
  const { data, error, reload } = useApiList<PosDevice>("/api/pos-devices");
  const { data: stores } = useApiList<Store>("/api/stores");
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const storeLabel = (id: string) => stores?.find((s) => s.id === id)?.store_code ?? "?";

  async function retire(device: PosDevice) {
    setBusyId(device.id);
    try {
      await apiRequest(`/api/pos-devices/${device.id}/retire`, { method: "POST", token, companyId });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<PosDevice>[] = [
    { key: "code", header: "Device", render: (r) => <span className="font-medium text-slate-900">{r.device_name}</span> },
    { key: "store", header: "Store", render: (r) => storeLabel(r.store_id) },
    { key: "prefix", header: "Series Prefix", render: (r) => <span className="font-mono text-xs text-slate-500">{r.series_prefix}</span> },
    { key: "inv_seq", header: "Invoices Synced", render: (r) => Number(r.last_synced_invoice_seq ?? 0), numeric: true },
    { key: "cn_seq", header: "Credit Notes Synced", render: (r) => Number(r.last_synced_credit_note_seq ?? 0), numeric: true },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status === "active" ? "active" : "inactive"} />
          {r.status === "active" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                retire(r);
              }}
              disabled={busyId === r.id}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              Retire
            </button>
          )}
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
        getSearchText={(r) => `${r.device_code} ${r.device_name} ${r.series_prefix}`}
        emptyIcon={Smartphone}
        emptyText="No POS devices registered."
        searchPlaceholder="Search devices..."
        actionLabel="Register Device"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="Register POS Device" onClose={() => setShowNew(false)}>
          <NewPosDeviceForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

interface Customer {
  id: string;
  name_en: string;
}

interface FiscalPeriod {
  id: string;
  status: string;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
}

interface SyncItem {
  name_en: string;
  variants: ItemVariant[];
}

interface QueuedInvoice {
  clientUuid: string;
  deviceSequenceNumber: number;
  label: string;
  amount: number;
  status: "queued" | "synced" | "already_synced" | "error";
  resultId?: string;
  errorMessage?: string;
}

interface SyncResult {
  clientUuid: string;
  status: "synced" | "already_synced" | "error";
  id?: string;
  error?: string;
}

function useSyncVariantOptions() {
  const { data: items } = useApiList<SyncItem>("/api/items");
  const options: Array<{ id: string; label: string }> = [];
  for (const item of items ?? []) {
    for (const v of item.variants) {
      const detail = [v.color, v.size].filter(Boolean).join(" / ");
      options.push({ id: v.id, label: `${item.name_en} — ${v.variant_code}${detail ? ` (${detail})` : ""}` });
    }
  }
  return options;
}

function OfflineSyncTab() {
  const { token, companyId } = useAuth();
  const { data: devices } = useApiList<PosDevice>("/api/pos-devices");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const variantOptions = useSyncVariantOptions();
  const openPeriodId = periods?.find((p) => p.status === "open")?.id ?? "";

  const [deviceId, setDeviceId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [itemVariantId, setItemVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("100");
  const [queue, setQueue] = useState<QueuedInvoice[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pullResult, setPullResult] = useState<{ items: number; customers: number; priceLists: number; stockBalances: number; serverTime: string } | null>(
    null,
  );
  const [pulling, setPulling] = useState(false);

  const device = devices?.find((d) => d.id === deviceId) ?? null;
  const nextSeq = (device ? Number(device.last_synced_invoice_seq ?? 0) : 0) + queue.length + 1;

  function addToQueue() {
    if (!device || !itemVariantId) return;
    const variantLabel = variantOptions.find((v) => v.id === itemVariantId)?.label ?? "Item";
    const amount = Number(qty) * Number(unitPrice);
    setQueue((prev) => [
      ...prev,
      {
        clientUuid: crypto.randomUUID(),
        deviceSequenceNumber: nextSeq,
        label: `${variantLabel} × ${qty}`,
        amount,
        status: "queued",
      },
    ]);
  }

  function buildPayload() {
    return queue.map((q) => ({
      clientUuid: q.clientUuid,
      deviceSequenceNumber: q.deviceSequenceNumber,
      storeId: device!.store_id,
      zatcaInvoiceCategory: "simplified" as const,
      invoiceDate: new Date().toISOString().slice(0, 10),
      fiscalPeriodId: openPeriodId,
      customerId: customerId || null,
      lines: [
        {
          itemVariantId,
          itemDescription: q.label,
          qty: 1,
          unitPrice: q.amount,
          discountAmount: 0,
          vatRate: 15,
          priceIncludesVat: true,
        },
      ],
      payments: [{ paymentMethod: "cash" as const, amount: q.amount }],
    }));
  }

  async function pushQueue() {
    if (!device || queue.length === 0) return;
    setPushing(true);
    setPushError(null);
    try {
      const res = await apiRequest<{ results: SyncResult[] }>("/api/sync/push/invoices", {
        method: "POST",
        token,
        companyId,
        body: { deviceId: device.id, invoices: buildPayload() },
      });
      setQueue((prev) =>
        prev.map((q) => {
          const result = res.results.find((r) => r.clientUuid === q.clientUuid);
          if (!result) return q;
          return { ...q, status: result.status, resultId: result.id, errorMessage: result.error };
        }),
      );
    } catch (err) {
      setPushError(err instanceof ApiError ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }

  async function pullCatalog() {
    if (!device) return;
    setPulling(true);
    try {
      const res = await apiRequest<{
        serverTime: string;
        items: unknown[];
        customers: unknown[];
        priceLists: unknown[];
        stockBalances: unknown[];
      }>(`/api/sync/pull?storeId=${device.store_id}`, { token, companyId });
      setPullResult({
        items: res.items.length,
        customers: res.customers.length,
        priceLists: res.priceLists.length,
        stockBalances: res.stockBalances.length,
        serverTime: res.serverTime,
      });
    } finally {
      setPulling(false);
    }
  }

  const STATUS_STYLE: Record<QueuedInvoice["status"], string> = {
    queued: "bg-slate-100 text-slate-600",
    synced: "bg-green-100 text-green-700",
    already_synced: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-600",
  };

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Simulates a POS device that has been taking sales while offline. Queue up a few draft invoices locally (nothing is sent to the
        server yet), then push the whole queue in one batch — exactly what a real device does when connectivity returns. Pushing the same
        queue twice demonstrates that a retried sync is idempotent rather than double-posting.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
        <Field label="POS Device" required>
          <SelectInput
            required
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              setQueue([]);
              setPullResult(null);
            }}
          >
            <option value="">Select a device...</option>
            {devices?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.device_name} ({d.series_prefix})
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Customer (optional)">
          <SelectInput value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Item">
          <SelectInput value={itemVariantId} onChange={(e) => setItemVariantId(e.target.value)}>
            <option value="">Select...</option>
            {variantOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qty">
            <TextInput type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Unit Price (VAT incl.)">
            <TextInput type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <button
            onClick={addToQueue}
            disabled={!deviceId || !itemVariantId || !openPeriodId}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            + Add Offline Sale to Queue
          </button>
          {!openPeriodId && <p className="mt-1 text-xs text-red-500">No open fiscal period found — cannot queue a sale.</p>}
        </div>
      </div>

      {queue.length > 0 && (
        <div className="mb-4 rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 text-start">Seq #</th>
                <th className="px-4 py-2.5 text-start">Line</th>
                <th className="px-4 py-2.5 text-end">Amount</th>
                <th className="px-4 py-2.5 text-start">Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.clientUuid} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 tabular-nums">{q.deviceSequenceNumber}</td>
                  <td className="px-4 py-2.5">{q.label}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{q.amount.toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[q.status]}`}>
                      {q.status}
                      {q.errorMessage ? `: ${q.errorMessage}` : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={pushQueue}
          disabled={pushing || queue.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          <RefreshCw size={14} /> {pushing ? "Pushing..." : "Push Queue to Server"}
        </button>
        <button
          onClick={() => setQueue([])}
          disabled={queue.length === 0}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Clear Queue
        </button>
        {pushError && <span className="text-sm text-red-600">{pushError}</span>}
      </div>

      <div className="rounded-md border border-slate-200 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Catalog Pull</h3>
        <p className="mb-3 text-sm text-slate-500">
          Fetches the consolidated snapshot a device pulls before going offline again: items, customers, price lists, and stock balances
          for the selected device's store.
        </p>
        <button
          onClick={pullCatalog}
          disabled={!deviceId || pulling}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {pulling ? "Pulling..." : "Pull Catalog Snapshot"}
        </button>
        {pullResult && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-slate-400">Items</div>
              <div className="font-medium text-slate-900">{pullResult.items}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-400">Customers</div>
              <div className="font-medium text-slate-900">{pullResult.customers}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-400">Price Lists</div>
              <div className="font-medium text-slate-900">{pullResult.priceLists}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-400">Stock Balances</div>
              <div className="font-medium text-slate-900">{pullResult.stockBalances}</div>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <div className="text-xs uppercase text-slate-400">Server Time</div>
              <div className="font-mono text-xs text-slate-600">{pullResult.serverTime}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ZatcaOnboardingStatus {
  status: string;
  environment?: string;
  egs_common_name?: string | null;
  egs_serial_number?: string | null;
  compliance_csid_issued_at?: string | null;
  compliance_checks_passed_at?: string | null;
  production_csid_issued_at?: string | null;
  last_error?: string | null;
}

interface ZatcaComplianceCheck {
  id: string;
  document_type: string;
  source_invoice_id: string | null;
  passed: boolean | null;
  submitted_at: string;
}

interface SimpleSalesInvoice {
  id: string;
  document_number: string;
  document_status: string;
  zatca_invoice_category: string;
}

interface SimpleCreditNote {
  id: string;
  document_number: string;
  document_status: string;
  zatca_invoice_category: string;
}

interface ZatcaReadinessCheckRow {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface ZatcaReadinessReport {
  ready: boolean;
  checks: ZatcaReadinessCheckRow[];
}

function ReadinessStatusIcon({ status }: { status: ZatcaReadinessCheckRow["status"] }) {
  if (status === "pass") return <CheckCircle2 size={16} className="shrink-0 text-green-600" />;
  if (status === "warn") return <AlertTriangle size={16} className="shrink-0 text-amber-500" />;
  return <XCircle size={16} className="shrink-0 text-red-600" />;
}

function ZatcaReadinessPanel() {
  const { token, companyId } = useAuth();
  const [report, setReport] = useState<ZatcaReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiRequest<ZatcaReadinessReport>("/api/zatca-onboarding/readiness", { token, companyId });
      setReport(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">5. Production Go-Live Readiness</h3>
        <button onClick={reload} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        A live check against this company's own data and onboarding state — not a static checklist. Every item below
        is computed fresh each time; nothing here can confirm ZATCA's own approval, only what's true on this side.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {report && (
        <>
          <div
            className={`mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              report.ready ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {report.ready ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {report.ready ? "Ready for production go-live" : "Not ready for production go-live"}
          </div>
          <div className="space-y-2">
            {report.checks.map((c) => (
              <div key={c.id} className="flex items-start gap-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                <ReadinessStatusIcon status={c.status} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800">{c.label}</div>
                  <div className="text-xs text-slate-500">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ONBOARDING_STEPS = [
  { key: "csr_generated", label: "Generate CSR" },
  { key: "compliance_csid_issued", label: "Compliance CSID" },
  { key: "compliance_checks_passed", label: "Compliance Checks" },
  { key: "production_csid_issued", label: "Production CSID" },
] as const;

function stepState(status: string, stepKey: string): "done" | "current" | "pending" {
  const order = ["not_started", "csr_generated", "compliance_csid_issued", "compliance_checks_passed", "production_csid_issued"];
  const statusIndex = status === "failed" ? -1 : order.indexOf(status);
  const stepIndex = order.indexOf(stepKey);
  if (statusIndex === -1) return "pending";
  if (stepIndex <= statusIndex) return "done";
  if (stepIndex === statusIndex + 1) return "current";
  return "pending";
}

function OnboardingStepper({ status }: { status: string }) {
  return (
    <div className="mb-4 flex items-center gap-1">
      {ONBOARDING_STEPS.map((step, i) => {
        const state = stepState(status, step.key);
        return (
          <div key={step.key} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                state === "done"
                  ? "bg-green-100 text-green-700"
                  : state === "current"
                    ? "bg-brand-50 text-brand-700 ring-1 ring-brand-300"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {state === "done" ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              {step.label}
            </div>
            {i < ONBOARDING_STEPS.length - 1 && <div className="h-px w-4 bg-slate-200" />}
          </div>
        );
      })}
      {status === "failed" && (
        <span className="ms-2 flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600">
          <XCircle size={13} /> Failed
        </span>
      )}
    </div>
  );
}

function ZatcaOnboardingTab() {
  const { token, companyId } = useAuth();
  const [status, setStatus] = useState<ZatcaOnboardingStatus | null>(null);
  const [checks, setChecks] = useState<ZatcaComplianceCheck[]>([]);
  const { data: invoices } = useApiList<SimpleSalesInvoice>("/api/sales-invoices");
  const { data: creditNotes } = useApiList<SimpleCreditNote>("/api/credit-notes");

  const [environment, setEnvironment] = useState<"sandbox" | "simulation" | "production">("sandbox");
  const [organizationalUnitName, setOrganizationalUnitName] = useState("");
  const [commonName, setCommonName] = useState("");
  const [egsSerialNumber, setEgsSerialNumber] = useState("");
  const [location, setLocation] = useState("");
  const [industryBusinessCategory, setIndustryBusinessCategory] = useState("Retail");
  const [otp, setOtp] = useState("");
  const [documentType, setDocumentType] = useState<"standard_invoice" | "simplified_invoice" | "standard_credit_note" | "simplified_credit_note">(
    "simplified_invoice",
  );
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");

  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [s, c] = await Promise.all([
      apiRequest<ZatcaOnboardingStatus>("/api/zatca-onboarding", { token, companyId }),
      apiRequest<ZatcaComplianceCheck[]>("/api/zatca-onboarding/compliance-checks", { token, companyId }),
    ]);
    setStatus(s);
    setChecks(c);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runStep(step: string, fn: () => Promise<unknown>) {
    setBusyStep(step);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusyStep(null);
    }
  }

  const isSimplified = documentType.startsWith("simplified");
  const isCreditNote = documentType.endsWith("credit_note");
  const candidateDocuments = isCreditNote
    ? (creditNotes ?? []).filter((c) => c.document_status === "posted" && (c.zatca_invoice_category === "simplified") === isSimplified)
    : (invoices ?? []).filter((i) => i.document_status === "posted" && (i.zatca_invoice_category === "simplified") === isSimplified);

  return (
    <div>
      <p className="mb-4 max-w-2xl rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        This connects to ZATCA's real e-invoicing sandbox over the network. Each step below needs your own ZATCA
        Fatoora developer-portal OTP or credentials — this codebase has none of its own, and nothing here is
        simulated or faked. The CSR's custom extension fields are a best-effort encoding of ZATCA's published
        format; if a step is rejected, that's the first thing worth re-checking against ZATCA's current
        documentation.
      </p>

      {status && <OnboardingStepper status={status.status} />}
      {status?.last_error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">Last error: {status.last_error}</p>}
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">1. Generate CSR</h3>
          <p className="mb-3 text-xs text-slate-500">
            Creates a fresh secp256k1 keypair for this company's EGS unit and a CSR carrying ZATCA's required fields.
            The private key is encrypted at rest and never leaves the server.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Environment">
              <SelectInput value={environment} onChange={(e) => setEnvironment(e.target.value as typeof environment)}>
                <option value="sandbox">Sandbox (developer portal)</option>
                <option value="simulation">Simulation</option>
                <option value="production">Production</option>
              </SelectInput>
            </Field>
            <Field label="Branch / Organizational Unit">
              <TextInput value={organizationalUnitName} onChange={(e) => setOrganizationalUnitName(e.target.value)} placeholder="Riyadh Flagship Branch" />
            </Field>
            <Field label="EGS Common Name">
              <TextInput value={commonName} onChange={(e) => setCommonName(e.target.value)} placeholder="POS-EGS-01" />
            </Field>
            <Field label="EGS Serial Number">
              <TextInput value={egsSerialNumber} onChange={(e) => setEgsSerialNumber(e.target.value)} placeholder="1-RetailERP|2-POS|3-0001" />
            </Field>
            <Field label="Location">
              <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Riyadh" />
            </Field>
            <Field label="Industry / Business Category">
              <TextInput value={industryBusinessCategory} onChange={(e) => setIndustryBusinessCategory(e.target.value)} />
            </Field>
          </div>
          <button
            onClick={() =>
              runStep("csr", () =>
                apiRequest("/api/zatca-onboarding/csr", {
                  method: "POST",
                  token,
                  companyId,
                  body: { environment, organizationalUnitName, commonName, egsSerialNumber, location, industryBusinessCategory, invoiceType: "1100" },
                }),
              )
            }
            disabled={busyStep === "csr" || !organizationalUnitName || !commonName || !egsSerialNumber || !location}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busyStep === "csr" ? "Generating..." : "Generate CSR"}
          </button>
        </div>

        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">2. Request Compliance CSID</h3>
          <p className="mb-3 text-xs text-slate-500">
            Exchanges the CSR above for a compliance certificate, using the one-time OTP from your ZATCA Fatoora
            portal (Onboarding → Generate OTP). The OTP is single-use and never stored.
          </p>
          <div className="mb-2 flex gap-2">
            <TextInput value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="OTP from ZATCA portal" className="max-w-xs" />
            <button
              onClick={() => runStep("compliance-csid", () => apiRequest("/api/zatca-onboarding/compliance-csid", { method: "POST", token, companyId, body: { otp } }))}
              disabled={busyStep === "compliance-csid" || !otp || !status || status.status === "not_started"}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busyStep === "compliance-csid" ? "Requesting..." : "Request Compliance CSID"}
            </button>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">3. Compliance Checks</h3>
          <p className="mb-3 text-xs text-slate-500">
            Submits one of your own posted documents to ZATCA for validation against the compliance certificate.
            Run this once per document type you'll issue (standard/simplified invoice, standard/simplified credit
            note) before requesting the production CSID.
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <SelectInput value={documentType} onChange={(e) => { setDocumentType(e.target.value as typeof documentType); setSourceInvoiceId(""); }}>
              <option value="simplified_invoice">Simplified Invoice</option>
              <option value="standard_invoice">Standard Invoice</option>
              <option value="simplified_credit_note">Simplified Credit Note</option>
              <option value="standard_credit_note">Standard Credit Note</option>
            </SelectInput>
            <SelectInput value={sourceInvoiceId} onChange={(e) => setSourceInvoiceId(e.target.value)}>
              <option value="">Select a posted document...</option>
              {candidateDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.document_number}
                </option>
              ))}
            </SelectInput>
          </div>
          <button
            onClick={() =>
              runStep("compliance-check", () =>
                apiRequest("/api/zatca-onboarding/compliance-check", { method: "POST", token, companyId, body: { documentType, sourceInvoiceId } }),
              )
            }
            disabled={busyStep === "compliance-check" || !sourceInvoiceId || status?.status === "not_started" || status?.status === "csr_generated"}
            className="mb-3 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busyStep === "compliance-check" ? "Submitting..." : "Submit Compliance Check"}
          </button>

          {checks.length > 0 && (
            <div className="space-y-1 border-t border-slate-100 pt-2">
              {checks.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    {c.document_type.replace(/_/g, " ")} · {new Date(c.submitted_at).toLocaleString()}
                  </span>
                  <StatusBadge status={c.passed ? "active" : "inactive"} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">4. Request Production CSID</h3>
          <p className="mb-3 text-xs text-slate-500">
            Exchanges the compliance certificate for the real production certificate, once compliance checks have
            passed. This is the credential real invoice reporting/clearance would use.
          </p>
          <button
            onClick={() => runStep("production-csid", () => apiRequest("/api/zatca-onboarding/production-csid", { method: "POST", token, companyId }))}
            disabled={busyStep === "production-csid" || status?.status !== "compliance_checks_passed"}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busyStep === "production-csid" ? "Requesting..." : "Request Production CSID"}
          </button>
        </div>

        <ZatcaReadinessPanel />
      </div>
    </div>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.admin")}</h1>
      <Tabs
        tabs={[
          { key: "users", label: "Users", content: <UsersTab /> },
          { key: "roles", label: "Roles", content: <RolesTab /> },
          { key: "pos-devices", label: "POS Devices", content: <PosDevicesTab /> },
          { key: "offline-sync", label: "Offline Sync", content: <OfflineSyncTab /> },
          { key: "zatca", label: "ZATCA Onboarding", content: <ZatcaOnboardingTab /> },
          { key: "audit", label: "Audit Log", content: <AuditLogTab /> },
        ]}
      />
    </div>
  );
}
