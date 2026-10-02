import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ClipboardList, Truck, Plus, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import { runBulkAction } from "../lib/bulkAction";
import ListPage from "../components/ListPage";
import Modal from "../components/Modal";
import StatusBadge from "../components/StatusBadge";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";
import { ItemsSection } from "./Items";

interface Store {
  id: string;
  store_code: string;
  name_en: string;
  name_ar: string;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  barcodes?: Array<{ barcode: string }> | null;
}

interface Item {
  item_code: string;
  name_en: string;
  name_ar: string;
  variants: ItemVariant[];
}

interface Transfer {
  id: string;
  movement_at: string;
  qty: string;
  total_cost: string;
  source_store_name: string;
  dest_store_name: string;
  item_name_en: string;
  variant_code: string;
}

interface Stocktake {
  id: string;
  document_number: string;
  stocktake_date: string;
  document_status: string;
  store_name_en: string;
  line_count: string;
  uncounted_count: string;
}

interface StocktakeLine {
  id: string;
  item_variant_id: string;
  snapshot_qty: string;
  counted_qty: string | null;
  variance_qty: string | null;
  variant_code: string;
  item_name_en: string;
}

interface StocktakeDetail {
  id: string;
  document_status: string;
  document_number: string;
  lines: StocktakeLine[];
}

interface InventoryTransferOrder {
  id: string;
  document_number: string;
  transfer_date: string;
  document_status: string;
  notes: string | null;
  source_store_name_en: string;
  dest_store_name_en: string;
  line_count: string;
}

interface InventoryTransferLine {
  id: string;
  item_variant_id: string;
  qty: string;
  variant_code: string;
  item_name_en: string;
}

interface InventoryTransferDetail extends InventoryTransferOrder {
  lines: InventoryTransferLine[];
}

function useVariantOptions() {
  const { data: items } = useApiList<Item>("/api/items");
  const options: Array<{ id: string; label: string }> = [];
  for (const item of items ?? []) {
    for (const v of item.variants) {
      const detail = [v.color, v.size].filter(Boolean).join(" / ");
      options.push({ id: v.id, label: `${item.name_en} — ${v.variant_code}${detail ? ` (${detail})` : ""}` });
    }
  }
  return options;
}

// Same client-side barcode -> variant lookup as POS.tsx's cart scanning and
// Purchasing.tsx's goods-receipt scanning -- built once from the already-
// loaded catalog, no round trip per scan.
function useBarcodeMap() {
  const { data: items } = useApiList<Item>("/api/items");
  const map = new Map<string, { variantId: string; label: string }>();
  for (const item of items ?? []) {
    for (const v of item.variants) {
      const detail = [v.color, v.size].filter(Boolean).join(" / ");
      const label = `${item.name_en} — ${v.variant_code}${detail ? ` (${detail})` : ""}`;
      for (const b of v.barcodes ?? []) {
        map.set(b.barcode, { variantId: v.id, label });
      }
    }
  }
  return map;
}

interface StockVariantRow {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
  reorder_point: string;
  item_id: string;
  item_code: string;
  name_en: string;
  name_ar: string;
  brand_name: string | null;
  category_name: string | null;
  season_name: string | null;
  group_name: string | null;
  primary_barcode: string | null;
  qty_on_hand: string;
  stores_in_stock: string;
}

interface StockSearchResponse {
  rows: StockVariantRow[];
  total: number;
  page: number;
  pageSize: number;
}

type StockSortColumn = "variantCode" | "itemCode" | "name" | "color" | "size" | "qty";

interface StockFilters {
  search: string;
  itemCode: string;
  color: string;
  size: string;
  barcode: string;
  groupId: string;
  storeId: string;
  belowReorderPoint: boolean;
}

const EMPTY_STOCK_FILTERS: StockFilters = {
  search: "", itemCode: "", color: "", size: "", barcode: "", groupId: "", storeId: "", belowReorderPoint: false,
};

function StoreBreakdownModal({ variant, onClose }: { variant: StockVariantRow; onClose: () => void }) {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const [rows, setRows] = useState<Array<{ store_id: string; store_name_en: string; store_name_ar: string; qty_on_hand: string }> | null>(null);

  useEffect(() => {
    apiRequest<{ rows: typeof rows }>(`/api/stock-balances/variants/${variant.id}/by-store`, { token, companyId }).then((r) => setRows(r.rows));
  }, [variant.id, token, companyId]);

  return (
    <Modal title={`${variant.name_en} — ${variant.variant_code}`} onClose={onClose}>
      {!rows ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No active stores.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.store_id} className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">{i18n.language.startsWith("ar") ? r.store_name_ar : r.store_name_en}</span>
              <span className={`tabular-nums ${Number(r.qty_on_hand) <= 0 ? "text-slate-300 dark:text-slate-600" : "font-medium text-slate-900 dark:text-slate-100"}`}>
                {Number(r.qty_on_hand).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Every item variant as a row, availability as a column -- scales to any
// number of stores because a store is a *filter* here (optional storeId
// narrows qty to just that store), never a column of its own. Same
// paginated/filterable shape as Items' "All Variants" tab (GET
// /item-variants), plus qty_on_hand and how many stores carry it.
function StockTab() {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: groups } = useApiList<{ id: string; code: string; name_en: string }>("/api/item-groups");

  const [filters, setFilters] = useState<StockFilters>(EMPTY_STOCK_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState<StockFilters>(EMPTY_STOCK_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<StockSortColumn>("itemCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [result, setResult] = useState<StockSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breakdownVariant, setBreakdownVariant] = useState<StockVariantRow | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!token || !companyId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    if (debouncedFilters.search) params.set("search", debouncedFilters.search);
    if (debouncedFilters.itemCode) params.set("itemCode", debouncedFilters.itemCode);
    if (debouncedFilters.color) params.set("color", debouncedFilters.color);
    if (debouncedFilters.size) params.set("size", debouncedFilters.size);
    if (debouncedFilters.barcode) params.set("barcode", debouncedFilters.barcode);
    if (debouncedFilters.groupId) params.set("groupId", debouncedFilters.groupId);
    if (debouncedFilters.storeId) params.set("storeId", debouncedFilters.storeId);
    if (debouncedFilters.belowReorderPoint) params.set("belowReorderPoint", "true");
    apiRequest<StockSearchResponse>(`/api/stock-balances/variants?${params.toString()}`, { token, companyId })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load stock");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, companyId, page, pageSize, sortBy, sortDir, debouncedFilters]);

  function updateFilter<K extends keyof StockFilters>(key: K, value: StockFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSort(col: StockSortColumn) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  function sortIndicator(col: StockSortColumn) {
    if (sortBy !== col) return null;
    return <span className="ms-1 text-slate-400 dark:text-slate-500">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const hasFilters = (Object.keys(filters) as Array<keyof StockFilters>).some((k) => filters[k]);
  const storeCount = stores?.length ?? 0;

  const thClass = "cursor-pointer select-none whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300";
  const filterInputClass = "w-full rounded border border-slate-200 dark:border-slate-700 px-1.5 py-1 text-xs focus:border-brand-400 focus:outline-none dark:bg-slate-900";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filters.search}
          onChange={(e) => updateFilter("search", e.target.value)}
          placeholder="Search item code, name, or variant code..."
          className="min-w-64 flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm focus:border-brand-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
        />
        <select
          value={filters.storeId}
          onChange={(e) => updateFilter("storeId", e.target.value)}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        >
          <option value="">All stores ({storeCount})</option>
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={filters.belowReorderPoint} onChange={(e) => updateFilter("belowReorderPoint", e.target.checked)} />
          Below reorder point
        </label>
        {hasFilters && (
          <button
            onClick={() => setFilters(EMPTY_STOCK_FILTERS)}
            className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Clear filters
          </button>
        )}
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {result ? `${result.total.toLocaleString()} variant${result.total === 1 ? "" : "s"}` : loading ? "Loading..." : ""}
        </span>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={thClass} onClick={() => toggleSort("itemCode")}>Item Code{sortIndicator("itemCode")}</th>
              <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
              <th className={thClass} onClick={() => toggleSort("variantCode")}>Variant Code{sortIndicator("variantCode")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Group</th>
              <th className={thClass} onClick={() => toggleSort("color")}>Color{sortIndicator("color")}</th>
              <th className={thClass} onClick={() => toggleSort("size")}>Size{sortIndicator("size")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Barcode</th>
              <th className={`${thClass} text-end`} onClick={() => toggleSort("qty")}>
                {filters.storeId ? "Qty at Store" : "Qty (All Stores)"}
                {sortIndicator("qty")}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500"># Stores</th>
              <th className="px-3 py-2" />
            </tr>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.itemCode} onChange={(e) => updateFilter("itemCode", e.target.value)} placeholder="Code" /></th>
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.groupId} onChange={(e) => updateFilter("groupId", e.target.value)}>
                  <option value="">All</option>
                  {groups?.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
                </select>
              </th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.color} onChange={(e) => updateFilter("color", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.size} onChange={(e) => updateFilter("size", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.barcode} onChange={(e) => updateFilter("barcode", e.target.value)} /></th>
              <th className="px-2 py-1.5" colSpan={3} />
            </tr>
          </thead>
          <tbody>
            {result?.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                  No variants match these filters.
                </td>
              </tr>
            )}
            {result?.rows.map((r) => {
              const qty = Number(r.qty_on_hand);
              return (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{r.item_code}</td>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100">{r.name_en}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">{r.variant_code}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.group_name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.color ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.size ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{r.primary_barcode ?? "—"}</td>
                  <td className={`px-3 py-2 text-end tabular-nums ${qty <= 0 ? "text-slate-300 dark:text-slate-600" : Number(r.reorder_point) > 0 && qty < Number(r.reorder_point) ? "font-medium text-amber-600 dark:text-amber-400" : "font-medium text-slate-900 dark:text-slate-100"}`}>
                    {qty.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.stores_in_stock}</td>
                  <td className="px-3 py-2">
                    {!filters.storeId && (
                      <button onClick={() => setBreakdownVariant(r)} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                        By store
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result && result.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Page {result.page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {breakdownVariant && <StoreBreakdownModal variant={breakdownVariant} onClose={() => setBreakdownVariant(null)} />}
    </div>
  );
}

export function NewTransferForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const variantOptions = useVariantOptions();

  const [sourceStoreId, setSourceStoreId] = useState("");
  const [destStoreId, setDestStoreId] = useState("");
  const [itemVariantId, setItemVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (sourceStoreId && sourceStoreId === destStoreId) {
      setError("Source and destination stores must be different.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/stock-transfers", {
        method: "POST",
        token,
        companyId,
        body: { sourceStoreId, destStoreId, itemVariantId, qty: Number(qty), reasonCode: reasonCode || undefined },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record transfer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From Store" required>
          <SelectInput required value={sourceStoreId} onChange={(e) => setSourceStoreId(e.target.value)}>
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="To Store" required>
          <SelectInput required value={destStoreId} onChange={(e) => setDestStoreId(e.target.value)}>
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Item Variant" required>
        <SelectInput required value={itemVariantId} onChange={(e) => setItemVariantId(e.target.value)}>
          <option value="">Select...</option>
          {variantOptions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" required>
          <TextInput type="number" min={0.001} step="0.001" required value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason">
          <TextInput value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        Effective immediately — two linked movements, the destination costed at exactly what the goods left the source at. No draft/post step.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Transfer Stock" />
    </form>
  );
}

function TransfersTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<Transfer>("/api/stock-transfers");

  const columns: Column<Transfer>[] = [
    { key: "date", header: "Date", render: (r) => new Date(r.movement_at).toLocaleString() },
    { key: "item", header: "Item", render: (r) => <span>{r.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({r.variant_code})</span></span> },
    { key: "from", header: "From", render: (r) => r.source_store_name },
    { key: "to", header: "To", render: (r) => r.dest_store_name },
    // stock_movements stores the outbound leg's qty/cost as negative (a
    // signed ledger) — shown as a magnitude here since From/To already
    // convey direction and a bare "-3" reads as an error, not data.
    { key: "qty", header: "Qty", render: (r) => Math.abs(Number(r.qty)).toLocaleString(), numeric: true },
    { key: "cost", header: "Value", render: (r) => Math.abs(Number(r.total_cost)).toFixed(2), numeric: true },
  ];

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.item_name_en} ${r.variant_code} ${r.source_store_name} ${r.dest_store_name}`}
        emptyIcon={ArrowLeftRight}
        emptyText="No transfers yet."
        searchPlaceholder="Search transfers..."
        actionLabel="New Transfer"
        onAction={() => navigate("/inventory/transfers/new", { state: { fromTab: "transfers" } })}
      />
    </>
  );
}

export function NewInventoryTransferForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const variantOptions = useVariantOptions();
  const barcodeMap = useBarcodeMap();

  const [sourceStoreId, setSourceStoreId] = useState("");
  const [destStoreId, setDestStoreId] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ itemVariantId: string; qty: string }>>([{ itemVariantId: "", qty: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scanMessage, setScanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function updateLine(index: number, patch: Partial<{ itemVariantId: string; qty: string }>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", qty: "1" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Unlike goods-receipt scanning, a transfer isn't matched against a fixed
  // set of expected lines -- scanning here just builds the line list up as
  // you go: a barcode you've already scanned bumps that line's qty by one,
  // a new one adds a line (filling the first empty row rather than always
  // appending, so starting with the default blank line doesn't leave a
  // stray empty row above the scanned ones).
  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const trimmed = scanValue.trim();
    if (!trimmed) return;
    setScanValue("");

    const found = barcodeMap.get(trimmed);
    if (!found) {
      setScanMessage({ type: "error", text: `Barcode "${trimmed}" is not recognized.` });
      return;
    }
    setLines((prev) => {
      const existingIndex = prev.findIndex((l) => l.itemVariantId === found.variantId);
      if (existingIndex >= 0) {
        const next = prev.map((l, i) => (i === existingIndex ? { ...l, qty: String(Number(l.qty || "0") + 1) } : l));
        setScanMessage({ type: "success", text: `${found.label}: ${next[existingIndex]!.qty}` });
        return next;
      }
      const emptyIndex = prev.findIndex((l) => !l.itemVariantId);
      setScanMessage({ type: "success", text: `${found.label}: 1` });
      if (emptyIndex >= 0) {
        return prev.map((l, i) => (i === emptyIndex ? { itemVariantId: found.variantId, qty: "1" } : l));
      }
      return [...prev, { itemVariantId: found.variantId, qty: "1" }];
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (sourceStoreId && sourceStoreId === destStoreId) {
      setError("Source and destination stores must be different.");
      return;
    }
    const validLines = lines.filter((l) => l.itemVariantId && Number(l.qty) > 0);
    if (validLines.length === 0) {
      setError("Add at least one line with an item and quantity.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/inventory-transfers", {
        method: "POST",
        token,
        companyId,
        body: {
          sourceStoreId,
          destStoreId,
          transferDate,
          notes: notes || undefined,
          lines: validLines.map((l) => ({ itemVariantId: l.itemVariantId, qty: Number(l.qty) })),
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create transfer order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From Store" required>
          <SelectInput required value={sourceStoreId} onChange={(e) => setSourceStoreId(e.target.value)}>
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="To Store" required>
          <SelectInput required value={destStoreId} onChange={(e) => setDestStoreId(e.target.value)}>
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Transfer Date" required>
          <TextInput type="date" required value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>

      <Field label="Scan to add">
        <input
          type="text"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={handleScan}
          placeholder="Scan barcode or UPC, then Enter..."
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </Field>
      {scanMessage && (
        <p className={`-mt-2 mb-2 text-xs ${scanMessage.type === "error" ? "text-red-600" : "text-emerald-600"}`}>{scanMessage.text}</p>
      )}

      <div className="mb-2 mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SelectInput value={line.itemVariantId} onChange={(e) => updateLine(i, { itemVariantId: e.target.value })}>
                <option value="">Select item...</option>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div className="w-24 flex-none">
              <TextInput type="number" min={0.001} step="0.001" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} />
            </div>
            <button
              type="button"
              onClick={() => removeLine(i)}
              disabled={lines.length === 1}
              className="flex-none rounded p-1.5 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-red-600 disabled:opacity-30"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addLine}
        className="mb-3 mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        <Plus size={13} /> Add line
      </button>

      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        Created as a draft — nothing moves until it's posted. Each line's destination is costed at exactly what the goods left the source at.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Draft" />
    </form>
  );
}

export function InventoryTransferDetailModal({
  transferId,
  onClose,
  onPosted,
}: {
  transferId: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<InventoryTransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<InventoryTransferDetail>(`/api/inventory-transfers/${transferId}`, { token, companyId }).then(setDetail);
  }, [transferId, token, companyId]);

  async function handlePost() {
    setError(null);
    setPosting(true);
    try {
      await apiRequest(`/api/inventory-transfers/${transferId}/post`, { method: "POST", token, companyId });
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post transfer");
    } finally {
      setPosting(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {detail.source_store_name_en} → {detail.dest_store_name_en} · {new Date(detail.transfer_date).toLocaleDateString()}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {detail.notes && <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{detail.notes}</p>}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 dark:border-slate-700 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-200">
              {line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code})</span>
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{Number(line.qty).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {detail.document_status === "draft" && (
        <button
          onClick={handlePost}
          disabled={posting}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {posting ? "Posting..." : "Post Transfer"}
        </button>
      )}
    </div>
  );
}

function TransferOrdersTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<InventoryTransferOrder>("/api/inventory-transfers");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("inventory.transfer.post");

  const columns: Column<InventoryTransferOrder>[] = [
    { key: "number", header: "IT #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "date", header: "Date", render: (r) => new Date(r.transfer_date).toLocaleDateString() },
    { key: "from", header: "From", render: (r) => r.source_store_name_en },
    { key: "to", header: "To", render: (r) => r.dest_store_name_en },
    { key: "lines", header: "Items", render: (r) => r.line_count, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/inventory-transfers/bulk-post", [...selected], { token, companyId }));
    setSelected(new Set());
    reload();
  }

  return (
    <>
      {bulkMessage && (
        <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">{bulkMessage}</p>
      )}
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.document_number} ${r.source_store_name_en} ${r.dest_store_name_en}`}
        emptyIcon={Truck}
        emptyText="No transfer orders yet."
        searchPlaceholder="Search transfer orders..."
        actionLabel="New Transfer Order"
        onAction={() => navigate("/inventory/transfer-orders/new", { state: { fromTab: "transfer-orders" } })}
        onRowClick={(r) => navigate(`/inventory/transfer-orders/${r.id}`, { state: { fromTab: "transfer-orders" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

export function NewStocktakeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: items } = useApiList<Item>("/api/items");
  const allVariants = useMemo(() => (items ?? []).flatMap((item) => item.variants.map((v) => ({ ...v, itemName: item.name_en }))), [items]);

  const [storeId, setStoreId] = useState("");
  const [stocktakeDate, setStocktakeDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Default to counting everything; users deselect what they're skipping.
    setSelected(new Set(allVariants.map((v) => v.id)));
  }, [allVariants]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one item to count.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/stocktakes", {
        method: "POST",
        token,
        companyId,
        body: { storeId, stocktakeDate, itemVariantIds: [...selected] },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create stocktake");
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
        <Field label="Stocktake Date" required>
          <TextInput type="date" required value={stocktakeDate} onChange={(e) => setStocktakeDate(e.target.value)} />
        </Field>
      </div>
      <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Items to count ({selected.size} selected)</div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 p-2">
        {allVariants.map((v) => (
          <label key={v.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
            {v.itemName} — {v.variant_code}
          </label>
        ))}
      </div>

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">Snapshots current system quantity now; enter counted quantities afterward from the list.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Start Stocktake" />
    </form>
  );
}

export function CountStocktakeForm({ stocktakeId, onClose, onPosted }: { stocktakeId: string; onClose: () => void; onPosted: () => void }) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const barcodeMap = useBarcodeMap();
  const [scanValue, setScanValue] = useState("");
  const [hasScanned, setHasScanned] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<StocktakeDetail>(`/api/stocktakes/${stocktakeId}`, { token, companyId }).then((d) => {
      setDetail(d);
      const init: Record<string, string> = {};
      for (const line of d.lines) init[line.id] = line.counted_qty ?? line.snapshot_qty;
      setCounts(init);
    });
  }, [stocktakeId, token, companyId]);

  // Same zero-then-count-up behavior as goods-receipt scanning: the
  // default counts assume nothing changed (counted = system qty), which is
  // exactly backwards once you're physically walking the aisle scanning
  // every unit -- so the first scan on this stocktake zeroes every line
  // and counts up from there. A barcode that isn't one of this stocktake's
  // lines is rejected rather than silently ignored, since a stocktake only
  // ever counts the specific items it was created against.
  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !detail) return;
    const trimmed = scanValue.trim();
    if (!trimmed) return;
    setScanValue("");

    const found = barcodeMap.get(trimmed);
    if (!found) {
      setScanMessage({ type: "error", text: `Barcode "${trimmed}" is not recognized.` });
      return;
    }
    const line = detail.lines.find((l) => l.item_variant_id === found.variantId);
    if (!line) {
      setScanMessage({ type: "error", text: `${found.label} is not part of this stocktake.` });
      return;
    }
    const base = hasScanned ? counts : Object.fromEntries(detail.lines.map((l) => [l.id, "0"]));
    const current = Number(base[line.id] ?? "0");
    setCounts({ ...base, [line.id]: String(current + 1) });
    setHasScanned(true);
    setScanMessage({ type: "success", text: `${found.label}: ${current + 1}` });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!detail) return;
    setSubmitting(true);
    try {
      for (const line of detail.lines) {
        await apiRequest(`/api/stocktakes/${stocktakeId}/lines/${line.id}/count`, {
          method: "POST",
          token,
          companyId,
          body: { countedQty: Number(counts[line.id] ?? line.snapshot_qty) },
        });
      }
      await apiRequest(`/api/stocktakes/${stocktakeId}/post`, { method: "POST", token, companyId });
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post stocktake");
    } finally {
      setSubmitting(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Scan to count">
        <input
          type="text"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={handleScan}
          placeholder="Scan barcode, then Enter..."
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </Field>
      {scanMessage && (
        <p className={`-mt-2 mb-2 text-xs ${scanMessage.type === "error" ? "text-red-600" : "text-emerald-600"}`}>{scanMessage.text}</p>
      )}
      <p className="-mt-1 mb-3 text-xs text-slate-400 dark:text-slate-500">The first scan resets every count below to zero and counts up as you scan.</p>
      <div className="mb-3 space-y-2">
        {detail.lines.map((line) => {
          const counted = Number(counts[line.id] ?? 0);
          const variance = counted - Number(line.snapshot_qty);
          return (
            <div key={line.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-900 dark:text-slate-100">{line.item_name_en}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">
                  {line.variant_code} · system qty {Number(line.snapshot_qty).toLocaleString()}
                </div>
              </div>
              <div className="w-24 flex-none">
                <TextInput
                  type="number"
                  min={0}
                  step="0.001"
                  value={counts[line.id] ?? ""}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                />
              </div>
              {variance !== 0 && (
                <span className={`w-16 flex-none text-end text-xs font-medium ${variance > 0 ? "text-green-600" : "text-red-600"}`}>
                  {variance > 0 ? "+" : ""}
                  {variance}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        Posting books any variance as stock movements plus a journal against Inventory Adjustments (5110).
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Save Counts & Post" />
    </form>
  );
}

function AdjustmentsTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<Stocktake>("/api/stocktakes");

  const columns: Column<Stocktake>[] = [
    { key: "number", header: "ST #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.stocktake_date).toLocaleDateString() },
    { key: "lines", header: "Items", render: (r) => r.line_count, numeric: true },
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
        getSearchText={(r) => `${r.document_number} ${r.store_name_en}`}
        emptyIcon={ClipboardList}
        emptyText="No stocktakes yet."
        searchPlaceholder="Search stocktakes..."
        actionLabel="New Stocktake"
        onAction={() => navigate("/inventory/stocktakes/new", { state: { fromTab: "adjustments" } })}
        onRowClick={(r) => {
          if (r.document_status === "draft") navigate(`/inventory/stocktakes/${r.id}/count`, { state: { fromTab: "adjustments" } });
        }}
      />
    </>
  );
}

export default function Inventory() {
  const { t } = useTranslation();
  const location = useLocation();
  const tabs = useMemo(
    () => [
      { key: "items", label: "Items", content: <ItemsSection /> },
      { key: "stock", label: "Stock", content: <StockTab /> },
      { key: "transfers", label: "Transfers", content: <TransfersTab /> },
      { key: "transfer-orders", label: "Transfer Orders", content: <TransferOrdersTab /> },
      { key: "adjustments", label: "Adjustments", content: <AdjustmentsTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">{t("nav.inventory")}</h1>
      <Tabs tabs={tabs} initialActive={(location.state as { fromTab?: string } | null)?.fromTab} hideHeader />
    </div>
  );
}
