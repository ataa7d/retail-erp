import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, KeyRound, ScrollText, Smartphone, RefreshCw } from "lucide-react";
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
          { key: "audit", label: "Audit Log", content: <AuditLogTab /> },
        ]}
      />
    </div>
  );
}
