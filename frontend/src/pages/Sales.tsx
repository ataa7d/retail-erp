import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Receipt, RotateCcw, Plus, Trash2, Tag } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface SalesInvoice {
  id: string;
  document_number: string;
  invoice_channel: string;
  invoice_date: string;
  document_status: string;
  gross_amount: string;
  customer_name_en: string | null;
  customer_name_ar: string | null;
}

interface SalesInvoiceLine {
  id: string;
  item_variant_id: string | null;
  item_description: string;
  qty: string;
  unit_price: string;
  vat_rate: string;
  price_includes_vat: boolean;
}

interface SalesInvoiceDetail {
  id: string;
  store_id: string;
  customer_id: string | null;
  gross_amount: string;
  lines: SalesInvoiceLine[];
}

interface CreditNote {
  id: string;
  document_number: string;
  credit_note_date: string;
  document_status: string;
  reason: string;
  gross_amount: string;
  original_invoice_number: string;
  customer_name_en: string | null;
}

interface Store {
  id: string;
  store_code: string;
  name_en: string;
}

interface Customer {
  id: string;
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

interface PriceListItem {
  item_variant_id: string;
  price: string;
}

interface PriceList {
  id: string;
  code: string;
  name_en: string;
  price_includes_vat: boolean;
  is_default: boolean;
}

interface InvoiceLineDraft {
  itemVariantId: string;
  itemDescription: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
  priceIncludesVat: boolean;
}

interface PaymentDraft {
  paymentMethod: "cash" | "card" | "credit" | "points" | "gift_card";
  amount: string;
}

function useVariantOptions() {
  const { data: items } = useApiList<Item>("/api/items");
  const options: Array<{ id: string; label: string; itemName: string }> = [];
  for (const item of items ?? []) {
    for (const v of item.variants) {
      const detail = [v.color, v.size].filter(Boolean).join(" / ");
      options.push({ id: v.id, itemName: item.name_en, label: `${item.name_en} — ${v.variant_code}${detail ? ` (${detail})` : ""}` });
    }
  }
  return options;
}

function NewSalesInvoiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const variantOptions = useVariantOptions();

  const [invoiceChannel, setInvoiceChannel] = useState<"pos" | "wholesale">("pos");
  const [storeId, setStoreId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [priceListItems, setPriceListItems] = useState<PriceListItem[] | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [lines, setLines] = useState<InvoiceLineDraft[]>([
    { itemVariantId: "", itemDescription: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: true },
  ]);
  const [payments, setPayments] = useState<PaymentDraft[]>([{ paymentMethod: "cash", amount: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const zatcaInvoiceCategory = invoiceChannel === "pos" ? "simplified" : "standard";

  useEffect(() => {
    if (!priceListId || !token || !companyId) {
      setPriceListItems(null);
      return;
    }
    apiRequest<PriceListItem[]>(`/api/price-lists/${priceListId}/items`, { token, companyId }).then(setPriceListItems);
  }, [priceListId, token, companyId]);

  const lineTotals = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const vat = Number(l.vatRate) || 0;
    const net = qty * price;
    return l.priceIncludesVat ? net : net * (1 + vat / 100);
  });
  const totalGross = Math.round(lineTotals.reduce((s, v) => s + v, 0) * 100) / 100;
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.round((totalGross - totalPaid) * 100) / 100;

  function updateLine(index: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        // Auto-fill from the selected price list when the variant changes,
        // so the common case (selling at list price) needs no typing.
        if (patch.itemVariantId !== undefined) {
          const variant = variantOptions.find((v) => v.id === patch.itemVariantId);
          next.itemDescription = variant?.itemName ?? "";
          const priceEntry = priceListItems?.find((pi) => pi.item_variant_id === patch.itemVariantId);
          const list = priceLists?.find((pl) => pl.id === priceListId);
          if (priceEntry) {
            next.unitPrice = priceEntry.price;
            next.priceIncludesVat = list?.price_includes_vat ?? next.priceIncludesVat;
          }
        }
        return next;
      }),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", itemDescription: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: true }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePayment(index: number, patch: Partial<PaymentDraft>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function addPayment() {
    setPayments((prev) => [...prev, { paymentMethod: "cash", amount: "" }]);
  }
  function removePayment(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }
  function fillRemaining(index: number) {
    updatePayment(index, { amount: String(Math.max(0, remaining + (Number(payments[index]!.amount) || 0))) });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (invoiceChannel === "pos" && Math.abs(remaining) > 0.005) {
      setError(`Payments (${totalPaid.toFixed(2)}) must cover the total (${totalGross.toFixed(2)}).`);
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/sales-invoices", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          invoiceChannel,
          zatcaInvoiceCategory,
          invoiceDate,
          fiscalPeriodId,
          customerId: customerId || null,
          priceListId: priceListId || null,
          lines: lines
            .filter((l) => l.itemVariantId)
            .map((l) => ({
              itemVariantId: l.itemVariantId,
              itemDescription: l.itemDescription,
              qty: Number(l.qty),
              unitPrice: Number(l.unitPrice),
              discountAmount: 0,
              vatRate: Number(l.vatRate),
              priceIncludesVat: l.priceIncludesVat,
            })),
          payments:
            invoiceChannel === "pos"
              ? payments.filter((p) => Number(p.amount) > 0).map((p) => ({ paymentMethod: p.paymentMethod, amount: Number(p.amount) }))
              : undefined,
        },
      });
      await apiRequest(`/api/sales-invoices/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create sales invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel" required>
          <SelectInput value={invoiceChannel} onChange={(e) => setInvoiceChannel(e.target.value as "pos" | "wholesale")}>
            <option value="pos">POS</option>
            <option value="wholesale">Wholesale</option>
          </SelectInput>
        </Field>
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
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer">
          <SelectInput value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in / none</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Price List">
          <SelectInput value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
            <option value="">None (manual pricing)</option>
            {priceLists?.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoice Date" required>
          <TextInput type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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

      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">Total: {totalGross.toFixed(2)}</div>

      {invoiceChannel === "pos" && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Payments</div>
          <div className="space-y-2">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <SelectInput value={p.paymentMethod} onChange={(e) => updatePayment(i, { paymentMethod: e.target.value as PaymentDraft["paymentMethod"] })} className="min-w-0 flex-1">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="credit">Credit (AR)</option>
                  <option value="points">Points</option>
                  <option value="gift_card">Gift Card</option>
                </SelectInput>
                <div className="w-28 flex-none">
                  <TextInput type="number" min={0} step="0.01" placeholder="Amount" value={p.amount} onChange={(e) => updatePayment(i, { amount: e.target.value })} />
                </div>
                <button type="button" onClick={() => fillRemaining(i)} className="shrink-0 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                  Fill
                </button>
                <button type="button" onClick={() => removePayment(i)} className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addPayment} className="mt-2 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
            <Plus size={14} /> Add payment
          </button>

          <div className={`mt-3 flex justify-between rounded-md px-3 py-2 text-sm font-medium ${Math.abs(remaining) < 0.005 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
            <span>Paid: {totalPaid.toFixed(2)}</span>
            <span>Remaining: {remaining.toFixed(2)}</span>
          </div>
        </>
      )}

      <FormActions error={error} submitting={submitting} submitLabel="Post Invoice" />
    </form>
  );
}

function NewCreditNoteForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: invoices } = useApiList<SalesInvoice>("/api/sales-invoices");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const postedInvoices = invoices?.filter((i) => i.document_status === "posted") ?? [];

  const [originalInvoiceId, setOriginalInvoiceId] = useState("");
  const [invoiceDetail, setInvoiceDetail] = useState<SalesInvoiceDetail | null>(null);
  const [reason, setReason] = useState("");
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [lineData, setLineData] = useState<Record<string, { qty: string; selected: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!originalInvoiceId || !token || !companyId) {
      setInvoiceDetail(null);
      return;
    }
    apiRequest<SalesInvoiceDetail>(`/api/sales-invoices/${originalInvoiceId}`, { token, companyId }).then((detail) => {
      setInvoiceDetail(detail);
      const init: Record<string, { qty: string; selected: boolean }> = {};
      for (const line of detail.lines) init[line.id] = { qty: line.qty, selected: false };
      setLineData(init);
    });
  }, [originalInvoiceId, token, companyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!invoiceDetail) return;
    setSubmitting(true);
    try {
      const lines = invoiceDetail.lines
        .filter((l) => lineData[l.id]?.selected)
        .map((l) => ({
          sourceLineId: l.id,
          itemVariantId: l.item_variant_id,
          itemDescription: l.item_description,
          qty: Number(lineData[l.id]!.qty),
          unitPrice: Number(l.unit_price),
          discountAmount: 0,
          vatRate: Number(l.vat_rate),
          priceIncludesVat: l.price_includes_vat,
        }));
      if (lines.length === 0) throw new Error("Select at least one line to return.");

      const created = await apiRequest<{ id: string }>("/api/credit-notes", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId: invoiceDetail.store_id,
          originalInvoiceId,
          zatcaInvoiceCategory: "simplified",
          creditNoteDate,
          fiscalPeriodId,
          customerId: invoiceDetail.customer_id,
          reason,
          lines,
        },
      });
      await apiRequest(`/api/credit-notes/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to create credit note");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Original Invoice" required>
        <SelectInput required value={originalInvoiceId} onChange={(e) => setOriginalInvoiceId(e.target.value)}>
          <option value="">Select a posted invoice...</option>
          {postedInvoices.map((inv) => (
            <option key={inv.id} value={inv.id}>
              {inv.document_number} — {inv.customer_name_en ?? "Walk-in"} ({Number(inv.gross_amount).toFixed(2)})
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Credit Note Date" required>
          <TextInput type="date" required value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} />
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
      <Field label="Reason" required>
        <TextInput required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer changed mind" />
      </Field>

      {invoiceDetail && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700">Lines to return</div>
          <div className="space-y-2">
            {invoiceDetail.lines.map((line) => (
              <div key={line.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
                <input
                  type="checkbox"
                  checked={lineData[line.id]?.selected ?? false}
                  onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, selected: e.target.checked } }))}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-900">{line.item_description}</div>
                  <div className="text-xs text-slate-400">sold {line.qty} @ {Number(line.unit_price).toFixed(2)}</div>
                </div>
                <div className="w-24 flex-none">
                  <TextInput
                    type="number"
                    min={0.001}
                    max={Number(line.qty)}
                    step="0.001"
                    value={lineData[line.id]?.qty ?? ""}
                    disabled={!lineData[line.id]?.selected}
                    onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, qty: e.target.value } }))}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mb-3 mt-3 text-xs text-slate-400">Recalculated fresh from qty/price — never scaled from the original line, and can't exceed what was sold.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Credit Note" />
    </form>
  );
}

function SalesInvoicesTab() {
  const { i18n } = useTranslation();
  const { data, error, reload } = useApiList<SalesInvoice>("/api/sales-invoices");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<SalesInvoice>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "channel", header: "Channel", render: (r) => <span className="capitalize">{r.invoice_channel}</span> },
    {
      key: "customer",
      header: "Customer",
      render: (r) => (r.customer_name_en ? (i18n.language.startsWith("ar") ? r.customer_name_ar : r.customer_name_en) : "Walk-in"),
    },
    { key: "date", header: "Date", render: (r) => new Date(r.invoice_date).toLocaleDateString() },
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
        getSearchText={(r) => `${r.document_number} ${r.customer_name_en ?? ""}`}
        emptyIcon={Receipt}
        emptyText="No sales invoices yet."
        searchPlaceholder="Search sales invoices..."
        actionLabel="New Sales Invoice"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Sales Invoice" onClose={() => setShowNew(false)}>
          <NewSalesInvoiceForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function CreditNotesTab() {
  const { data, error, reload } = useApiList<CreditNote>("/api/credit-notes");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<CreditNote>[] = [
    { key: "number", header: "CN #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "invoice", header: "Original Invoice", render: (r) => <span className="font-mono text-xs text-slate-500">{r.original_invoice_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en ?? "Walk-in" },
    { key: "date", header: "Date", render: (r) => new Date(r.credit_note_date).toLocaleDateString() },
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
        getSearchText={(r) => `${r.document_number} ${r.original_invoice_number}`}
        emptyIcon={RotateCcw}
        emptyText="No credit notes yet."
        searchPlaceholder="Search credit notes..."
        actionLabel="New Credit Note"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Credit Note" onClose={() => setShowNew(false)}>
          <NewCreditNoteForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

interface PriceListRow {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  currency: string;
  price_includes_vat: boolean;
  is_default: boolean;
  is_active: boolean;
}

function NewPriceListForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [priceIncludesVat, setPriceIncludesVat] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/price-lists", {
        method: "POST",
        token,
        companyId,
        body: { code, nameEn, nameAr, currency, priceIncludesVat, isDefault },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create price list");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Code" required>
        <TextInput required value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WHOLESALE" />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      <Field label="Currency" required>
        <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
      </Field>
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={priceIncludesVat} onChange={(e) => setPriceIncludesVat(e.target.checked)} />
        Prices include VAT
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Make this the default price list
      </label>
      <p className="mb-3 text-xs text-slate-400">Only one price list can be default per company — making this one default clears the current default.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Price List" />
    </form>
  );
}

function PriceListDetail({ list, onChanged }: { list: PriceListRow; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: prices, reload } = useApiList<PriceListItem>(`/api/price-lists/${list.id}/items`);
  const variantOptions = useVariantOptions();
  const [itemVariantId, setItemVariantId] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);

  const variantLabel = (id: string) => variantOptions.find((v) => v.id === id)?.label ?? id;

  async function setLinePrice(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/price-lists/${list.id}/items`, {
        method: "POST",
        token,
        companyId,
        body: { itemVariantId, price: Number(price) },
      });
      setItemVariantId("");
      setPrice("");
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
      await apiRequest(`/api/price-lists/${list.id}/items/${variantId}/remove`, { method: "POST", token, companyId });
      reload();
      onChanged();
    } finally {
      setBusyVariantId(null);
    }
  }

  return (
    <div>
      <form onSubmit={setLinePrice} className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
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
          <Field label="Price">
            <TextInput required type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
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

      {prices && prices.length === 0 && <p className="text-sm text-slate-400">No prices set on this list yet.</p>}
      <div className="space-y-1.5">
        {prices?.map((p) => (
          <div key={p.item_variant_id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
            <span className="text-slate-700">{variantLabel(p.item_variant_id)}</span>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums text-slate-900">{Number(p.price).toFixed(2)}</span>
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

function PriceListsTab() {
  const { token, companyId } = useAuth();
  const { data, error, reload } = useApiList<PriceListRow>("/api/price-lists");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(list: PriceListRow) {
    setBusyId(list.id);
    try {
      await apiRequest(`/api/price-lists/${list.id}/${list.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<PriceListRow>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name_en}</span> },
    { key: "currency", header: "Currency", render: (r) => r.currency },
    { key: "vat", header: "VAT", render: (r) => (r.price_includes_vat ? "Inclusive" : "Exclusive") },
    { key: "default", header: "Default", render: (r) => (r.is_default ? <StatusBadge status="active" /> : "—") },
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

  const detailList = data?.find((l) => l.id === detailId) ?? null;

  return (
    <>
      <ListPage
        title=""
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.code} ${r.name_en}`}
        emptyIcon={Tag}
        emptyText="No price lists yet."
        searchPlaceholder="Search price lists..."
        actionLabel="New Price List"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setDetailId(r.id)}
      />
      {showNew && (
        <Modal title="New Price List" onClose={() => setShowNew(false)}>
          <NewPriceListForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {detailList && (
        <Modal title={`${detailList.name_en} — Prices`} onClose={() => setDetailId(null)}>
          <PriceListDetail list={detailList} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}

export default function Sales() {
  const { t } = useTranslation();
  const tabs = useMemo(
    () => [
      { key: "invoices", label: "Sales Invoices", content: <SalesInvoicesTab /> },
      { key: "credits", label: "Credit Notes", content: <CreditNotesTab /> },
      { key: "price-lists", label: "Price Lists", content: <PriceListsTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.sales")}</h1>
      <Tabs tabs={tabs} />
    </div>
  );
}
