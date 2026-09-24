import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Warehouse, ArrowLeftRight, ClipboardList, Truck, Plus, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface Store {
  id: string;
  store_code: string;
  name_en: string;
  name_ar: string;
}

interface StockBalance {
  item_variant_id: string;
  qty_on_hand: string;
  avg_unit_cost: string;
  last_movement_at: string | null;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
}

interface Item {
  item_code: string;
  name_en: string;
  name_ar: string;
  variants: ItemVariant[];
}

interface StockRow extends StockBalance {
  itemCode: string;
  itemName: string;
  variantCode: string;
  variantDetail: string;
}

interface FiscalPeriod {
  id: string;
  period_number: number;
  year_name: string;
  status: string;
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

function StockTab() {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: items } = useApiList<Item>("/api/items");
  const [storeId, setStoreId] = useState<string>("");
  const [balances, setBalances] = useState<StockBalance[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    if (stores && stores.length > 0 && !storeId) setStoreId(stores[0]!.id);
  }, [stores, storeId]);

  useEffect(() => {
    if (!token || !companyId || !storeId) return;
    setBalances(null);
    apiRequest<{ asOf: string; balances: StockBalance[] }>(`/api/stock-balances?storeId=${storeId}`, { token, companyId }).then(
      (r) => {
        setBalances(r.balances);
        setAsOf(r.asOf);
      },
    );
  }, [token, companyId, storeId]);

  const variantIndex = useMemo(() => {
    const map = new Map<string, { itemCode: string; itemName: string; variantCode: string; variantDetail: string }>();
    for (const item of items ?? []) {
      for (const v of item.variants) {
        const detail = [v.color, v.size].filter(Boolean).join(" / ");
        map.set(v.id, {
          itemCode: item.item_code,
          itemName: i18n.language.startsWith("ar") ? item.name_ar : item.name_en,
          variantCode: v.variant_code,
          variantDetail: detail,
        });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, i18n.language]);

  const rows: StockRow[] | null =
    balances?.map((b) => {
      const info = variantIndex.get(b.item_variant_id);
      return {
        ...b,
        itemCode: info?.itemCode ?? "—",
        itemName: info?.itemName ?? "Unknown item",
        variantCode: info?.variantCode ?? "—",
        variantDetail: info?.variantDetail ?? "",
      };
    }) ?? null;

  const columns: Column<StockRow>[] = [
    { key: "code", header: "Item", render: (r) => <span className="font-mono text-xs text-slate-500">{r.itemCode}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.itemName}</div>
          {r.variantDetail && <div className="text-xs text-slate-400">{r.variantDetail}</div>}
        </div>
      ),
    },
    { key: "qty", header: "Qty on Hand", render: (r) => Number(r.qty_on_hand).toLocaleString(), numeric: true },
    { key: "cost", header: "Avg Unit Cost", render: (r) => Number(r.avg_unit_cost).toFixed(2), numeric: true },
  ];

  return (
    <ListPage
      title=""
      subtitle={asOf ? `As of ${new Date(asOf).toLocaleString()}` : undefined}
      data={rows}
      error={null}
      columns={columns}
      getRowKey={(r) => r.item_variant_id}
      getSearchText={(r) => `${r.itemCode} ${r.itemName} ${r.variantCode}`}
      emptyIcon={Warehouse}
      emptyText="No stock at this store."
      searchPlaceholder="Search stock..."
      toolbarExtra={
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        >
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {i18n.language.startsWith("ar") ? s.name_ar : s.name_en}
            </option>
          ))}
        </select>
      }
    />
  );
}

function NewTransferForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
      <p className="mb-3 text-xs text-slate-400">
        Effective immediately — two linked movements, the destination costed at exactly what the goods left the source at. No draft/post step.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Transfer Stock" />
    </form>
  );
}

function TransfersTab() {
  const { data, error, reload } = useApiList<Transfer>("/api/stock-transfers");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<Transfer>[] = [
    { key: "date", header: "Date", render: (r) => new Date(r.movement_at).toLocaleString() },
    { key: "item", header: "Item", render: (r) => <span>{r.item_name_en} <span className="text-xs text-slate-400">({r.variant_code})</span></span> },
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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Stock Transfer" onClose={() => setShowNew(false)}>
          <NewTransferForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function NewInventoryTransferForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const variantOptions = useVariantOptions();
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];

  const [sourceStoreId, setSourceStoreId] = useState("");
  const [destStoreId, setDestStoreId] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ itemVariantId: string; qty: string }>>([{ itemVariantId: "", qty: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<{ itemVariantId: string; qty: string }>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", qty: "1" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
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
          fiscalPeriodId,
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
        <Field label="Fiscal Period" required>
          <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
            <option value="">Select...</option>
            {openPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.year_name} — P{p.period_number}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Notes">
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>

      <div className="mb-2 mt-3 text-sm font-medium text-slate-700">Lines</div>
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
              className="flex-none rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
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

      <p className="mb-3 text-xs text-slate-400">
        Created as a draft — nothing moves until it's posted. Each line's destination is costed at exactly what the goods left the source at.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Draft" />
    </form>
  );
}

function InventoryTransferDetailModal({
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

  if (!detail) return <p className="text-sm text-slate-400">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{detail.document_number}</div>
          <div className="text-sm text-slate-700">
            {detail.source_store_name_en} → {detail.dest_store_name_en} · {new Date(detail.transfer_date).toLocaleDateString()}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {detail.notes && <p className="mb-3 text-xs text-slate-500">{detail.notes}</p>}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">
              {line.item_name_en} <span className="text-xs text-slate-400">({line.variant_code})</span>
            </span>
            <span className="font-medium text-slate-900">{Number(line.qty).toLocaleString()}</span>
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
  const { data, error, reload } = useApiList<InventoryTransferOrder>("/api/inventory-transfers");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<InventoryTransferOrder>[] = [
    { key: "number", header: "IT #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "date", header: "Date", render: (r) => new Date(r.transfer_date).toLocaleDateString() },
    { key: "from", header: "From", render: (r) => r.source_store_name_en },
    { key: "to", header: "To", render: (r) => r.dest_store_name_en },
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
        getSearchText={(r) => `${r.document_number} ${r.source_store_name_en} ${r.dest_store_name_en}`}
        emptyIcon={Truck}
        emptyText="No transfer orders yet."
        searchPlaceholder="Search transfer orders..."
        actionLabel="New Transfer Order"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setOpenId(r.id)}
      />
      {showNew && (
        <Modal title="New Inventory Transfer" onClose={() => setShowNew(false)}>
          <NewInventoryTransferForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {openId && (
        <Modal title="Inventory Transfer" onClose={() => setOpenId(null)}>
          <InventoryTransferDetailModal transferId={openId} onClose={() => setOpenId(null)} onPosted={reload} />
        </Modal>
      )}
    </>
  );
}

function NewStocktakeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: items } = useApiList<Item>("/api/items");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const allVariants = useMemo(() => (items ?? []).flatMap((item) => item.variants.map((v) => ({ ...v, itemName: item.name_en }))), [items]);

  const [storeId, setStoreId] = useState("");
  const [stocktakeDate, setStocktakeDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
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
        body: { storeId, stocktakeDate, fiscalPeriodId, itemVariantIds: [...selected] },
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
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — P{p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Items to count ({selected.size} selected)</div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {allVariants.map((v) => (
          <label key={v.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
            {v.itemName} — {v.variant_code}
          </label>
        ))}
      </div>

      <p className="mb-3 mt-3 text-xs text-slate-400">Snapshots current system quantity now; enter counted quantities afterward from the list.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Start Stocktake" />
    </form>
  );
}

function CountStocktakeForm({ stocktakeId, onClose, onPosted }: { stocktakeId: string; onClose: () => void; onPosted: () => void }) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<StocktakeDetail>(`/api/stocktakes/${stocktakeId}`, { token, companyId }).then((d) => {
      setDetail(d);
      const init: Record<string, string> = {};
      for (const line of d.lines) init[line.id] = line.counted_qty ?? line.snapshot_qty;
      setCounts(init);
    });
  }, [stocktakeId, token, companyId]);

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

  if (!detail) return <p className="text-sm text-slate-400">Loading...</p>;

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 space-y-2">
        {detail.lines.map((line) => {
          const counted = Number(counts[line.id] ?? 0);
          const variance = counted - Number(line.snapshot_qty);
          return (
            <div key={line.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-900">{line.item_name_en}</div>
                <div className="text-xs text-slate-400">
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
      <p className="mb-3 text-xs text-slate-400">
        Posting books any variance as stock movements plus a journal against Inventory Adjustments (5110).
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Save Counts & Post" />
    </form>
  );
}

function AdjustmentsTab() {
  const { data, error, reload } = useApiList<Stocktake>("/api/stocktakes");
  const [showNew, setShowNew] = useState(false);
  const [countingId, setCountingId] = useState<string | null>(null);

  const columns: Column<Stocktake>[] = [
    { key: "number", header: "ST #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
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
        onAction={() => setShowNew(true)}
        onRowClick={(r) => {
          if (r.document_status === "draft") setCountingId(r.id);
        }}
      />
      {showNew && (
        <Modal title="New Stocktake" onClose={() => setShowNew(false)}>
          <NewStocktakeForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {countingId && (
        <Modal title="Count & Post Stocktake" onClose={() => setCountingId(null)}>
          <CountStocktakeForm stocktakeId={countingId} onClose={() => setCountingId(null)} onPosted={reload} />
        </Modal>
      )}
    </>
  );
}

export default function Inventory() {
  const { t } = useTranslation();
  const tabs = useMemo(
    () => [
      { key: "stock", label: "Stock", content: <StockTab /> },
      { key: "transfers", label: "Transfers", content: <TransfersTab /> },
      { key: "transfer-orders", label: "Transfer Orders", content: <TransferOrdersTab /> },
      { key: "adjustments", label: "Adjustments", content: <AdjustmentsTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.inventory")}</h1>
      <Tabs tabs={tabs} />
    </div>
  );
}
