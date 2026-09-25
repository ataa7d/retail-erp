import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingCart, Truck, Plus, Trash2, PackageCheck, ReceiptText, ClipboardList } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import ExchangeRateField from "../components/ExchangeRateField";
import { useBaseCurrency, formatMoney } from "../lib/currency";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface PurchaseOrder {
  id: string;
  document_number: string;
  order_date: string;
  expected_date: string | null;
  document_status: string;
  gross_amount: string;
  currency: string;
  exchange_rate: string;
  supplier_name_en: string;
  supplier_name_ar: string;
}

interface Supplier {
  id: string;
  supplier_code: string;
  name_en: string;
  name_ar: string;
  cr_number: string | null;
  vat_registration_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
  lead_time_days: number | null;
  currency: string;
  is_active: boolean;
}

interface SupplierItemPrice {
  id: string;
  item_variant_id: string;
  unit_cost: string;
  currency: string;
  lead_time_days: number | null;
  moq: string | null;
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

interface PoLine {
  id: string;
  item_variant_id: string;
  qty: string;
  received_qty: string;
  unit_price: string;
  variant_code: string;
  item_name_en: string;
}

interface PoDetail {
  id: string;
  store_id: string;
  supplier_id: string;
  document_number: string;
  order_date: string;
  document_status: string;
  gross_amount: string;
  currency: string;
  purchase_requisition_id: string | null;
  supplier_name_en: string;
  supplier_name_ar: string;
  lines: PoLine[];
}

interface GoodsReceipt {
  id: string;
  document_number: string;
  receipt_date: string;
  document_status: string;
  purchase_order_id: string;
  po_document_number: string;
  currency: string;
  exchange_rate: string;
  supplier_name_en: string;
  supplier_name_ar: string;
}

interface GrLine {
  id: string;
  item_variant_id: string;
  qty_received: string;
  base_unit_cost: string; // merchandise cost in the PO's own currency -- what the supplier invoice price is matched against
  unit_cost: string; // base currency, merchandise + landed cost -- inventory valuation, not for invoice matching
  variant_code: string;
  item_name_en: string;
}

interface GrDetail {
  id: string;
  supplier_id: string;
  purchase_order_id: string;
  document_number: string;
  currency: string;
  lines: GrLine[];
}

interface SupplierInvoice {
  id: string;
  document_number: string;
  supplier_invoice_number: string;
  invoice_date: string;
  document_status: string;
  gross_amount: string;
  currency: string;
  exchange_rate: string;
  base_gross_amount: string | null;
  supplier_name_en: string;
  supplier_name_ar: string;
}

interface PurchaseRequisition {
  id: string;
  document_number: string;
  requisition_date: string;
  needed_by_date: string | null;
  document_status: string;
  rejection_reason: string | null;
  store_name_en: string;
  requested_by_email: string | null;
  line_count: string;
}

interface RequisitionLine {
  id: string;
  item_variant_id: string;
  qty: string;
  notes: string | null;
  variant_code: string;
  item_name_en: string;
}

interface RequisitionDetail extends PurchaseRequisition {
  store_id: string;
  decided_by_email: string | null;
  lines: RequisitionLine[];
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
  const baseCurrency = useBaseCurrency();
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
  const [currency, setCurrency] = useState(baseCurrency);
  const [exchangeRate, setExchangeRate] = useState("1");
  const [lines, setLines] = useState<PoLineDraft[]>([
    { itemVariantId: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [supplierPrices, setSupplierPrices] = useState<SupplierItemPrice[] | null>(null);

  useEffect(() => {
    if (!supplierId || !token || !companyId) {
      setSupplierPrices(null);
      return;
    }
    apiRequest<SupplierItemPrice[]>(`/api/supplier-item-prices?supplierId=${supplierId}`, { token, companyId }).then(setSupplierPrices);
  }, [supplierId, token, companyId]);

  function selectSupplier(id: string) {
    setSupplierId(id);
    // A supplier's invoicing currency is a strong default, but the order
    // can still be placed in any currency (some overseas suppliers will
    // still quote in SAR on request) -- so it's a suggestion, not a lock.
    const supplier = suppliers?.find((s) => s.id === id);
    if (supplier) setCurrency(supplier.currency);
  }

  const totalGross = lines.reduce((s, l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const vat = Number(l.vatRate) || 0;
    const net = qty * price;
    return s + (l.priceIncludesVat ? net : net * (1 + vat / 100));
  }, 0);

  function updateLine(index: number, patch: Partial<PoLineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        // Auto-fill from the supplier's cost catalog when the item changes,
        // same as the sales-side price-list auto-fill -- the common case
        // (re-ordering at the supplier's last quoted/last-paid cost) needs
        // no typing. Cost catalog entries are always net of VAT.
        if (patch.itemVariantId !== undefined) {
          const priced = supplierPrices?.find((sp) => sp.item_variant_id === patch.itemVariantId);
          if (priced) {
            next.unitPrice = priced.unit_cost;
            next.priceIncludesVat = false;
          }
        }
        return next;
      }),
    );
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
          currency,
          exchangeRate: currency === baseCurrency ? null : Number(exchangeRate),
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
          <SelectInput required value={supplierId} onChange={(e) => selectSupplier(e.target.value)} className="w-full min-w-0">
            <option value="">Select...</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en} ({s.currency})
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" required>
          <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </Field>
        <ExchangeRateField currency={currency} date={orderDate} value={exchangeRate} onChange={setExchangeRate} />
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
        Estimated Total: {formatMoney(totalGross, currency)}
      </div>

      <p className="mb-3 mt-2 text-xs text-slate-400">
        Purchase orders don't post a GL journal — they're a commitment, not a financial transaction. Posting here approves and locks it for receiving.
        {currency !== baseCurrency && " Lines above are priced in the order's own currency."}
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Approve PO" />
    </form>
  );
}

function NewGoodsReceiptForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: purchaseOrders } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const postedPOs = purchaseOrders?.filter((po) => po.document_status === "posted") ?? [];

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [poDetail, setPoDetail] = useState<PoDetail | null>(null);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [exchangeRate, setExchangeRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseCurrency = useBaseCurrency();

  useEffect(() => {
    if (!purchaseOrderId || !token || !companyId) {
      setPoDetail(null);
      return;
    }
    apiRequest<PoDetail>(`/api/purchase-orders/${purchaseOrderId}`, { token, companyId }).then((detail) => {
      setPoDetail(detail);
      const init: Record<string, string> = {};
      for (const line of detail.lines) {
        const remaining = Number(line.qty) - Number(line.received_qty);
        if (remaining > 0) init[line.id] = String(remaining);
      }
      setQtyByLine(init);
    });
  }, [purchaseOrderId, token, companyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!poDetail) return;
    setSubmitting(true);
    try {
      const lines = poDetail.lines
        .filter((l) => Number(qtyByLine[l.id]) > 0)
        .map((l) => ({ purchaseOrderLineId: l.id, itemVariantId: l.item_variant_id, qtyReceived: Number(qtyByLine[l.id]) }));
      if (lines.length === 0) throw new Error("Enter a received quantity for at least one line.");

      const created = await apiRequest<{ id: string }>("/api/goods-receipts", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId: poDetail.store_id,
          purchaseOrderId: poDetail.id,
          supplierId: poDetail.supplier_id,
          receiptDate,
          fiscalPeriodId,
          lines,
          exchangeRate: poDetail.currency === baseCurrency ? null : Number(exchangeRate),
        },
      });
      await apiRequest(`/api/goods-receipts/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to create goods receipt");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Purchase Order" required>
        <SelectInput required value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
          <option value="">Select a posted PO...</option>
          {postedPOs.map((po) => (
            <option key={po.id} value={po.id}>
              {po.document_number} — {po.supplier_name_en} ({po.currency})
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Receipt Date" required>
          <TextInput type="date" required value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
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
      {poDetail && (
        <ExchangeRateField currency={poDetail.currency} date={receiptDate} value={exchangeRate} onChange={setExchangeRate} />
      )}

      {poDetail && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Lines to receive</div>
          <div className="space-y-2">
            {poDetail.lines.map((line) => {
              const remaining = Number(line.qty) - Number(line.received_qty);
              return (
                <div key={line.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-900">{line.item_name_en}</div>
                    <div className="text-xs text-slate-400">
                      {line.variant_code} · ordered {line.qty}, received {line.received_qty}
                    </div>
                  </div>
                  <div className="w-24 flex-none">
                    <TextInput
                      type="number"
                      min={0}
                      max={remaining}
                      step="0.001"
                      value={qtyByLine[line.id] ?? ""}
                      onChange={(e) => setQtyByLine((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      disabled={remaining <= 0}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mb-3 mt-3 text-xs text-slate-400">
        Accrues Dr Inventory / Cr GRNI at the PO's price. Landed cost charges (freight, customs) aren't in this form yet.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Receive & Post" />
    </form>
  );
}

function NewSupplierInvoiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: purchaseOrders } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const { data: goodsReceipts } = useApiList<GoodsReceipt>("/api/goods-receipts");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const postedPOs = purchaseOrders?.filter((po) => po.document_status === "posted") ?? [];

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const receiptsForPo = (goodsReceipts ?? []).filter((gr) => gr.purchase_order_id === purchaseOrderId && gr.document_status === "posted");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [grDetail, setGrDetail] = useState<GrDetail | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [lineData, setLineData] = useState<Record<string, { qty: string; unitPrice: string; vatRate: string; priceIncludesVat: boolean }>>({});
  const [exchangeRate, setExchangeRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseCurrency = useBaseCurrency();
  const selectedPo = postedPOs.find((po) => po.id === purchaseOrderId) ?? null;

  useEffect(() => {
    setGoodsReceiptId("");
    setGrDetail(null);
  }, [purchaseOrderId]);

  useEffect(() => {
    if (!goodsReceiptId || !token || !companyId) {
      setGrDetail(null);
      return;
    }
    apiRequest<GrDetail>(`/api/goods-receipts/${goodsReceiptId}`, { token, companyId }).then((detail) => {
      setGrDetail(detail);
      const init: Record<string, { qty: string; unitPrice: string; vatRate: string; priceIncludesVat: boolean }> = {};
      for (const line of detail.lines) {
        init[line.id] = { qty: line.qty_received, unitPrice: line.base_unit_cost, vatRate: "15", priceIncludesVat: false };
      }
      setLineData(init);
    });
  }, [goodsReceiptId, token, companyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!grDetail) return;
    setSubmitting(true);
    try {
      const lines = grDetail.lines.map((l) => ({
        goodsReceiptLineId: l.id,
        itemVariantId: l.item_variant_id,
        qty: Number(lineData[l.id]?.qty ?? l.qty_received),
        unitPrice: Number(lineData[l.id]?.unitPrice ?? l.unit_cost),
        discountAmount: 0,
        vatRate: Number(lineData[l.id]?.vatRate ?? 15),
        priceIncludesVat: lineData[l.id]?.priceIncludesVat ?? false,
      }));

      const created = await apiRequest<{ id: string }>("/api/supplier-invoices", {
        method: "POST",
        token,
        companyId,
        body: {
          supplierId: grDetail.supplier_id,
          purchaseOrderId,
          supplierInvoiceNumber,
          invoiceDate,
          fiscalPeriodId,
          lines,
          exchangeRate: (selectedPo?.currency ?? baseCurrency) === baseCurrency ? null : Number(exchangeRate),
        },
      });
      await apiRequest(`/api/supplier-invoices/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create supplier invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Purchase Order" required>
        <SelectInput required value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)}>
          <option value="">Select a posted PO...</option>
          {postedPOs.map((po) => (
            <option key={po.id} value={po.id}>
              {po.document_number} — {po.supplier_name_en} ({po.currency})
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Goods Receipt" required>
        <SelectInput required value={goodsReceiptId} onChange={(e) => setGoodsReceiptId(e.target.value)} disabled={!purchaseOrderId}>
          <option value="">Select a goods receipt...</option>
          {receiptsForPo.map((gr) => (
            <option key={gr.id} value={gr.id}>
              {gr.document_number} — {new Date(gr.receipt_date).toLocaleDateString()}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier Invoice #" required>
          <TextInput required value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} placeholder="Supplier's own reference" />
        </Field>
        <Field label="Invoice Date" required>
          <TextInput type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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
      {selectedPo && (
        <ExchangeRateField currency={selectedPo.currency} date={invoiceDate} value={exchangeRate} onChange={setExchangeRate} />
      )}

      {grDetail && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700">
            Lines {selectedPo && selectedPo.currency !== baseCurrency && <span className="font-normal text-slate-400">(priced in {selectedPo.currency})</span>}
          </div>
          <div className="space-y-2">
            {grDetail.lines.map((line) => (
              <div key={line.id} className="rounded-md border border-slate-200 p-2">
                <div className="mb-1.5 text-sm text-slate-900">{line.item_name_en} <span className="text-xs text-slate-400">({line.variant_code})</span></div>
                <div className="flex gap-1.5">
                  <TextInput
                    type="number"
                    min={0}
                    step="0.001"
                    placeholder="Qty"
                    value={lineData[line.id]?.qty ?? ""}
                    onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, qty: e.target.value } }))}
                    className="min-w-0 flex-1"
                  />
                  <TextInput
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Unit Price"
                    value={lineData[line.id]?.unitPrice ?? ""}
                    onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, unitPrice: e.target.value } }))}
                    className="min-w-0 flex-1"
                  />
                  <div className="w-20 flex-none">
                    <TextInput
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="VAT %"
                      value={lineData[line.id]?.vatRate ?? ""}
                      onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, vatRate: e.target.value } }))}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mb-3 mt-3 text-xs text-slate-400">
        Clears GRNI, books Purchase Price Variance if the price differs from the receipt, claims input VAT, credits Accounts Payable.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Invoice" />
    </form>
  );
}

function GoodsReceiptsTab() {
  const { data, error, reload } = useApiList<GoodsReceipt>("/api/goods-receipts");
  const [showNew, setShowNew] = useState(false);
  const baseCurrency = useBaseCurrency();

  const columns: Column<GoodsReceipt>[] = [
    { key: "number", header: "GR #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "po", header: "PO #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.po_document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Receipt Date", render: (r) => new Date(r.receipt_date).toLocaleDateString() },
    { key: "currency", header: "Currency", render: (r) => (r.currency !== baseCurrency ? `${r.currency} @ ${Number(r.exchange_rate).toFixed(4)}` : "—") },
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
        getSearchText={(r) => `${r.document_number} ${r.po_document_number} ${r.supplier_name_en}`}
        emptyIcon={PackageCheck}
        emptyText="No goods receipts yet."
        searchPlaceholder="Search goods receipts..."
        actionLabel="New Goods Receipt"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Goods Receipt" onClose={() => setShowNew(false)}>
          <NewGoodsReceiptForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function SupplierInvoicesTab() {
  const { data, error, reload } = useApiList<SupplierInvoice>("/api/supplier-invoices");
  const [showNew, setShowNew] = useState(false);
  const baseCurrency = useBaseCurrency();

  const columns: Column<SupplierInvoice>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "supplierRef", header: "Supplier Ref", render: (r) => r.supplier_invoice_number },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Invoice Date", render: (r) => new Date(r.invoice_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => formatMoney(r.gross_amount, r.currency), numeric: true },
    {
      key: "base",
      header: `${baseCurrency} Total`,
      render: (r) => (r.currency !== baseCurrency && r.base_gross_amount ? formatMoney(r.base_gross_amount) : "—"),
      numeric: true,
    },
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
        getSearchText={(r) => `${r.document_number} ${r.supplier_invoice_number} ${r.supplier_name_en}`}
        emptyIcon={ReceiptText}
        emptyText="No supplier invoices yet."
        searchPlaceholder="Search supplier invoices..."
        actionLabel="New Supplier Invoice"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Supplier Invoice" onClose={() => setShowNew(false)}>
          <NewSupplierInvoiceForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function NewRequisitionForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const variantOptions = useVariantOptions();

  const [storeId, setStoreId] = useState("");
  const [requisitionDate, setRequisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [neededByDate, setNeededByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ itemVariantId: string; qty: string; notes: string }>>([
    { itemVariantId: "", qty: "1", notes: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<{ itemVariantId: string; qty: string; notes: string }>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", qty: "1", notes: "" }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validLines = lines.filter((l) => l.itemVariantId && Number(l.qty) > 0);
    if (validLines.length === 0) {
      setError("Add at least one line with an item and quantity.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/purchase-requisitions", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          requisitionDate,
          neededByDate: neededByDate || null,
          notes: notes || undefined,
          lines: validLines.map((l) => ({ itemVariantId: l.itemVariantId, qty: Number(l.qty), notes: l.notes || undefined })),
        },
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
      <Field label="Needed By">
        <TextInput type="date" value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} />
      </Field>
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
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mb-3 mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
        <Plus size={13} /> Add line
      </button>

      <p className="mb-3 text-xs text-slate-400">
        Submitted immediately for approval — no separate draft step. Someone else (not you) will need to approve it before it can become a purchase order.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Submit for Approval" />
    </form>
  );
}

function ConvertRequisitionForm({ requisition, onClose, onConverted }: { requisition: RequisitionDetail; onClose: () => void; onConverted: () => void }) {
  const { token, companyId } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { data: suppliers } = useApiList<Supplier>("/api/suppliers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];

  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [lineData, setLineData] = useState<Record<string, { unitPrice: string; vatRate: string; priceIncludesVat: boolean }>>(
    Object.fromEntries(requisition.lines.map((l) => [l.id, { unitPrice: "0", vatRate: "15", priceIncludesVat: false }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/purchase-requisitions/${requisition.id}/convert`, {
        method: "POST",
        token,
        companyId,
        body: {
          storeId: requisition.store_id,
          supplierId,
          orderDate,
          expectedDate: expectedDate || null,
          fiscalPeriodId,
          lines: requisition.lines.map((l) => ({
            requisitionLineId: l.id,
            itemVariantId: l.item_variant_id,
            qty: Number(l.qty),
            unitPrice: Number(lineData[l.id]?.unitPrice ?? 0),
            discountAmount: 0,
            vatRate: Number(lineData[l.id]?.vatRate ?? 15),
            priceIncludesVat: lineData[l.id]?.priceIncludesVat ?? false,
          })),
        },
      });
      onConverted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to convert to purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" required>
          <SelectInput required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select...</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en} ({s.currency})
              </option>
            ))}
          </SelectInput>
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
        <Field label="Order Date" required>
          <TextInput type="date" required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
        <Field label="Expected Date">
          <TextInput type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
      </div>

      <div className="mb-2 mt-3 text-sm font-medium text-slate-700">Set pricing per line</div>
      <div className="space-y-2">
        {requisition.lines.map((line) => (
          <div key={line.id} className="rounded-md border border-slate-200 p-2">
            <div className="mb-1.5 text-sm text-slate-900">
              {line.item_name_en} <span className="text-xs text-slate-400">({line.variant_code}) · qty {Number(line.qty).toLocaleString()}</span>
            </div>
            <div className="flex gap-1.5">
              <TextInput
                type="number"
                min={0}
                step="0.01"
                placeholder="Unit Price"
                value={lineData[line.id]?.unitPrice ?? ""}
                onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, unitPrice: e.target.value } }))}
                className="min-w-0 flex-1"
              />
              <div className="w-20 flex-none">
                <TextInput
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="VAT %"
                  value={lineData[line.id]?.vatRate ?? ""}
                  onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, vatRate: e.target.value } }))}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mb-3 mt-3 text-xs text-slate-400">Creates and approves (posts) a new purchase order for this supplier, pre-filled from the requisition's items and quantities.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Purchase Order" />
    </form>
  );
}

function RequisitionDetailModal({ requisitionId, onClose, onChanged }: { requisitionId: string; onClose: () => void; onChanged: () => void }) {
  const { token, companyId, hasPermission, me } = useAuth();
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const d = await apiRequest<RequisitionDetail>(`/api/purchase-requisitions/${requisitionId}`, { token, companyId });
    setDetail(d);
  }

  useEffect(() => {
    if (!token || !companyId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId, token, companyId]);

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/purchase-requisitions/${requisitionId}/approve`, { method: "POST", token, companyId });
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/purchase-requisitions/${requisitionId}/withdraw`, { method: "POST", token, companyId });
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to withdraw");
    } finally {
      setBusy(false);
    }
  }

  async function reject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/purchase-requisitions/${requisitionId}/reject`, {
        method: "POST",
        token,
        companyId,
        body: { rejectionReason },
      });
      await reload();
      onChanged();
      setShowReject(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reject");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400">Loading...</p>;

  const isOwnRequisition = me?.user.email === detail.requested_by_email;
  const canApprove = hasPermission("purchasing.requisition.approve") && !isOwnRequisition;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{detail.document_number}</div>
          <div className="text-sm text-slate-700">
            {detail.store_name_en} · requested by {detail.requested_by_email ?? "—"}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {detail.notes && <p className="mb-2 text-xs text-slate-500">{detail.notes}</p>}
      {detail.document_status === "rejected" && detail.rejection_reason && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">Rejected: {detail.rejection_reason}</p>
      )}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">
              {line.item_name_en} <span className="text-xs text-slate-400">({line.variant_code})</span>
              {line.notes && <span className="ms-2 text-xs text-slate-400">— {line.notes}</span>}
            </span>
            <span className="font-medium text-slate-900">{Number(line.qty).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {detail.document_status === "pending_approval" && canApprove && !showReject && (
        <div className="flex gap-2">
          <button onClick={approve} disabled={busy} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {busy ? "Working..." : "Approve"}
          </button>
          <button onClick={() => setShowReject(true)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            Reject
          </button>
        </div>
      )}
      {detail.document_status === "pending_approval" && !canApprove && (
        <p className="mb-2 text-xs text-slate-400">
          {isOwnRequisition ? "You cannot approve your own requisition." : "Awaiting approval from someone with requisition-approval rights."}
        </p>
      )}
      {detail.document_status === "pending_approval" && isOwnRequisition && (
        <button onClick={withdraw} disabled={busy} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {busy ? "Working..." : "Withdraw"}
        </button>
      )}
      {showReject && (
        <form onSubmit={reject} className="space-y-2">
          <Field label="Rejection Reason" required>
            <TextInput required value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? "Working..." : "Confirm Rejection"}
            </button>
            <button type="button" onClick={() => setShowReject(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {detail.document_status === "approved" && !showConvert && (
        <button onClick={() => setShowConvert(true)} className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600">
          Convert to Purchase Order
        </button>
      )}
      {showConvert && (
        <ConvertRequisitionForm
          requisition={detail}
          onClose={() => setShowConvert(false)}
          onConverted={() => {
            onChanged();
            onClose();
          }}
        />
      )}
      {detail.document_status === "converted_to_po" && <p className="text-xs text-slate-400">Already converted into a purchase order.</p>}
    </div>
  );
}

function RequisitionsTab() {
  const { data, error, reload } = useApiList<PurchaseRequisition>("/api/purchase-requisitions");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<PurchaseRequisition>[] = [
    { key: "number", header: "PR #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.requisition_date).toLocaleDateString() },
    { key: "requester", header: "Requested By", render: (r) => r.requested_by_email ?? "—" },
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
        getSearchText={(r) => `${r.document_number} ${r.store_name_en} ${r.requested_by_email ?? ""}`}
        emptyIcon={ClipboardList}
        emptyText="No purchase requisitions yet."
        searchPlaceholder="Search requisitions..."
        actionLabel="New Requisition"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setOpenId(r.id)}
      />
      {showNew && (
        <Modal title="New Purchase Requisition" onClose={() => setShowNew(false)}>
          <NewRequisitionForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {openId && (
        <Modal title="Purchase Requisition" onClose={() => setOpenId(null)}>
          <RequisitionDetailModal requisitionId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}

function PoDetailModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [requisitionNumber, setRequisitionNumber] = useState<string | null>(null);
  const [openRequisitionId, setOpenRequisitionId] = useState<string | null>(null);
  const baseCurrency = useBaseCurrency();

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<PoDetail>(`/api/purchase-orders/${poId}`, { token, companyId }).then((d) => {
      setDetail(d);
      if (d.purchase_requisition_id) {
        apiRequest<RequisitionDetail>(`/api/purchase-requisitions/${d.purchase_requisition_id}`, { token, companyId }).then((r) =>
          setRequisitionNumber(r.document_number),
        );
      }
    });
  }, [poId, token, companyId]);

  if (!detail) return <p className="text-sm text-slate-400">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{detail.document_number}</div>
          <div className="text-sm text-slate-700">
            {detail.supplier_name_en} · {new Date(detail.order_date).toLocaleDateString()}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {detail.purchase_requisition_id && (
        <button
          onClick={() => setOpenRequisitionId(detail.purchase_requisition_id)}
          className="mb-3 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Created from requisition {requisitionNumber ?? "…"}
        </button>
      )}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">
              {line.item_name_en} <span className="text-xs text-slate-400">({line.variant_code})</span>
            </span>
            <span className="font-medium text-slate-900">
              {Number(line.qty).toLocaleString()} × {Number(line.unit_price).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="text-sm font-medium text-slate-700">
        Total: {formatMoney(detail.gross_amount, detail.currency !== baseCurrency ? detail.currency : undefined)}
      </div>

      {openRequisitionId && (
        <Modal title="Purchase Requisition" onClose={() => setOpenRequisitionId(null)}>
          <RequisitionDetailModal requisitionId={openRequisitionId} onClose={() => setOpenRequisitionId(null)} onChanged={() => {}} />
        </Modal>
      )}
    </div>
  );
}

function PurchaseOrdersTab() {
  const { i18n } = useTranslation();
  const { data, error, reload } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const baseCurrency = useBaseCurrency();

  const columns: Column<PurchaseOrder>[] = [
    { key: "number", header: "PO #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.supplier_name_ar : r.supplier_name_en}</span>,
    },
    { key: "date", header: "Order Date", render: (r) => new Date(r.order_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => formatMoney(r.gross_amount, r.currency !== baseCurrency ? r.currency : undefined), numeric: true },
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
        onRowClick={(r) => setOpenId(r.id)}
      />
      {showNew && (
        <Modal title="New Purchase Order" onClose={() => setShowNew(false)}>
          <NewPurchaseOrderForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {openId && (
        <Modal title="Purchase Order" onClose={() => setOpenId(null)}>
          <PoDetailModal poId={openId} onClose={() => setOpenId(null)} />
        </Modal>
      )}
    </>
  );
}

function NewSupplierForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const baseCurrency = useBaseCurrency();
  const [supplierCode, setSupplierCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [vatRegistrationNumber, setVatRegistrationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Saudi Arabia");
  const [currency, setCurrency] = useState(baseCurrency);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/suppliers", {
        method: "POST",
        token,
        companyId,
        body: {
          supplierCode,
          nameEn,
          nameAr,
          crNumber: crNumber || null,
          vatRegistrationNumber: vatRegistrationNumber || null,
          address: address || null,
          city: city || null,
          country: country || null,
          phone: phone || null,
          email: email || null,
          paymentTermsDays,
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
          currency,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create supplier");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Supplier Code" required>
        <TextInput required value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CR Number">
          <TextInput value={crNumber} onChange={(e) => setCrNumber(e.target.value)} />
        </Field>
        <Field label="VAT Registration #">
          <TextInput value={vatRegistrationNumber} onChange={(e) => setVatRegistrationNumber(e.target.value)} />
        </Field>
        <Field label="City">
          <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Country">
          <TextInput value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
        <Field label="Phone">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <Field label="Address">
        <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment Terms (days)">
          <TextInput type="number" min={0} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />
        </Field>
        <Field label="Lead Time (days)">
          <TextInput type="number" min={0} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
        </Field>
      </div>
      <Field label="Invoicing Currency" required>
        <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
      </Field>
      <p className="mb-3 text-xs text-slate-400">Pre-fills the currency on new purchase orders for this supplier — an overseas supplier is usually {baseCurrency !== "USD" ? "USD" : "EUR"} or similar.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Supplier" />
    </form>
  );
}

function SupplierPriceCatalog({ supplier, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: prices, reload } = useApiList<SupplierItemPrice>(`/api/supplier-item-prices?supplierId=${supplier.id}`);
  const variantOptions = useVariantOptions();
  const [itemVariantId, setItemVariantId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [moq, setMoq] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);

  const variantLabel = (id: string) => variantOptions.find((v) => v.id === id)?.label ?? id;

  async function setLinePrice(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/suppliers/${supplier.id}/prices`, {
        method: "POST",
        token,
        companyId,
        body: {
          itemVariantId,
          unitCost: Number(unitCost),
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
          moq: moq ? Number(moq) : null,
        },
      });
      setItemVariantId("");
      setUnitCost("");
      setLeadTimeDays("");
      setMoq("");
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to set price");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLine(variantId: string) {
    setBusyVariantId(variantId);
    try {
      await apiRequest(`/api/suppliers/${supplier.id}/prices/${variantId}/remove`, { method: "POST", token, companyId });
      reload();
      onChanged();
    } finally {
      setBusyVariantId(null);
    }
  }

  return (
    <div>
      <form onSubmit={setLinePrice} className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <Field label="Item">
          <SelectInput required value={itemVariantId} onChange={(e) => setItemVariantId(e.target.value)}>
            <option value="">Select...</option>
            {variantOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit Cost (net)">
            <TextInput required type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
          <Field label="Lead Time (days)">
            <TextInput type="number" min="0" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </Field>
          <Field label="MOQ">
            <TextInput type="number" min="0" step="0.001" value={moq} onChange={(e) => setMoq(e.target.value)} />
          </Field>
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Set Price"}
        </button>
      </form>

      <p className="mb-2 text-xs text-slate-400">
        Every purchase order placed with this supplier also updates these costs automatically to whatever was last ordered.
      </p>
      {prices && prices.length === 0 && <p className="text-sm text-slate-400">No quoted prices on file yet.</p>}
      <div className="space-y-1.5">
        {prices?.map((p) => (
          <div key={p.item_variant_id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
            <div>
              <div className="text-slate-700">{variantLabel(p.item_variant_id)}</div>
              <div className="text-xs text-slate-400">
                {p.lead_time_days != null ? `${p.lead_time_days}d lead time` : "no lead time set"}
                {p.moq ? ` · MOQ ${Number(p.moq)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums text-slate-900">
                {Number(p.unit_cost).toFixed(2)} {p.currency}
              </span>
              <button
                onClick={() => removeLine(p.item_variant_id)}
                disabled={busyVariantId === p.item_variant_id}
                className="text-slate-300 hover:text-red-500 disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuppliersTab() {
  const { token, companyId } = useAuth();
  const { data, error, reload } = useApiList<Supplier>("/api/suppliers");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(supplier: Supplier) {
    setBusyId(supplier.id);
    try {
      await apiRequest(`/api/suppliers/${supplier.id}/${supplier.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Supplier>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.supplier_code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name_en}</span> },
    { key: "location", header: "Location", render: (r) => [r.city, r.country].filter(Boolean).join(", ") || "—" },
    { key: "currency", header: "Currency", render: (r) => r.currency },
    { key: "terms", header: "Payment Terms", render: (r) => `${r.payment_terms_days}d`, numeric: true },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={r.is_active ? "active" : "inactive"} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(r);
            }}
            disabled={busyId === r.id}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
          >
            {r.is_active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  const detailSupplier = data?.find((s) => s.id === detailId) ?? null;

  return (
    <>
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
        actionLabel="New Supplier"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setDetailId(r.id)}
      />
      {showNew && (
        <Modal title="New Supplier" onClose={() => setShowNew(false)}>
          <NewSupplierForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {detailSupplier && (
        <Modal title={`${detailSupplier.name_en} — Cost Catalog`} onClose={() => setDetailId(null)}>
          <SupplierPriceCatalog supplier={detailSupplier} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}

export default function Purchasing() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.purchasing")}</h1>
      <Tabs
        tabs={[
          { key: "requisitions", label: "Requisitions", content: <RequisitionsTab /> },
          { key: "pos", label: "Purchase Orders", content: <PurchaseOrdersTab /> },
          { key: "receipts", label: "Goods Receipts", content: <GoodsReceiptsTab /> },
          { key: "invoices", label: "Supplier Invoices", content: <SupplierInvoicesTab /> },
          { key: "suppliers", label: "Suppliers", content: <SuppliersTab /> },
        ]}
      />
    </div>
  );
}
