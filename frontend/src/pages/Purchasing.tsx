import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingCart, Truck, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
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

interface Store {
  id: string;
  store_code: string;
  name_en: string;
}

interface FiscalPeriod {
  id: string;
  period_number: number;
  year_name: string;
  status: string;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
}

interface Item {
  name_en: string;
  variants: ItemVariant[];
}

interface PoLineDraft {
  itemVariantId: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
  priceIncludesVat: boolean;
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

function NewPurchaseOrderForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: suppliers } = useApiList<Supplier>("/api/suppliers");
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const variantOptions = useVariantOptions();

  const [supplierId, setSupplierId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<PoLineDraft[]>([
    { itemVariantId: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totalGross = lines.reduce((s, l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const vat = Number(l.vatRate) || 0;
    const net = qty * price;
    return s + (l.priceIncludesVat ? net : net * (1 + vat / 100));
  }, 0);

  function updateLine(index: number, patch: Partial<PoLineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/purchase-orders", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          supplierId,
          orderDate,
          expectedDate: expectedDate || null,
          fiscalPeriodId,
          lines: lines
            .filter((l) => l.itemVariantId)
            .map((l) => ({
              itemVariantId: l.itemVariantId,
              qty: Number(l.qty),
              unitPrice: Number(l.unitPrice),
              discountAmount: 0,
              vatRate: Number(l.vatRate),
              priceIncludesVat: l.priceIncludesVat,
            })),
        },
      });
      await apiRequest(`/api/purchase-orders/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" required>
          <SelectInput required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full min-w-0">
            <option value="">Select...</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Store" required>
          <SelectInput required value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-full min-w-0">
            <option value="">Select...</option>
            {stores?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order Date" required>
          <TextInput type="date" required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
        <Field label="Expected Date">
          <TextInput type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
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

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-slate-200 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SelectInput value={line.itemVariantId} onChange={(e) => updateLine(i, { itemVariantId: e.target.value })} className="min-w-0 flex-1">
                <option value="">Item variant...</option>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </SelectInput>
              <button type="button" onClick={() => removeLine(i)} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex gap-1.5">
              <TextInput type="number" min={0.001} step="0.001" placeholder="Qty" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="min-w-0 flex-1" />
              <TextInput type="number" min={0} step="0.01" placeholder="Unit Price" value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} className="min-w-0 flex-1" />
              <div className="w-20 flex-none">
                <TextInput type="number" min={0} step="0.01" placeholder="VAT %" value={line.vatRate} onChange={(e) => updateLine(i, { vatRate: e.target.value })} />
              </div>
            </div>
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={line.priceIncludesVat} onChange={(e) => updateLine(i, { priceIncludesVat: e.target.checked })} />
              Price includes VAT
            </label>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <Plus size={14} /> Add line
      </button>

      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
        Estimated Total: {totalGross.toFixed(2)}
      </div>

      <p className="mb-3 mt-2 text-xs text-slate-400">
        Purchase orders don't post a GL journal — they're a commitment, not a financial transaction. Posting here approves and locks it for receiving.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Approve PO" />
    </form>
  );
}

function PurchaseOrdersTab() {
  const { i18n } = useTranslation();
  const { data, error, reload } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const [showNew, setShowNew] = useState(false);

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
    <>
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
        actionLabel="New Purchase Order"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Purchase Order" onClose={() => setShowNew(false)}>
          <NewPurchaseOrderForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
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
