import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, RotateCcw, Plus, Trash2, Tag, FileText, Wallet, Printer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError, downloadFile } from "../lib/api";
import { runBulkAction } from "../lib/bulkAction";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { InvoicePrintArea } from "../components/InvoicePrint";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";
import { formatMoney } from "../lib/currency";

interface SalesInvoice {
  id: string;
  document_number: string;
  invoice_channel: string;
  invoice_date: string;
  document_status: string;
  gross_amount: string;
  credited_amount: string;
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

interface FullInvoiceLine {
  id: string;
  item_description: string;
  qty: string;
  unit_price: string;
  net_amount: string;
  vat_amount: string;
  gross_amount: string;
}

interface FullSalesInvoice {
  id: string;
  document_number: string;
  invoice_channel: string;
  zatca_invoice_category: string;
  invoice_date: string;
  document_status: string;
  net_amount: string;
  vat_amount: string;
  gross_amount: string;
  lines: FullInvoiceLine[];
  zatcaQr: string | null;
  zatcaQrError: string | null;
  creditedAmount: string;
  company_name_en: string;
  company_name_ar: string;
  company_vat_number: string | null;
  company_cr_number: string | null;
  customer_name_en: string | null;
  customer_name_ar: string | null;
  customer_vat_number: string | null;
}

interface FullCreditNote {
  id: string;
  document_number: string;
  credit_note_date: string;
  document_status: string;
  reason: string;
  net_amount: string;
  vat_amount: string;
  gross_amount: string;
  lines: FullInvoiceLine[];
  zatcaQr: string | null;
  zatcaQrError: string | null;
}

function ZatcaQrPanel({ status, qr, qrError }: { status: string; qr: string | null; qrError: string | null }) {
  if (status !== "posted") {
    return <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">The ZATCA QR code is generated once this document is posted.</p>;
  }
  if (qrError) {
    return (
      <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
        ZATCA QR code unavailable: {qrError}. Set the company's VAT registration number under Administration.
      </p>
    );
  }
  if (!qr) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-1 border-t border-dashed border-slate-200 dark:border-slate-700 pt-3">
      <img src={qr} alt="ZATCA QR code" width={140} height={140} />
      <p className="text-center text-xs text-slate-400 dark:text-slate-500">ZATCA Phase 1 QR — scan to verify seller, VAT number, timestamp and totals.</p>
    </div>
  );
}

function XmlDownloadButton({ status, path }: { status: string; path: string }) {
  const { token, companyId } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "posted") return null;

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      await downloadFile(path, { token, companyId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to download XML");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        {downloading ? "Preparing..." : "Download ZATCA XML (Phase 2, unsigned)"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function VoidInvoiceForm({ invoiceId, onClose, onVoided }: { invoiceId: string; onClose: () => void; onVoided: () => void }) {
  const { token, companyId } = useAuth();
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriodId = periods?.find((p) => p.status === "open")?.id ?? "";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/sales-invoices/${invoiceId}/void`, {
        method: "POST",
        token,
        companyId,
        body: { fiscalPeriodId: openPeriodId, reason },
      });
      onVoided();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to void this sale");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
      <p className="mb-2 text-xs text-red-700">
        This issues and posts a full credit note against every line on this invoice — the invoice itself is never altered (ZATCA doesn't
        allow that), only fully reversed. Cannot be undone.
      </p>
      <Field label="Reason" required>
        <TextInput required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong item rung up" />
      </Field>
      {!openPeriodId && <p className="mb-2 text-xs text-red-600">No open fiscal period — cannot void right now.</p>}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !openPeriodId}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? "Voiding..." : "Confirm Void"}
        </button>
        <button type="button" onClick={onClose} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SalesInvoiceDetailModal({ invoiceId, onVoided }: { invoiceId: string; onVoided: () => void }) {
  const { token, companyId, hasPermission } = useAuth();
  const [detail, setDetail] = useState<FullSalesInvoice | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  function reload() {
    return apiRequest<FullSalesInvoice>(`/api/sales-invoices/${invoiceId}`, { token, companyId }).then(setDetail);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, token, companyId]);

  async function post() {
    setPostError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/sales-invoices/${invoiceId}/post`, { method: "POST", token, companyId });
      await reload();
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  }

  const isVoided = detail ? Number(detail.creditedAmount) >= Number(detail.gross_amount) && Number(detail.gross_amount) > 0 : false;
  const canVoid = detail?.document_status === "posted" && !isVoided && hasPermission("sales.document.void");

  return (
    <>
      {!detail ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</span>
            <StatusBadge status={isVoided ? "voided" : detail.document_status} />
          </div>
          <div className="mb-3 text-xs capitalize text-slate-500 dark:text-slate-400">
            {detail.invoice_channel} · {detail.zatca_invoice_category}
          </div>
          <div className="space-y-1 border-y border-dashed border-slate-200 dark:border-slate-700 py-2 text-sm">
            {detail.lines.map((l) => (
              <div key={l.id} className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">
                  {l.item_description} × {l.qty}
                </span>
                <span className="tabular-nums">{Number(l.gross_amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Net</span>
              <span className="tabular-nums">{Number(detail.net_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>VAT</span>
              <span className="tabular-nums">{Number(detail.vat_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-slate-900 dark:text-slate-100">
              <span>Total</span>
              <span className="tabular-nums">{Number(detail.gross_amount).toFixed(2)}</span>
            </div>
          </div>
          {postError && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{postError}</p>}
          {detail.document_status === "draft" && hasPermission("sales.pos_invoice.create") && (
            <button
              onClick={post}
              disabled={busy}
              className="mt-3 w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Working..." : "Post"}
            </button>
          )}
          <ZatcaQrPanel status={detail.document_status} qr={detail.zatcaQr} qrError={detail.zatcaQrError} />
          <XmlDownloadButton status={detail.document_status} path={`/api/sales-invoices/${detail.id}/xml`} />
          {detail.document_status === "posted" && (
            <button
              onClick={() => window.print()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Printer size={14} /> Print Invoice
            </button>
          )}
          {canVoid && !showVoid && (
            <button
              onClick={() => setShowVoid(true)}
              className="mt-3 w-full rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Void This Sale
            </button>
          )}
          {showVoid && (
            <VoidInvoiceForm
              invoiceId={detail.id}
              onClose={() => setShowVoid(false)}
              onVoided={() => {
                onVoided();
                apiRequest<FullSalesInvoice>(`/api/sales-invoices/${invoiceId}`, { token, companyId }).then(setDetail);
              }}
            />
          )}
          {detail.document_status === "posted" && (
            <InvoicePrintArea
              category={detail.zatca_invoice_category === "standard" ? "standard" : "simplified"}
              documentNumber={detail.document_number}
              invoiceDate={new Date(detail.invoice_date).toLocaleDateString()}
              companyNameEn={detail.company_name_en}
              companyNameAr={detail.company_name_ar}
              companyVatNumber={detail.company_vat_number}
              companyCrNumber={detail.company_cr_number}
              customerNameEn={detail.customer_name_en}
              customerVatNumber={detail.customer_vat_number}
              lines={detail.lines.map((l) => ({
                description: l.item_description,
                qty: Number(l.qty),
                unitPrice: Number(l.unit_price),
                net: Number(l.net_amount),
                vat: Number(l.vat_amount),
                gross: Number(l.gross_amount),
              }))}
              netAmount={Number(detail.net_amount)}
              vatAmount={Number(detail.vat_amount)}
              grossAmount={Number(detail.gross_amount)}
              qr={detail.zatcaQr}
            />
          )}
        </div>
      )}
    </>
  );
}

export function CreditNoteDetailModal({ creditNoteId }: { creditNoteId: string }) {
  const { token, companyId, hasPermission } = useAuth();
  const [detail, setDetail] = useState<FullCreditNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  function reload() {
    return apiRequest<FullCreditNote>(`/api/credit-notes/${creditNoteId}`, { token, companyId }).then(setDetail);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditNoteId, token, companyId]);

  async function post() {
    setPostError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/credit-notes/${creditNoteId}/post`, { method: "POST", token, companyId });
      await reload();
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!detail ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</span>
            <StatusBadge status={detail.document_status} />
          </div>
          <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">{detail.reason}</div>
          <div className="space-y-1 border-y border-dashed border-slate-200 dark:border-slate-700 py-2 text-sm">
            {detail.lines.map((l) => (
              <div key={l.id} className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">
                  {l.item_description} × {l.qty}
                </span>
                <span className="tabular-nums">{Number(l.gross_amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Net</span>
              <span className="tabular-nums">{Number(detail.net_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>VAT</span>
              <span className="tabular-nums">{Number(detail.vat_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-slate-900 dark:text-slate-100">
              <span>Total</span>
              <span className="tabular-nums">{Number(detail.gross_amount).toFixed(2)}</span>
            </div>
          </div>
          {postError && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{postError}</p>}
          {detail.document_status === "draft" && hasPermission("sales.return.create") && (
            <button
              onClick={post}
              disabled={busy}
              className="mt-3 w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Working..." : "Post"}
            </button>
          )}
          <ZatcaQrPanel status={detail.document_status} qr={detail.zatcaQr} qrError={detail.zatcaQrError} />
          <XmlDownloadButton status={detail.document_status} path={`/api/credit-notes/${detail.id}/xml`} />
        </div>
      )}
    </>
  );
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
  default_price_list_id: string | null;
  credit_limit: string | null;
}

interface ArAgeingRow {
  customer_id: string;
  open_amount: string;
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
  default_tax_code_id: string | null;
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

export function NewSalesInvoiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const { data: taxCodes } = useApiList<TaxCodeOption>("/api/tax-codes");
  const { data: arAgeing } = useApiList<ArAgeingRow>("/api/ar-ageing");
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
        // so the common case (selling at list price) needs no typing --
        // including the VAT rate, from the list's own default tax code
        // (e.g. a Reference or Tender list quoted at a different rate than
        // the shelf price), not just the price itself.
        if (patch.itemVariantId !== undefined) {
          const variant = variantOptions.find((v) => v.id === patch.itemVariantId);
          next.itemDescription = variant?.itemName ?? "";
          const priceEntry = priceListItems?.find((pi) => pi.item_variant_id === patch.itemVariantId);
          const list = priceLists?.find((pl) => pl.id === priceListId);
          if (priceEntry) {
            next.unitPrice = priceEntry.price;
            next.priceIncludesVat = list?.price_includes_vat ?? next.priceIncludesVat;
          }
          const taxCode = taxCodes?.find((t) => t.id === list?.default_tax_code_id);
          if (taxCode) next.vatRate = taxCode.rate;
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
          <SelectInput
            value={customerId}
            onChange={(e) => {
              const newCustomerId = e.target.value;
              setCustomerId(newCustomerId);
              // A B2B customer's contracted price list applies by default --
              // still just a starting point, so it only fills an empty
              // selection rather than overriding a price list already
              // chosen by hand.
              const customer = customers?.find((c) => c.id === newCustomerId);
              if (customer?.default_price_list_id && !priceListId) {
                setPriceListId(customer.default_price_list_id);
              }
            }}
          >
            <option value="">Walk-in / none</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
          </SelectInput>
          {invoiceChannel === "wholesale" &&
            customerId &&
            (() => {
              const customer = customers?.find((c) => c.id === customerId);
              if (!customer?.credit_limit) return null;
              const outstanding = (arAgeing ?? [])
                .filter((r) => r.customer_id === customerId)
                .reduce((s, r) => s + Number(r.open_amount), 0);
              const limit = Number(customer.credit_limit);
              const projected = outstanding + totalGross;
              const over = projected > limit;
              return (
                <p className={`mt-1 text-xs ${over ? "text-red-600" : "text-slate-400 dark:text-slate-500"}`}>
                  {over ? "Over credit limit: " : "Available credit: "}
                  {formatMoney(Math.max(0, limit - outstanding), "SAR")} of {formatMoney(limit, "SAR")}
                  {totalGross > 0 && ` — this invoice would leave ${formatMoney(limit - projected, "SAR")}`}
                </p>
              );
            })()}
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

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SelectInput value={line.itemVariantId} onChange={(e) => updateLine(i, { itemVariantId: e.target.value })} className="min-w-0 flex-1">
                <option value="">Item variant...</option>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </SelectInput>
              <button type="button" onClick={() => removeLine(i)} className="shrink-0 rounded p-1.5 text-slate-400 dark:text-slate-500 hover:bg-red-50 hover:text-red-500">
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
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={line.priceIncludesVat} onChange={(e) => updateLine(i, { priceIncludesVat: e.target.checked })} />
              Price includes VAT
            </label>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <Plus size={14} /> Add line
      </button>

      <div className="mt-3 rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">Total: {totalGross.toFixed(2)}</div>

      {invoiceChannel === "pos" && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Payments</div>
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
                <button type="button" onClick={() => fillRemaining(i)} className="shrink-0 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                  Fill
                </button>
                <button type="button" onClick={() => removePayment(i)} className="shrink-0 rounded p-1.5 text-slate-400 dark:text-slate-500 hover:bg-red-50 hover:text-red-500">
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

export function NewCreditNoteForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines to return</div>
          <div className="space-y-2">
            {invoiceDetail.lines.map((line) => (
              <div key={line.id} className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2">
                <input
                  type="checkbox"
                  checked={lineData[line.id]?.selected ?? false}
                  onChange={(e) => setLineData((prev) => ({ ...prev, [line.id]: { ...prev[line.id]!, selected: e.target.checked } }))}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-900 dark:text-slate-100">{line.item_description}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">sold {line.qty} @ {Number(line.unit_price).toFixed(2)}</div>
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

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">Recalculated fresh from qty/price — never scaled from the original line, and can't exceed what was sold.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Credit Note" />
    </form>
  );
}

function SalesInvoicesTab() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<SalesInvoice>("/api/sales-invoices");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("sales.pos_invoice.create");

  const columns: Column<SalesInvoice>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "channel", header: "Channel", render: (r) => <span className="capitalize">{r.invoice_channel}</span> },
    {
      key: "customer",
      header: "Customer",
      render: (r) => (r.customer_name_en ? (i18n.language.startsWith("ar") ? r.customer_name_ar : r.customer_name_en) : "Walk-in"),
    },
    { key: "date", header: "Date", render: (r) => new Date(r.invoice_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => Number(r.gross_amount).toFixed(2), numeric: true },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge status={Number(r.credited_amount) >= Number(r.gross_amount) && Number(r.gross_amount) > 0 ? "voided" : r.document_status} />
      ),
    },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/sales-invoices/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.customer_name_en ?? ""}`}
        emptyIcon={Receipt}
        emptyText="No sales invoices yet."
        searchPlaceholder="Search sales invoices..."
        actionLabel="New Sales Invoice"
        onAction={() => navigate("/sales/invoices/new", { state: { fromTab: "invoices" } })}
        onRowClick={(r) => navigate(`/sales/invoices/${r.id}`, { state: { fromTab: "invoices" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

function CreditNotesTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<CreditNote>("/api/credit-notes");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("sales.return.create");

  const columns: Column<CreditNote>[] = [
    { key: "number", header: "CN #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "invoice", header: "Original Invoice", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.original_invoice_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en ?? "Walk-in" },
    { key: "date", header: "Date", render: (r) => new Date(r.credit_note_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => Number(r.gross_amount).toFixed(2), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/credit-notes/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.original_invoice_number}`}
        emptyIcon={RotateCcw}
        emptyText="No credit notes yet."
        searchPlaceholder="Search credit notes..."
        actionLabel="New Credit Note"
        onAction={() => navigate("/sales/credit-notes/new", { state: { fromTab: "credits" } })}
        onRowClick={(r) => navigate(`/sales/credit-notes/${r.id}`, { state: { fromTab: "credits" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

interface SalesQuotation {
  id: string;
  document_number: string;
  quotation_date: string;
  valid_until: string | null;
  document_status: string;
  gross_amount: string;
  rejection_reason: string | null;
  customer_name_en: string;
  customer_name_ar: string;
  created_by_email: string | null;
}

interface SalesQuotationLine {
  id: string;
  item_variant_id: string;
  variant_code: string;
  item_description: string;
  qty: string;
  unit_price: string;
  net_amount: string;
  vat_amount: string;
  gross_amount: string;
}

interface SalesQuotationDetail {
  id: string;
  document_number: string;
  store_id: string;
  customer_id: string;
  quotation_date: string;
  valid_until: string | null;
  notes: string | null;
  document_status: string;
  net_amount: string;
  vat_amount: string;
  gross_amount: string;
  rejection_reason: string | null;
  created_by_email: string | null;
  sales_invoice_id: string | null;
  lines: SalesQuotationLine[];
}

export function NewQuotationForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const { data: taxCodes } = useApiList<TaxCodeOption>("/api/tax-codes");
  const variantOptions = useVariantOptions();

  const [storeId, setStoreId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [priceListItems, setPriceListItems] = useState<PriceListItem[] | null>(null);
  const [quotationDate, setQuotationDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InvoiceLineDraft[]>([
    { itemVariantId: "", itemDescription: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!priceListId || !token || !companyId) {
      setPriceListItems(null);
      return;
    }
    apiRequest<PriceListItem[]>(`/api/price-lists/${priceListId}/items`, { token, companyId }).then(setPriceListItems);
  }, [priceListId, token, companyId]);

  const totalGross = Math.round(
    lines.reduce((s, l) => {
      const net = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
      const vat = Number(l.vatRate) || 0;
      return s + (l.priceIncludesVat ? net : net * (1 + vat / 100));
    }, 0) * 100,
  ) / 100;

  function updateLine(index: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        if (patch.itemVariantId !== undefined) {
          const variant = variantOptions.find((v) => v.id === patch.itemVariantId);
          next.itemDescription = variant?.itemName ?? "";
          const priceEntry = priceListItems?.find((pi) => pi.item_variant_id === patch.itemVariantId);
          const list = priceLists?.find((pl) => pl.id === priceListId);
          if (priceEntry) {
            next.unitPrice = priceEntry.price;
            next.priceIncludesVat = list?.price_includes_vat ?? next.priceIncludesVat;
          }
          const taxCode = taxCodes?.find((t) => t.id === list?.default_tax_code_id);
          if (taxCode) next.vatRate = taxCode.rate;
        }
        return next;
      }),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, { itemVariantId: "", itemDescription: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false }]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/sales-quotations", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          customerId,
          priceListId: priceListId || null,
          quotationDate,
          validUntil: validUntil || null,
          notes: notes || null,
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
        },
      });
      await apiRequest(`/api/sales-quotations/${created.id}/send`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create quotation");
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
        <Field label="Customer" required>
          <SelectInput
            required
            value={customerId}
            onChange={(e) => {
              const newCustomerId = e.target.value;
              setCustomerId(newCustomerId);
              const customer = customers?.find((c) => c.id === newCustomerId);
              if (customer?.default_price_list_id && !priceListId) {
                setPriceListId(customer.default_price_list_id);
              }
            }}
          >
            <option value="">Select...</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
        <Field label="Valid Until">
          <TextInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
      <Field label="Quotation Date" required>
        <TextInput type="date" required value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />
      </Field>
      <Field label="Notes">
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SelectInput value={line.itemVariantId} onChange={(e) => updateLine(i, { itemVariantId: e.target.value })} className="min-w-0 flex-1">
                <option value="">Item variant...</option>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </SelectInput>
              <button type="button" onClick={() => removeLine(i)} className="shrink-0 rounded p-1.5 text-slate-400 dark:text-slate-500 hover:bg-red-50 hover:text-red-500">
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
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={line.priceIncludesVat} onChange={(e) => updateLine(i, { priceIncludesVat: e.target.checked })} />
              Price includes VAT
            </label>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <Plus size={14} /> Add line
      </button>

      <div className="mt-3 rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">Total: {totalGross.toFixed(2)}</div>

      <FormActions error={error} submitting={submitting} submitLabel="Create & Send Quotation" />
    </form>
  );
}

function ConvertQuotationForm({ quotation, onClose, onConverted }: { quotation: SalesQuotationDetail; onClose: () => void; onConverted: (invoiceId: string) => void }) {
  const { token, companyId } = useAuth();
  const openPeriods = useOpenPeriods();
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiRequest<{ salesInvoiceId: string }>(`/api/sales-quotations/${quotation.id}/convert`, {
        method: "POST",
        token,
        companyId,
        body: { invoiceDate, fiscalPeriodId },
      });
      onConverted(result.salesInvoiceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to convert quotation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
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
      <FormActions error={error} submitting={submitting} submitLabel="Create & Post Invoice" />
      <button type="button" onClick={onClose} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
        Cancel
      </button>
    </form>
  );
}

function useOpenPeriods() {
  const { data } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  return data?.filter((p) => p.status === "open") ?? [];
}

export function QuotationDetailModal({ quotationId, onChanged }: { quotationId: string; onChanged: () => void }) {
  const { token, companyId, hasPermission, me } = useAuth();
  const [detail, setDetail] = useState<SalesQuotationDetail | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const d = await apiRequest<SalesQuotationDetail>(`/api/sales-quotations/${quotationId}`, { token, companyId });
    setDetail(d);
  }

  useEffect(() => {
    if (!token || !companyId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId, token, companyId]);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/sales-quotations/${quotationId}/accept`, { method: "POST", token, companyId });
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to accept");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/sales-quotations/${quotationId}/withdraw`, { method: "POST", token, companyId });
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
      await apiRequest(`/api/sales-quotations/${quotationId}/reject`, {
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

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  const isOwnQuotation = me?.user.email === detail.created_by_email;
  const canDecide = hasPermission("sales.quotation.decide");
  const canConvert = hasPermission("sales.wholesale_invoice.create");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            created by {detail.created_by_email ?? "—"}
            {detail.valid_until && <span className="text-slate-400 dark:text-slate-500"> · valid until {new Date(detail.valid_until).toLocaleDateString()}</span>}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {detail.notes && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{detail.notes}</p>}
      {detail.document_status === "rejected" && detail.rejection_reason && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">Rejected: {detail.rejection_reason}</p>
      )}

      <div className="mb-3 space-y-1 border-y border-dashed border-slate-200 dark:border-slate-700 py-2 text-sm">
        {detail.lines.map((l) => (
          <div key={l.id} className="flex justify-between">
            <span className="text-slate-600 dark:text-slate-300">
              {l.item_description} × {l.qty}
            </span>
            <span className="tabular-nums">{Number(l.gross_amount).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="mb-3 flex justify-between text-base font-semibold text-slate-900 dark:text-slate-100">
        <span>Total</span>
        <span className="tabular-nums">{Number(detail.gross_amount).toFixed(2)}</span>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {detail.document_status === "sent" && !showReject && (
        <div className="flex flex-wrap gap-2">
          {canDecide && (
            <>
              <button onClick={accept} disabled={busy} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
                {busy ? "Working..." : "Mark Accepted"}
              </button>
              <button onClick={() => setShowReject(true)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                Mark Rejected
              </button>
            </>
          )}
          {isOwnQuotation && (
            <button onClick={withdraw} disabled={busy} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              {busy ? "Working..." : "Withdraw"}
            </button>
          )}
        </div>
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
            <button type="button" onClick={() => setShowReject(false)} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      {detail.document_status === "accepted" && canConvert && !showConvert && (
        <button onClick={() => setShowConvert(true)} className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600">
          Convert to Sales Invoice
        </button>
      )}
      {showConvert && (
        <ConvertQuotationForm
          quotation={detail}
          onClose={() => setShowConvert(false)}
          onConverted={async () => {
            setShowConvert(false);
            await reload();
            onChanged();
          }}
        />
      )}
      {detail.document_status === "converted_to_invoice" && <p className="text-xs text-slate-400 dark:text-slate-500">Already converted into a sales invoice.</p>}
    </div>
  );
}

function QuotationsTab() {
  const navigate = useNavigate();
  const { data, error } = useApiList<SalesQuotation>("/api/sales-quotations");

  const columns: Column<SalesQuotation>[] = [
    { key: "number", header: "Quotation #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.quotation_date).toLocaleDateString() },
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
        getSearchText={(r) => `${r.document_number} ${r.customer_name_en}`}
        emptyIcon={FileText}
        emptyText="No sales quotations yet."
        searchPlaceholder="Search quotations..."
        actionLabel="New Quotation"
        onAction={() => navigate("/sales/quotations/new", { state: { fromTab: "quotations" } })}
        onRowClick={(r) => navigate(`/sales/quotations/${r.id}`, { state: { fromTab: "quotations" } })}
      />
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
  default_tax_code_id: string | null;
}

interface TaxCodeOption {
  id: string;
  code: string;
  name_en: string;
  rate: string;
}

function NewPriceListForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: taxCodes } = useApiList<TaxCodeOption>("/api/tax-codes");
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [priceIncludesVat, setPriceIncludesVat] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState("");
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
        body: { code, nameEn, nameAr, currency, priceIncludesVat, isDefault, defaultTaxCodeId: defaultTaxCodeId || null },
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" required>
          <TextInput required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Default Tax Code">
          <SelectInput value={defaultTaxCodeId} onChange={(e) => setDefaultTaxCodeId(e.target.value)}>
            <option value="">None</option>
            {taxCodes?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name_en} ({Number(t.rate).toFixed(0)}%)
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={priceIncludesVat} onChange={(e) => setPriceIncludesVat(e.target.checked)} />
        Prices include VAT
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Make this the default price list
      </label>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Only one price list can be default per company — making this one default clears the current default.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Price List" />
    </form>
  );
}

function PriceListDetail({ list, onChanged }: { list: PriceListRow; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: prices, reload } = useApiList<PriceListItem>(`/api/price-lists/${list.id}/items`);
  const { data: taxCodes } = useApiList<TaxCodeOption>("/api/tax-codes");
  const variantOptions = useVariantOptions();
  const [itemVariantId, setItemVariantId] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);
  const [taxCodeDraft, setTaxCodeDraft] = useState(list.default_tax_code_id ?? "");
  const [savingTaxCode, setSavingTaxCode] = useState(false);

  const variantLabel = (id: string) => variantOptions.find((v) => v.id === id)?.label ?? id;

  async function saveTaxCode() {
    setSavingTaxCode(true);
    try {
      await apiRequest(`/api/price-lists/${list.id}/tax-code`, {
        method: "POST",
        token,
        companyId,
        body: { defaultTaxCodeId: taxCodeDraft || null },
      });
      onChanged();
    } finally {
      setSavingTaxCode(false);
    }
  }

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
      <div className="mb-4 flex items-end gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
        <div className="min-w-0 flex-1">
          <Field label="Default Tax Code">
            <SelectInput value={taxCodeDraft} onChange={(e) => setTaxCodeDraft(e.target.value)}>
              <option value="">None</option>
              {taxCodes?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_en} ({Number(t.rate).toFixed(0)}%)
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <button
          onClick={saveTaxCode}
          disabled={savingTaxCode || taxCodeDraft === (list.default_tax_code_id ?? "")}
          className="mb-3 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          {savingTaxCode ? "Saving..." : "Save"}
        </button>
      </div>
      <form onSubmit={setLinePrice} className="mb-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
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

      {prices && prices.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No prices set on this list yet.</p>}
      <div className="space-y-1.5">
        {prices?.map((p) => (
          <div key={p.item_variant_id} className="flex items-center justify-between rounded-md border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
            <span className="text-slate-700 dark:text-slate-200">{variantLabel(p.item_variant_id)}</span>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{Number(p.price).toFixed(2)}</span>
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
  const { data: taxCodes } = useApiList<TaxCodeOption>("/api/tax-codes");
  const taxCodeLabel = (id: string | null) => {
    if (!id) return "—";
    const t = taxCodes?.find((tc) => tc.id === id);
    return t ? `${t.code} (${Number(t.rate).toFixed(0)}%)` : "—";
  };
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
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.name_en}</span> },
    { key: "currency", header: "Currency", render: (r) => r.currency },
    { key: "vat", header: "VAT", render: (r) => (r.price_includes_vat ? "Inclusive" : "Exclusive") },
    { key: "tax_code", header: "Tax Code", render: (r) => taxCodeLabel(r.default_tax_code_id) },
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

interface GiftCard {
  id: string;
  card_number: string;
  initial_value: string;
  balance: string;
  status: string;
  issued_at: string;
  expires_at: string | null;
  store_name_en: string;
  customer_name_en: string | null;
  customer_name_ar: string | null;
}

interface GiftCardTransaction {
  id: string;
  transaction_type: string;
  amount: string;
  balance_after: string;
  sales_invoice_number: string | null;
  created_at: string;
}

interface GiftCardDetail extends GiftCard {
  transactions: GiftCardTransaction[];
}

function IssueGiftCardForm({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriodId = periods?.find((p) => p.status === "open")?.id ?? "";

  const [storeId, setStoreId] = useState("");
  const [cardNumber, setCardNumber] = useState(() => `GC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`);
  const [initialValue, setInitialValue] = useState("100");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [customerId, setCustomerId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/gift-cards", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          cardNumber,
          initialValue: Number(initialValue),
          paymentMethod,
          customerId: customerId || null,
          expiresAt: expiresAt || null,
          fiscalPeriodId: openPeriodId,
          issueDate,
        },
      });
      onIssued();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to issue gift card");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Card Number" required>
          <TextInput required value={cardNumber} onChange={(e) => setCardNumber(e.target.value.toUpperCase())} />
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
        <Field label="Value" required>
          <TextInput required type="number" min={0.01} step="0.01" value={initialValue} onChange={(e) => setInitialValue(e.target.value)} />
        </Field>
        <Field label="Tendered As" required>
          <SelectInput required value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "card")}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Issue Date" required>
          <TextInput required type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field label="Expires">
          <TextInput type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </div>
      <Field label="Customer (optional)">
        <SelectInput value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Not tied to a customer</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      {!openPeriodId && <p className="mb-2 text-xs text-red-600">No open fiscal period — cannot issue right now.</p>}
      <p className="mb-3 mt-2 text-xs text-slate-400 dark:text-slate-500">
        Books Dr {paymentMethod} / Cr Gift Card Liability — a gift card sale is not revenue until the card is redeemed against a real sale.
      </p>
      <FormActions error={error} submitting={submitting || !openPeriodId} submitLabel="Issue Gift Card" />
    </form>
  );
}

function GiftCardDetailModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<GiftCardDetail | null>(null);

  useEffect(() => {
    apiRequest<GiftCardDetail>(`/api/gift-cards/${cardId}`, { token, companyId }).then(setDetail);
  }, [cardId, token, companyId]);

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-sm text-slate-900 dark:text-slate-100">{detail.card_number}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {detail.store_name_en}
            {detail.customer_name_en && ` · ${detail.customer_name_en}`}
          </div>
        </div>
        <StatusBadge status={detail.status} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2 text-sm">
        <div>
          <div className="text-xs text-slate-400 dark:text-slate-500">Initial Value</div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{Number(detail.initial_value).toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400 dark:text-slate-500">Current Balance</div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{Number(detail.balance).toFixed(2)}</div>
        </div>
      </div>
      <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Transaction History</div>
      <div className="space-y-1">
        {detail.transactions.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-sm">
            <div>
              <span className="capitalize text-slate-700 dark:text-slate-200">{t.transaction_type}</span>
              {t.sales_invoice_number && <span className="ms-1.5 text-xs text-slate-400 dark:text-slate-500">({t.sales_invoice_number})</span>}
            </div>
            <span className={`tabular-nums font-medium ${Number(t.amount) < 0 ? "text-red-600" : "text-green-600"}`}>
              {Number(t.amount) > 0 ? "+" : ""}
              {Number(t.amount).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GiftCardsTab() {
  const { hasPermission } = useAuth();
  const { data, error, reload } = useApiList<GiftCard>("/api/gift-cards");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const columns: Column<GiftCard>[] = [
    { key: "number", header: "Card #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.card_number}</span> },
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en ?? "—" },
    { key: "initial", header: "Initial Value", render: (r) => Number(r.initial_value).toFixed(2), numeric: true },
    { key: "balance", header: "Balance", render: (r) => Number(r.balance).toFixed(2), numeric: true },
    { key: "issued", header: "Issued", render: (r) => new Date(r.issued_at).toLocaleDateString() },
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
        getSearchText={(r) => `${r.card_number} ${r.customer_name_en ?? ""}`}
        emptyIcon={Tag}
        emptyText="No gift cards issued yet."
        searchPlaceholder="Search gift cards..."
        actionLabel={hasPermission("sales.gift_card.issue") ? "Issue Gift Card" : undefined}
        onAction={hasPermission("sales.gift_card.issue") ? () => setShowNew(true) : undefined}
        onRowClick={(r) => setDetailId(r.id)}
      />
      {showNew && (
        <Modal title="Issue Gift Card" onClose={() => setShowNew(false)}>
          <IssueGiftCardForm onClose={() => setShowNew(false)} onIssued={reload} />
        </Modal>
      )}
      {detailId && (
        <Modal title="Gift Card" onClose={() => setDetailId(null)}>
          <GiftCardDetailModal cardId={detailId} onClose={() => setDetailId(null)} />
        </Modal>
      )}
    </>
  );
}

interface CustomerDeposit {
  id: string;
  document_number: string;
  reference: string | null;
  initial_value: string;
  balance: string;
  status: string;
  deposit_date: string;
  store_name_en: string;
  customer_name_en: string;
  customer_name_ar: string;
}

interface CustomerDepositTransaction {
  id: string;
  transaction_type: string;
  amount: string;
  balance_after: string;
  sales_invoice_number: string | null;
  created_at: string;
}

interface CustomerDepositDetail extends CustomerDeposit {
  transactions: CustomerDepositTransaction[];
}

function RecordDepositForm({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriodId = periods?.find((p) => p.status === "open")?.id ?? "";

  const [storeId, setStoreId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("100");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [reference, setReference] = useState("");
  const [depositDate, setDepositDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/customer-deposits", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          customerId,
          amount: Number(amount),
          paymentMethod,
          reference: reference || null,
          fiscalPeriodId: openPeriodId,
          depositDate,
        },
      });
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record deposit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer" required>
          <SelectInput required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select...</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
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
        <Field label="Amount" required>
          <TextInput required type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Received As" required>
          <SelectInput required value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "card")}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </SelectInput>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required>
          <TextInput required type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
        </Field>
        <Field label="Reference">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. custom order #123" />
        </Field>
      </div>
      {!openPeriodId && <p className="mb-2 text-xs text-red-600">No open fiscal period — cannot record right now.</p>}
      <p className="mb-3 mt-2 text-xs text-slate-400 dark:text-slate-500">
        Books Dr {paymentMethod} / Cr Customer Deposits — a deposit is not revenue until it's applied to a real sale.
      </p>
      <FormActions error={error} submitting={submitting || !openPeriodId} submitLabel="Record Deposit" />
    </form>
  );
}

function CustomerDepositDetailModal({ depositId, onClose }: { depositId: string; onClose: () => void }) {
  const { token, companyId } = useAuth();
  const [detail, setDetail] = useState<CustomerDepositDetail | null>(null);

  useEffect(() => {
    apiRequest<CustomerDepositDetail>(`/api/customer-deposits/${depositId}`, { token, companyId }).then(setDetail);
  }, [depositId, token, companyId]);

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-sm text-slate-900 dark:text-slate-100">{detail.document_number}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {detail.store_name_en} · {detail.customer_name_en}
            {detail.reference && ` · ${detail.reference}`}
          </div>
        </div>
        <StatusBadge status={detail.status} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2 text-sm">
        <div>
          <div className="text-xs text-slate-400 dark:text-slate-500">Initial Value</div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{Number(detail.initial_value).toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400 dark:text-slate-500">Current Balance</div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{Number(detail.balance).toFixed(2)}</div>
        </div>
      </div>
      <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Transaction History</div>
      <div className="space-y-1">
        {detail.transactions.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-sm">
            <div>
              <span className="capitalize text-slate-700 dark:text-slate-200">{t.transaction_type}</span>
              {t.sales_invoice_number && <span className="ms-1.5 text-xs text-slate-400 dark:text-slate-500">({t.sales_invoice_number})</span>}
            </div>
            <span className={`tabular-nums font-medium ${Number(t.amount) < 0 ? "text-red-600" : "text-green-600"}`}>
              {Number(t.amount) > 0 ? "+" : ""}
              {Number(t.amount).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerDepositsTab() {
  const { hasPermission } = useAuth();
  const { data, error, reload } = useApiList<CustomerDeposit>("/api/customer-deposits");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const columns: Column<CustomerDeposit>[] = [
    { key: "number", header: "Deposit #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "customer", header: "Customer", render: (r) => r.customer_name_en },
    { key: "reference", header: "Reference", render: (r) => r.reference ?? "—" },
    { key: "initial", header: "Initial Value", render: (r) => Number(r.initial_value).toFixed(2), numeric: true },
    { key: "balance", header: "Balance", render: (r) => Number(r.balance).toFixed(2), numeric: true },
    { key: "date", header: "Date", render: (r) => new Date(r.deposit_date).toLocaleDateString() },
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
        getSearchText={(r) => `${r.document_number} ${r.customer_name_en} ${r.reference ?? ""}`}
        emptyIcon={Wallet}
        emptyText="No customer deposits yet."
        searchPlaceholder="Search deposits..."
        actionLabel={hasPermission("sales.deposit.record") ? "Record Deposit" : undefined}
        onAction={hasPermission("sales.deposit.record") ? () => setShowNew(true) : undefined}
        onRowClick={(r) => setDetailId(r.id)}
      />
      {showNew && (
        <Modal title="Record Customer Deposit" onClose={() => setShowNew(false)}>
          <RecordDepositForm onClose={() => setShowNew(false)} onRecorded={reload} />
        </Modal>
      )}
      {detailId && (
        <Modal title="Customer Deposit" onClose={() => setDetailId(null)}>
          <CustomerDepositDetailModal depositId={detailId} onClose={() => setDetailId(null)} />
        </Modal>
      )}
    </>
  );
}

export default function Sales() {
  const { t } = useTranslation();
  const location = useLocation();
  const tabs = useMemo(
    () => [
      { key: "quotations", label: "Quotations", content: <QuotationsTab /> },
      { key: "invoices", label: "Sales Invoices", content: <SalesInvoicesTab /> },
      { key: "credits", label: "Credit Notes", content: <CreditNotesTab /> },
      { key: "gift-cards", label: "Gift Cards", content: <GiftCardsTab /> },
      { key: "deposits", label: "Customer Deposits", content: <CustomerDepositsTab /> },
      { key: "price-lists", label: "Price Lists", content: <PriceListsTab /> },
    ],
    [],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">{t("nav.sales")}</h1>
      <Tabs tabs={tabs} initialActive={(location.state as { fromTab?: string } | null)?.fromTab} hideHeader />
    </div>
  );
}
