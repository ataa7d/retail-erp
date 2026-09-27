import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Package,
  Users,
  UserCog,
  Building2,
  ShoppingCart,
  CalendarDays,
  Warehouse,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import { formatMoney, useBaseCurrency } from "../lib/currency";
import KpiTile from "../components/KpiTile";
import Modal from "../components/Modal";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";

interface DashboardSummary {
  todaySales: { total: number; count: number };
  monthToDateSales: { total: number; count: number };
  inventoryValue: number;
  arOutstanding: number;
  apOutstanding: number;
  lowStockCount: number;
}

interface LowStockItem {
  item_variant_id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  reorder_point: string;
  item_name_en: string;
  item_name_ar: string;
  qty_on_hand: string;
}

interface Store {
  id: string;
  name_en: string;
}

/**
 * Pre-fills a purchase requisition from the current low-stock list --
 * reorder-point alerts already existed and requisitions already existed,
 * but nothing connected the two, so restocking a low item meant manually
 * re-typing what the dashboard was already telling you was short. Suggested
 * qty is just enough to reach the reorder point; each line can be
 * unchecked or adjusted before submitting, and the requisition still goes
 * through the normal draft -> submitted -> approved workflow, this just
 * skips the "look up what's low and type it in" step.
 */
function CreateRequisitionFromLowStockForm({
  items,
  onClose,
  onCreated,
}: {
  items: LowStockItem[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const [storeId, setStoreId] = useState("");
  const [requisitionDate, setRequisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Record<string, { selected: boolean; qty: string }>>(() =>
    Object.fromEntries(
      items.map((i) => [
        i.item_variant_id,
        { selected: true, qty: String(Math.max(1, Math.ceil(Number(i.reorder_point) - Number(i.qty_on_hand)))) },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(id: string, patch: Partial<{ selected: boolean; qty: string }>) {
    setLines((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const selectedLines = items
      .filter((i) => lines[i.item_variant_id]?.selected && Number(lines[i.item_variant_id]?.qty) > 0)
      .map((i) => ({ itemVariantId: i.item_variant_id, qty: Number(lines[i.item_variant_id]!.qty) }));
    if (selectedLines.length === 0) {
      setError("Select at least one item.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/purchase-requisitions", {
        method: "POST",
        token,
        companyId,
        body: { storeId, requisitionDate, lines: selectedLines },
      });
      await apiRequest(`/api/purchase-requisitions/${created.id}/submit`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create requisition");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Store" required>
          <SelectInput required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Requisition Date" required>
          <TextInput type="date" required value={requisitionDate} onChange={(e) => setRequisitionDate(e.target.value)} />
        </Field>
      </div>
      <p className="mb-2 text-xs text-slate-400">
        Qty on hand is summed across all stores -- double-check the suggested quantity makes sense for the store you pick.
      </p>
      <div className="mb-3 space-y-1.5">
        {items.map((i) => {
          const detail = [i.color, i.size].filter(Boolean).join(" / ");
          const line = lines[i.item_variant_id]!;
          return (
            <div key={i.item_variant_id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
              <input
                type="checkbox"
                checked={line.selected}
                onChange={(e) => updateLine(i.item_variant_id, { selected: e.target.checked })}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-900">
                  {i.item_name_en}
                  {detail && <span className="text-slate-400"> ({detail})</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {Number(i.qty_on_hand)} on hand · reorder point {Number(i.reorder_point)}
                </div>
              </div>
              <div className="w-20 flex-none">
                <TextInput
                  type="number"
                  min={0.001}
                  step="0.001"
                  disabled={!line.selected}
                  value={line.qty}
                  onChange={(e) => updateLine(i.item_variant_id, { qty: e.target.value })}
                />
              </div>
            </div>
          );
        })}
      </div>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Submit Requisition" />
    </form>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, token, hasPermission } = useAuth();
  const company = companies.find((c) => c.id === companyId);
  const currency = useBaseCurrency();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [employeeCount, setEmployeeCount] = useState<number | null>(null);
  const [assetCount, setAssetCount] = useState<number | null>(null);
  const [showCreateRequisition, setShowCreateRequisition] = useState(false);
  const { data: lowStockItems, reload: reloadLowStock } = useApiList<LowStockItem>("/api/dashboard/low-stock");
  const canCreateRequisition = hasPermission("purchasing.requisition.create");

  useEffect(() => {
    if (!token || !companyId) return;

    apiRequest<DashboardSummary>("/api/dashboard/summary", { token, companyId }).then(setSummary);
    apiRequest<unknown[]>("/api/items", { token, companyId }).then((r) => setItemCount(r.length));
    apiRequest<unknown[]>("/api/customers", { token, companyId }).then((r) => setCustomerCount(r.length));
    if (hasPermission("hr.employee.manage")) {
      apiRequest<unknown[]>("/api/employees", { token, companyId }).then((r) => setEmployeeCount(r.length));
    }
    if (hasPermission("assets.fixed_asset.manage")) {
      apiRequest<unknown[]>("/api/fixed-assets", { token, companyId }).then((r) => setAssetCount(r.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);

  const firstName = me?.user.email.split("@")[0] ?? "";
  const loading = summary === null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          {t("dashboard.welcome")}, {firstName}
        </h1>
        <p className="text-sm text-slate-500">
          {i18n.language.startsWith("ar") ? company?.name_ar : company?.name_en}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KpiTile
          to="/sales"
          label="Today's Sales"
          value={loading ? "—" : formatMoney(summary.todaySales.total)}
          icon={ShoppingCart}
          accent="brand"
          loading={loading}
        />
        <KpiTile
          to="/sales"
          label="Sales This Month"
          value={loading ? "—" : formatMoney(summary.monthToDateSales.total)}
          icon={CalendarDays}
          accent="brand"
          loading={loading}
        />
        <KpiTile
          to="/inventory"
          label="Inventory Value"
          value={loading ? "—" : formatMoney(summary.inventoryValue)}
          icon={Warehouse}
          accent="slate"
          loading={loading}
        />
        <KpiTile
          to="/customers"
          label="AR Outstanding"
          value={loading ? "—" : formatMoney(summary.arOutstanding)}
          icon={ArrowDownCircle}
          accent="green"
          loading={loading}
        />
        <KpiTile
          to="/purchasing"
          label="AP Outstanding"
          value={loading ? "—" : formatMoney(summary.apOutstanding)}
          icon={ArrowUpCircle}
          accent="amber"
          loading={loading}
        />
        <KpiTile
          to="/items"
          label="Low Stock Alerts"
          value={loading ? "—" : summary.lowStockCount}
          icon={AlertTriangle}
          accent={!loading && summary.lowStockCount > 0 ? "amber" : "slate"}
          loading={loading}
        />
        <KpiTile to="/items" label={t("nav.items")} value={itemCount ?? "—"} icon={Package} accent="brand" loading={itemCount === null} />
        <KpiTile to="/customers" label={t("nav.customers")} value={customerCount ?? "—"} icon={Users} accent="green" loading={customerCount === null} />
        {hasPermission("hr.employee.manage") && (
          <KpiTile to="/hr" label={t("nav.hr")} value={employeeCount ?? "—"} icon={UserCog} accent="amber" loading={employeeCount === null} />
        )}
        {hasPermission("assets.fixed_asset.manage") && (
          <KpiTile to="/assets" label={t("nav.assets")} value={assetCount ?? "—"} icon={Building2} accent="slate" loading={assetCount === null} />
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">Sales and stock figures are in {currency}.</p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Your roles</h2>
        <div className="flex flex-wrap gap-2">
          {me?.roles.map((r) => (
            <span
              key={r.id + (r.store_id ?? "")}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {r.name}
              {r.store_id ? " · store-scoped" : ""}
            </span>
          ))}
        </div>
      </div>

      {lowStockItems && lowStockItems.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <AlertTriangle size={15} className="text-amber-600" /> Low Stock ({lowStockItems.length})
            </h2>
            {canCreateRequisition && (
              <button
                onClick={() => setShowCreateRequisition(true)}
                className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
              >
                <ClipboardList size={13} /> Create Purchase Requisition
              </button>
            )}
          </div>
          <div className="space-y-1">
            {lowStockItems.map((i) => {
              const detail = [i.color, i.size].filter(Boolean).join(" / ");
              return (
                <div key={i.item_variant_id} className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm">
                  <span className="text-slate-700">
                    {i.item_name_en}
                    {detail && <span className="text-slate-400"> ({detail})</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {Number(i.qty_on_hand)} on hand · reorder at {Number(i.reorder_point)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCreateRequisition && lowStockItems && (
        <Modal title="Create Purchase Requisition from Low Stock" onClose={() => setShowCreateRequisition(false)}>
          <CreateRequisitionFromLowStockForm
            items={lowStockItems}
            onClose={() => setShowCreateRequisition(false)}
            onCreated={reloadLowStock}
          />
        </Modal>
      )}
    </div>
  );
}
