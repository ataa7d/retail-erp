import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingCart, Truck, Plus, Trash2, PackageCheck, ReceiptText, ClipboardList, Undo2, Download, Upload } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError, uploadFile } from "../lib/api";
import { runBulkAction } from "../lib/bulkAction";
import { exportToCsv } from "../lib/csvExport";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import StatusStepper from "../components/StatusStepper";
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

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  barcodes?: Array<{ barcode: string }> | null;
}

interface Item {
  name_en: string;
  variants: ItemVariant[];
}

// Same barcode -> variant lookup pattern as POS.tsx's handleSearchKeyDown --
// built once from the already-loaded item catalog, no server round trip per
// scan, so it works exactly as fast whether it's the 1st or 1000th unit.
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
  supplier_id: string;
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

interface SupplierCreditNote {
  id: string;
  document_number: string;
  credit_note_date: string;
  document_status: string;
  reason: string;
  gross_amount: string;
  invoice_document_number: string;
  supplier_name_en: string;
  supplier_name_ar: string;
}

interface SupplierCreditNoteLine {
  id: string;
  item_variant_id: string;
  qty: string;
  unit_price: string;
  gross_amount: string;
  variant_code: string;
  item_name_en: string;
}

interface SupplierCreditNoteDetail extends SupplierCreditNote {
  net_amount: string;
  vat_amount: string;
  lines: SupplierCreditNoteLine[];
}

interface ReturnableLine {
  source_line_id: string;
  item_variant_id: string;
  variant_code: string;
  item_name_en: string;
  invoiced_qty: string;
  unit_price: string;
  discount_amount: string;
  vat_rate: string;
  price_includes_vat: boolean;
  returnable_qty: string;
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
  const { data: items, reload } = useApiList<Item>("/api/items");
  const options: Array<{ id: string; label: string }> = [];
  for (const item of items ?? []) {
    for (const v of item.variants) {
      const detail = [v.color, v.size].filter(Boolean).join(" / ");
      options.push({ id: v.id, label: `${item.name_en} — ${v.variant_code}${detail ? ` (${detail})` : ""}` });
    }
  }
  return { options, reload };
}

interface UnitOfMeasure {
  id: string;
  code: string;
  name_en: string;
}

interface Brand {
  id: string;
  code: string;
  name_en: string;
}

interface Category {
  id: string;
  code: string;
  name_en: string;
}

// Adding a brand-new item without leaving the PO screen: creates the item +
// variant + an auto-generated internal barcode in one call (POST
// /items/quick-add), then hands the new variant id back so the caller can
// drop it straight into a PO line -- no separate trip to the Items screen.
function QuickAddItemModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (variant: { id: string; label: string }) => void;
}) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const { data: brands } = useApiList<Brand>("/api/brands");
  const { data: categories } = useApiList<Category>("/api/categories");
  const [itemCode, setItemCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [baseUnitOfMeasureId, setBaseUnitOfMeasureId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [variantCode, setVariantCode] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [standardCost, setStandardCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiRequest<{ itemId: string; itemCode: string; variantId: string; internalBarcode: string }>("/api/items/quick-add", {
        method: "POST",
        token,
        companyId,
        body: {
          itemCode: itemCode || null,
          nameEn,
          nameAr,
          baseUnitOfMeasureId,
          brandId: brandId || null,
          categoryId: categoryId || null,
          variantCode,
          color: color || null,
          size: size || null,
          standardCost: standardCost ? Number(standardCost) : null,
        },
      });
      const detail = [color, size].filter(Boolean).join(" / ");
      onCreated({ id: result.variantId, label: `${nameEn} — ${variantCode}${detail ? ` (${detail})` : ""}` });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New Item" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Item Code">
          <TextInput value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Auto-generated if left blank" />
        </Field>
        <Field label="Name (English)" required>
          <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="Name (Arabic)" required>
          <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label="Base Unit" required>
          <SelectInput required value={baseUnitOfMeasureId} onChange={(e) => setBaseUnitOfMeasureId(e.target.value)}>
            <option value="">Select...</option>
            {units?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name_en} ({u.code})
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand">
            <SelectInput value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">None</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_en}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Category">
            <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field label="Variant Code" required>
          <TextInput required value={variantCode} onChange={(e) => setVariantCode(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Color">
            <TextInput value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label="Size">
            <TextInput value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
          <Field label="Standard Cost">
            <TextInput type="number" min={0} step="0.01" value={standardCost} onChange={(e) => setStandardCost(e.target.value)} />
          </Field>
        </div>
        <p className="mb-3 mt-2 text-xs text-slate-400 dark:text-slate-500">
          An internal barcode is generated automatically — no need to enter one. This has no GL impact by itself.
        </p>
        <FormActions error={error} submitting={submitting} submitLabel="Create Item" />
      </form>
    </Modal>
  );
}

export interface PoFormInitial {
  supplierId: string;
  storeId: string;
  lines: PoLineDraft[];
}

// Minimal RFC4180-ish parser (quoted fields, escaped "" inside quotes) --
// good enough for a spreadsheet export, no dependency needed for something
// this small. Used only to recover the two PO-specific columns
// (order_qty, order_vat_rate) that POST /items/bulk-import has no reason
// to know about, since item creation and "how much of this to order" are
// different concerns -- the same file is parsed here purely to read those
// two extra columns back out, keyed by item_code + variant_code so they
// can be matched against the item-creation endpoint's own per-row results.
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const PO_UPLOAD_TEMPLATE_HEADER = [
  "item_code", "name_en", "name_ar", "brand_code", "category_code", "season_code", "item_year",
  "material", "country_of_origin", "supplier_style_number", "base_unit_code", "default_tax_code",
  "variant_code", "color", "size", "barcode", "standard_cost", "weight_kg", "reorder_point",
  "order_qty", "order_vat_rate",
];

// item_code left blank on purpose -- the example is meant to show what a
// quick, minimal-effort row looks like (code and barcode both generated by
// the system); a real catalog with its own coding convention can still
// fill item_code in and it's respected exactly as given.
const PO_UPLOAD_TEMPLATE_EXAMPLE = [
  "", "Basic Tee", "تيشيرت أساسي", "GEN", "APPAREL", "SS26", "2026",
  "100% Cotton", "Bangladesh", "SUP-001", "PC", "VAT15",
  "IT-1001-BLK-M", "Black", "M", "", "15.00", "0.200", "10",
  "100", "15",
];

function downloadPoUploadTemplate() {
  const csv = `${PO_UPLOAD_TEMPLATE_HEADER.join(",")}\n${PO_UPLOAD_TEMPLATE_EXAMPLE.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "po_new_items_template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface PoUploadRowResult {
  row: number;
  itemCode: string;
  variantCode: string;
  status: "created" | "error";
  message?: string;
  internalBarcode?: string;
  variantId?: string;
}

// Creates every new item/variant in the file (reusing the exact same
// POST /items/bulk-import the Items screen's own bulk import uses -- same
// validation, same auto-barcode generation, same "adds a variant to an
// existing item_code instead of erroring" behavior), then turns every row
// that succeeded straight into a PO line using that row's own order_qty /
// standard_cost / order_vat_rate, so one upload takes you from "a
// spreadsheet of items I need to order" to a reviewable PO draft in one
// step -- no separate trip to add each one to the order afterward.
function BulkUploadItemsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (lines: PoLineDraft[], options: Array<{ id: string; label: string }>) => void;
}) {
  const { token, companyId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<{ created: number; failed: number; results: PoUploadRowResult[] } | null>(null);

  async function handleUpload() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setError(null);
    setUploading(true);
    setSummary(null);
    try {
      const [rows, result] = await Promise.all([
        file.text().then(parseCsv),
        uploadFile<{ totalRows: number; created: number; failed: number; results: PoUploadRowResult[] }>(
          "/api/items/bulk-import",
          file,
          { token, companyId },
        ),
      ]);
      setSummary(result);

      const byKey = new Map(rows.map((r) => [`${r.item_code}::${r.variant_code}`, r]));
      const newLines: PoLineDraft[] = [];
      const newOptions: Array<{ id: string; label: string }> = [];
      for (const r of result.results) {
        if (r.status !== "created" || !r.variantId) continue;
        const csvRow = byKey.get(`${r.itemCode}::${r.variantCode}`);
        newLines.push({
          itemVariantId: r.variantId,
          qty: csvRow?.order_qty || "1",
          unitPrice: csvRow?.standard_cost || "0",
          vatRate: csvRow?.order_vat_rate || "15",
          priceIncludesVat: false,
        });
        const detail = [csvRow?.color, csvRow?.size].filter(Boolean).join(" / ");
        newOptions.push({ id: r.variantId, label: `${csvRow?.name_en ?? r.itemCode} — ${r.variantCode}${detail ? ` (${detail})` : ""}` });
      }
      if (newLines.length > 0) onImported(newLines, newOptions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to import file");
    } finally {
      setUploading(false);
    }
  }

  const failedRows = summary?.results.filter((r) => r.status === "error") ?? [];

  return (
    <Modal title="Bulk Upload New Items" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Upload a CSV of new items to create them and add each one straight into this PO's lines, using the file's own
        order_qty and standard_cost. Leave item_code and barcode blank and the system generates both — variant_code and
        name_en are still required; a blank name_ar falls back to name_en so a sheet that hasn't been translated yet
        isn't blocked.
      </p>
      <button
        type="button"
        onClick={downloadPoUploadTemplate}
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <Download size={14} /> Download CSV template
      </button>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mb-3 block w-full text-sm text-slate-600 dark:text-slate-300"
      />
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <button
        type="button"
        onClick={handleUpload}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        <Upload size={14} /> {uploading ? "Uploading..." : "Upload & Add to PO"}
      </button>
      {summary && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-slate-700 dark:text-slate-200">
            {summary.created} item{summary.created === 1 ? "" : "s"} created and added to the PO
            {summary.failed > 0 ? `, ${summary.failed} row${summary.failed === 1 ? "" : "s"} failed` : ""}.
          </p>
          {failedRows.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-red-100 bg-red-50 p-2 text-xs text-red-700">
              {failedRows.map((r) => (
                <div key={r.row}>
                  Row {r.row} ({r.itemCode || "?"}/{r.variantCode || "?"}): {r.message}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

export function NewPurchaseOrderForm({
  onClose,
  onCreated,
  initial,
}: {
  onClose: () => void;
  onCreated: () => void;
  initial?: PoFormInitial;
}) {
  const { token, companyId } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { data: suppliers } = useApiList<Supplier>("/api/suppliers");
  const { data: stores } = useApiList<Store>("/api/stores");
  const { options: variantOptions, reload: reloadVariants } = useVariantOptions();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [storeId, setStoreId] = useState(initial?.storeId ?? "");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [exchangeRate, setExchangeRate] = useState("1");
  const [lines, setLines] = useState<PoLineDraft[]>(
    initial?.lines ?? [{ itemVariantId: "", qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false }],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [supplierPrices, setSupplierPrices] = useState<SupplierItemPrice[] | null>(null);
  const [extraVariantOptions, setExtraVariantOptions] = useState<Array<{ id: string; label: string }>>([]);
  const allVariantOptions = [...variantOptions, ...extraVariantOptions.filter((e) => !variantOptions.some((v) => v.id === e.id))];

  useEffect(() => {
    if (!supplierId || !token || !companyId) {
      setSupplierPrices(null);
      return;
    }
    apiRequest<SupplierItemPrice[]>(`/api/supplier-item-prices?supplierId=${supplierId}`, { token, companyId }).then(setSupplierPrices);
  }, [supplierId, token, companyId]);

  // Pre-filled from reorder suggestions: the supplier picker's own
  // onChange (selectSupplier) never fires for an initial value, so its
  // currency default has to be applied separately once the supplier list
  // has loaded.
  useEffect(() => {
    if (!initial?.supplierId || !suppliers) return;
    const supplier = suppliers.find((s) => s.id === initial.supplierId);
    if (supplier) setCurrency(supplier.currency);
  }, [suppliers]);

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
    <>
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

      <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines</div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SelectInput value={line.itemVariantId} onChange={(e) => updateLine(i, { itemVariantId: e.target.value })} className="min-w-0 flex-1">
                <option value="">Item variant...</option>
                {allVariantOptions.map((v) => (
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
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={addLine} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          <Plus size={14} /> Add line
        </button>
        <button type="button" onClick={() => setShowQuickAdd(true)} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          <Plus size={14} /> New item
        </button>
        <button type="button" onClick={() => setShowBulkUpload(true)} className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          <Upload size={14} /> Bulk upload items
        </button>
      </div>
      <div className="mt-3 rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        Estimated Total: {formatMoney(totalGross, currency)}
      </div>

      <p className="mb-3 mt-2 text-xs text-slate-400 dark:text-slate-500">
        Purchase orders don't post a GL journal — they're a commitment, not a financial transaction. Posting here approves and locks it for receiving.
        {currency !== baseCurrency && " Lines above are priced in the order's own currency."}
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Approve PO" />
    </form>
    {showQuickAdd && (
      <QuickAddItemModal
        onClose={() => setShowQuickAdd(false)}
        onCreated={(variant) => {
          setExtraVariantOptions((prev) => [...prev, variant]);
          reloadVariants();
          setLines((prev) => {
            const emptyIndex = prev.findIndex((l) => !l.itemVariantId);
            if (emptyIndex >= 0) {
              return prev.map((l, i) => (i === emptyIndex ? { ...l, itemVariantId: variant.id } : l));
            }
            return [...prev, { itemVariantId: variant.id, qty: "1", unitPrice: "0", vatRate: "15", priceIncludesVat: false }];
          });
        }}
      />
    )}
    {showBulkUpload && (
      <BulkUploadItemsModal
        onClose={() => setShowBulkUpload(false)}
        onImported={(newLines, newOptions) => {
          setExtraVariantOptions((prev) => [...prev, ...newOptions]);
          reloadVariants();
          setLines((prev) => {
            const withoutBlankStarter = prev.filter((l) => l.itemVariantId);
            return [...withoutBlankStarter, ...newLines];
          });
        }}
      />
    )}
    </>
  );
}

export function NewGoodsReceiptForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: purchaseOrders } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const postedPOs = purchaseOrders?.filter((po) => po.document_status === "posted") ?? [];

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [poDetail, setPoDetail] = useState<PoDetail | null>(null);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [exchangeRate, setExchangeRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseCurrency = useBaseCurrency();
  const barcodeMap = useBarcodeMap();
  const [scanValue, setScanValue] = useState("");
  const [hasScanned, setHasScanned] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
      setHasScanned(false);
      setScanMessage(null);
    });
  }, [purchaseOrderId, token, companyId]);

  // Scanning starts a shipment count from zero -- the manual quantity
  // fields default to "assume everything ordered arrived" for typed partial
  // adjustments, but that default is the wrong starting point once you're
  // physically counting units by scanning them one by one, so the first
  // scan on a PO zeroes every line and counts up from there. Strictly
  // matched against this PO: an unrecognized barcode or one that isn't on
  // this order is rejected outright rather than silently over-receiving.
  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !poDetail) return;
    const trimmed = scanValue.trim();
    if (!trimmed) return;
    setScanValue("");

    const found = barcodeMap.get(trimmed);
    if (!found) {
      setScanMessage({ type: "error", text: `Barcode "${trimmed}" is not recognized.` });
      return;
    }
    const line = poDetail.lines.find((l) => l.item_variant_id === found.variantId);
    if (!line) {
      setScanMessage({ type: "error", text: `${found.label} is not on this purchase order — can't receive items that weren't ordered.` });
      return;
    }
    const remaining = Number(line.qty) - Number(line.received_qty);
    const base = hasScanned ? qtyByLine : Object.fromEntries(poDetail.lines.map((l) => [l.id, "0"]));
    const current = Number(base[line.id] ?? "0");
    if (current >= remaining) {
      setQtyByLine(base);
      setHasScanned(true);
      setScanMessage({ type: "error", text: `${found.label}: already at the ordered quantity (${line.qty}) — can't receive more than was ordered.` });
      return;
    }
    setQtyByLine({ ...base, [line.id]: String(current + 1) });
    setHasScanned(true);
    setScanMessage({ type: "success", text: `${found.label}: ${current + 1} of ${line.qty}` });
  }

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
      </div>
      {poDetail && (
        <ExchangeRateField currency={poDetail.currency} date={receiptDate} value={exchangeRate} onChange={setExchangeRate} />
      )}

      {poDetail && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Scan to receive</div>
          <input
            type="text"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={handleScan}
            placeholder="Scan barcode, then Enter..."
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {scanMessage && (
            <p className={`mt-1 text-xs ${scanMessage.type === "error" ? "text-red-600" : "text-emerald-600"}`}>{scanMessage.text}</p>
          )}
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            The first scan resets quantities below to zero and counts up as you scan. Only items on this PO can be scanned in, up to the
            ordered quantity. You can still type quantities directly instead.
          </p>

          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines to receive</div>
          <div className="space-y-2">
            {poDetail.lines.map((line) => {
              const remaining = Number(line.qty) - Number(line.received_qty);
              return (
                <div key={line.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-900 dark:text-slate-100">{line.item_name_en}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
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

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">
        Accrues Dr Inventory / Cr GRNI at the PO's price. Landed cost charges (freight, customs) aren't in this form yet.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Receive & Post" />
    </form>
  );
}

export function NewSupplierInvoiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: purchaseOrders } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const { data: goodsReceipts } = useApiList<GoodsReceipt>("/api/goods-receipts");
  const postedPOs = purchaseOrders?.filter((po) => po.document_status === "posted") ?? [];

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const receiptsForPo = (goodsReceipts ?? []).filter((gr) => gr.purchase_order_id === purchaseOrderId && gr.document_status === "posted");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [grDetail, setGrDetail] = useState<GrDetail | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
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
      {selectedPo && (
        <ExchangeRateField currency={selectedPo.currency} date={invoiceDate} value={exchangeRate} onChange={setExchangeRate} />
      )}

      {grDetail && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
            Lines {selectedPo && selectedPo.currency !== baseCurrency && <span className="font-normal text-slate-400 dark:text-slate-500">(priced in {selectedPo.currency})</span>}
          </div>
          <div className="space-y-2">
            {grDetail.lines.map((line) => (
              <div key={line.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
                <div className="mb-1.5 text-sm text-slate-900 dark:text-slate-100">{line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code})</span></div>
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

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">
        Clears GRNI, books Purchase Price Variance if the price differs from the receipt, claims input VAT, credits Accounts Payable.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Post Invoice" />
    </form>
  );
}

function GoodsReceiptsTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<GoodsReceipt>("/api/goods-receipts");
  const baseCurrency = useBaseCurrency();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("purchasing.goods_receipt.post");

  const columns: Column<GoodsReceipt>[] = [
    { key: "number", header: "GR #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "po", header: "PO #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.po_document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Receipt Date", render: (r) => new Date(r.receipt_date).toLocaleDateString() },
    { key: "currency", header: "Currency", render: (r) => (r.currency !== baseCurrency ? `${r.currency} @ ${Number(r.exchange_rate).toFixed(4)}` : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/goods-receipts/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.po_document_number} ${r.supplier_name_en}`}
        emptyIcon={PackageCheck}
        emptyText="No goods receipts yet."
        searchPlaceholder="Search goods receipts..."
        actionLabel="New Goods Receipt"
        onAction={() => navigate("/purchasing/goods-receipts/new", { state: { fromTab: "receipts" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

function SupplierInvoicesTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<SupplierInvoice>("/api/supplier-invoices");
  const baseCurrency = useBaseCurrency();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("purchasing.goods_receipt.post");

  const columns: Column<SupplierInvoice>[] = [
    { key: "number", header: "Invoice #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
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

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/supplier-invoices/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.supplier_invoice_number} ${r.supplier_name_en}`}
        emptyIcon={ReceiptText}
        emptyText="No supplier invoices yet."
        searchPlaceholder="Search supplier invoices..."
        actionLabel="New Supplier Invoice"
        onAction={() => navigate("/purchasing/supplier-invoices/new", { state: { fromTab: "invoices" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

export function NewSupplierCreditNoteForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: supplierInvoices } = useApiList<SupplierInvoice>("/api/supplier-invoices");
  const postedInvoices = supplierInvoices?.filter((si) => si.document_status === "posted") ?? [];

  const [originalInvoiceId, setOriginalInvoiceId] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [returnableLines, setReturnableLines] = useState<ReturnableLine[] | null>(null);
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedInvoice = postedInvoices.find((si) => si.id === originalInvoiceId) ?? null;

  useEffect(() => {
    if (!originalInvoiceId || !token || !companyId) {
      setReturnableLines(null);
      setStoreId(null);
      return;
    }
    apiRequest<{ storeId: string | null; lines: ReturnableLine[] }>(`/api/supplier-invoices/${originalInvoiceId}/returnable-lines`, {
      token,
      companyId,
    }).then((res) => {
      setReturnableLines(res.lines);
      setStoreId(res.storeId);
      const init: Record<string, string> = {};
      for (const line of res.lines) {
        if (Number(line.returnable_qty) > 0) init[line.source_line_id] = String(line.returnable_qty);
      }
      setQtyByLine(init);
    });
  }, [originalInvoiceId, token, companyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!returnableLines || !storeId || !selectedInvoice) return;
    setSubmitting(true);
    try {
      const lines = returnableLines
        .filter((l) => Number(qtyByLine[l.source_line_id]) > 0)
        .map((l) => ({
          sourceLineId: l.source_line_id,
          itemVariantId: l.item_variant_id,
          qty: Number(qtyByLine[l.source_line_id]),
          unitPrice: Number(l.unit_price),
          discountAmount: Number(l.discount_amount),
          vatRate: Number(l.vat_rate),
          priceIncludesVat: l.price_includes_vat,
        }));
      if (lines.length === 0) throw new Error("Enter a return quantity for at least one line.");

      const created = await apiRequest<{ id: string }>("/api/supplier-credit-notes", {
        method: "POST",
        token,
        companyId,
        body: {
          storeId,
          supplierId: selectedInvoice.supplier_id,
          originalInvoiceId,
          creditNoteDate,
          reason,
          lines,
        },
      });
      await apiRequest(`/api/supplier-credit-notes/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed to create supplier credit note");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Supplier Invoice" required>
        <SelectInput required value={originalInvoiceId} onChange={(e) => setOriginalInvoiceId(e.target.value)}>
          <option value="">Select a posted invoice...</option>
          {postedInvoices.map((si) => (
            <option key={si.id} value={si.id}>
              {si.document_number} — {si.supplier_name_en} ({si.supplier_invoice_number})
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Credit Note Date" required>
        <TextInput type="date" required value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} />
      </Field>
      <Field label="Reason" required>
        <TextInput required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged on arrival, wrong item shipped" />
      </Field>

      {returnableLines && (
        <>
          <div className="mb-2 mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">Lines to return</div>
          <div className="space-y-2">
            {returnableLines.map((line) => {
              const returnable = Number(line.returnable_qty);
              return (
                <div key={line.source_line_id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-900 dark:text-slate-100">{line.item_name_en}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {line.variant_code} · invoiced {Number(line.invoiced_qty).toLocaleString()}, returnable {returnable.toLocaleString()} @ {Number(line.unit_price).toFixed(2)}
                    </div>
                  </div>
                  <div className="w-24 flex-none">
                    <TextInput
                      type="number"
                      min={0}
                      max={returnable}
                      step="0.001"
                      value={qtyByLine[line.source_line_id] ?? ""}
                      onChange={(e) => setQtyByLine((prev) => ({ ...prev, [line.source_line_id]: e.target.value }))}
                      disabled={returnable <= 0}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">
        Reduces Accounts Payable and reverses input VAT; ships the returned stock back out of inventory at its current average cost (any gap from
        the invoiced price posts as a purchase price variance).
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Post Return" />
    </form>
  );
}

export function CreditNoteDetailModal({ creditNoteId }: { creditNoteId: string }) {
  const { token, companyId, hasPermission } = useAuth();
  const [detail, setDetail] = useState<SupplierCreditNoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseCurrency = useBaseCurrency();

  async function reload() {
    const d = await apiRequest<SupplierCreditNoteDetail>(`/api/supplier-credit-notes/${creditNoteId}`, { token, companyId });
    setDetail(d);
  }

  useEffect(() => {
    if (!token || !companyId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditNoteId, token, companyId]);

  async function post() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/supplier-credit-notes/${creditNoteId}/post`, { method: "POST", token, companyId });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {detail.supplier_name_en} · against invoice {detail.invoice_document_number} · {new Date(detail.credit_note_date).toLocaleDateString()}
          </div>
        </div>
        <StatusBadge status={detail.document_status} />
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {detail.document_status === "draft" && hasPermission("purchasing.goods_receipt.post") && (
        <button onClick={post} disabled={busy} className="mb-3 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {busy ? "Working..." : "Post"}
        </button>
      )}
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{detail.reason}</p>

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 dark:border-slate-700 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-200">
              {line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code})</span>
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {Number(line.qty).toLocaleString()} × {Number(line.unit_price).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Total: {formatMoney(detail.gross_amount, baseCurrency)}</div>
    </div>
  );
}

function PurchaseReturnsTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<SupplierCreditNote>("/api/supplier-credit-notes");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("purchasing.goods_receipt.post");

  const columns: Column<SupplierCreditNote>[] = [
    { key: "number", header: "SCN #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "invoice", header: "Against Invoice", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.invoice_document_number}</span> },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.credit_note_date).toLocaleDateString() },
    { key: "reason", header: "Reason", render: (r) => <span className="truncate">{r.reason}</span> },
    { key: "amount", header: "Total", render: (r) => formatMoney(r.gross_amount), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/supplier-credit-notes/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.invoice_document_number} ${r.supplier_name_en} ${r.reason}`}
        emptyIcon={Undo2}
        emptyText="No purchase returns yet."
        searchPlaceholder="Search purchase returns..."
        actionLabel="New Purchase Return"
        onAction={() => navigate("/purchasing/returns/new", { state: { fromTab: "returns" } })}
        onRowClick={(r) => navigate(`/purchasing/returns/${r.id}`, { state: { fromTab: "returns" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
      />
    </>
  );
}

export interface RequisitionFormInitial {
  storeId: string;
  lines: Array<{ itemVariantId: string; qty: string; notes: string }>;
}

export function NewRequisitionForm({
  onClose,
  onCreated,
  initial,
}: {
  onClose: () => void;
  onCreated: () => void;
  initial?: RequisitionFormInitial;
}) {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { options: variantOptions } = useVariantOptions();

  const [storeId, setStoreId] = useState(initial?.storeId ?? "");
  const [requisitionDate, setRequisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [neededByDate, setNeededByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ itemVariantId: string; qty: string; notes: string }>>(
    initial?.lines ?? [{ itemVariantId: "", qty: "1", notes: "" }],
  );
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
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mb-3 mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
        <Plus size={13} /> Add line
      </button>

      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
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

  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
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
        <Field label="Order Date" required>
          <TextInput type="date" required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
        <Field label="Expected Date">
          <TextInput type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
      </div>

      <div className="mb-2 mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Set pricing per line</div>
      <div className="space-y-2">
        {requisition.lines.map((line) => (
          <div key={line.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
            <div className="mb-1.5 text-sm text-slate-900 dark:text-slate-100">
              {line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code}) · qty {Number(line.qty).toLocaleString()}</span>
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

      <p className="mb-3 mt-3 text-xs text-slate-400 dark:text-slate-500">Creates and approves (posts) a new purchase order for this supplier, pre-filled from the requisition's items and quantities.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Purchase Order" />
    </form>
  );
}

export function RequisitionDetailModal({ requisitionId, onChanged }: { requisitionId: string; onChanged: () => void }) {
  const navigate = useNavigate();
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

  async function unapprove() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/purchase-requisitions/${requisitionId}/unapprove`, { method: "POST", token, companyId });
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to unapprove");
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

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  const isOwnRequisition = me?.user.email === detail.requested_by_email;
  const canApprove = hasPermission("purchasing.requisition.approve") && !isOwnRequisition;

  function duplicate() {
    if (!detail) return;
    navigate("/purchasing/requisitions/new", {
      state: {
        fromTab: "requisitions",
        initial: {
          storeId: detail.store_id,
          lines: detail.lines.map((l) => ({ itemVariantId: l.item_variant_id, qty: l.qty, notes: l.notes ?? "" })),
        },
      },
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {detail.store_name_en} · requested by {detail.requested_by_email ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={duplicate} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Duplicate
          </button>
          <StatusBadge status={detail.document_status} />
        </div>
      </div>
      <StatusStepper
        steps={[
          { key: "draft", label: "Draft" },
          { key: "pending_approval", label: "Pending Approval" },
          { key: "approved", label: "Approved" },
          { key: "converted_to_po", label: "Converted to PO" },
        ]}
        current={detail.document_status}
        terminalStatuses={{ rejected: "Rejected", withdrawn: "Withdrawn" }}
      />
      {detail.notes && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{detail.notes}</p>}
      {detail.document_status === "rejected" && detail.rejection_reason && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">Rejected: {detail.rejection_reason}</p>
      )}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 dark:border-slate-700 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-200">
              {line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code})</span>
              {line.notes && <span className="ms-2 text-xs text-slate-400 dark:text-slate-500">— {line.notes}</span>}
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{Number(line.qty).toLocaleString()}</span>
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
        <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
          {isOwnRequisition ? "You cannot approve your own requisition." : "Awaiting approval from someone with requisition-approval rights."}
        </p>
      )}
      {detail.document_status === "pending_approval" && isOwnRequisition && (
        <button onClick={withdraw} disabled={busy} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
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
            <button type="button" onClick={() => setShowReject(false)} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      {detail.document_status === "approved" && !showConvert && (
        <div className="flex gap-2">
          <button onClick={() => setShowConvert(true)} className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600">
            Convert to Purchase Order
          </button>
          {canApprove && (
            <button onClick={unapprove} disabled={busy} className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              {busy ? "Working..." : "Unapprove"}
            </button>
          )}
        </div>
      )}
      {showConvert && (
        <ConvertRequisitionForm
          requisition={detail}
          onClose={() => setShowConvert(false)}
          onConverted={async () => {
            setShowConvert(false);
            await reload();
            onChanged();
          }}
        />
      )}
      {detail.document_status === "converted_to_po" && <p className="text-xs text-slate-400 dark:text-slate-500">Already converted into a purchase order.</p>}
    </div>
  );
}

function RequisitionsTab() {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<PurchaseRequisition>("/api/purchase-requisitions");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState<string | null>(null);

  const columns: Column<PurchaseRequisition>[] = [
    { key: "number", header: "PR #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "date", header: "Date", render: (r) => new Date(r.requisition_date).toLocaleDateString() },
    { key: "requester", header: "Requested By", render: (r) => r.requested_by_email ?? "—" },
    { key: "lines", header: "Items", render: (r) => r.line_count, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  const canApprove = hasPermission("purchasing.requisition.approve");

  async function bulkApprove() {
    setBulkMessage(await runBulkAction("/api/purchase-requisitions/bulk-approve", [...selected], { token, companyId }));
    setSelected(new Set());
    reload();
  }

  async function bulkReject() {
    const rejectionReason = bulkReason?.trim();
    if (!rejectionReason) return;
    setBulkMessage(
      await runBulkAction("/api/purchase-requisitions/bulk-reject", [...selected], { token, companyId, body: { rejectionReason } }),
    );
    setSelected(new Set());
    setBulkReason(null);
    reload();
  }

  return (
    <>
      {bulkMessage && (
        <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">{bulkMessage}</p>
      )}
      {bulkReason !== null && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-500/30 dark:bg-red-500/10">
          <TextInput
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            placeholder="Rejection reason for all selected..."
          />
          <button onClick={bulkReject} className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Confirm Reject ({selected.size})
          </button>
          <button onClick={() => setBulkReason(null)} className="shrink-0 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400">
            Cancel
          </button>
        </div>
      )}
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
        onAction={() => navigate("/purchasing/requisitions/new", { state: { fromTab: "requisitions" } })}
        onRowClick={(r) => navigate(`/purchasing/requisitions/${r.id}`, { state: { fromTab: "requisitions" } })}
        selectable={canApprove}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={
          canApprove
            ? [
                { label: "Approve", onClick: bulkApprove },
                { label: "Reject", onClick: () => setBulkReason(""), variant: "danger" },
              ]
            : undefined
        }
      />
    </>
  );
}

export function PoDetailModal({ poId }: { poId: string }) {
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [requisitionNumber, setRequisitionNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseCurrency = useBaseCurrency();

  async function reload() {
    const d = await apiRequest<PoDetail>(`/api/purchase-orders/${poId}`, { token, companyId });
    setDetail(d);
    if (d.purchase_requisition_id) {
      apiRequest<RequisitionDetail>(`/api/purchase-requisitions/${d.purchase_requisition_id}`, { token, companyId }).then((r) =>
        setRequisitionNumber(r.document_number),
      );
    }
  }

  useEffect(() => {
    if (!token || !companyId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, token, companyId]);

  async function post() {
    setError(null);
    setBusy(true);
    try {
      await apiRequest(`/api/purchase-orders/${poId}/post`, { method: "POST", token, companyId });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  function duplicate() {
    if (!detail) return;
    navigate("/purchasing/orders/new", {
      state: {
        fromTab: "pos",
        initial: {
          supplierId: detail.supplier_id,
          storeId: detail.store_id,
          lines: detail.lines.map((l) => ({
            itemVariantId: l.item_variant_id,
            qty: l.qty,
            unitPrice: l.unit_price,
            vatRate: "15",
            priceIncludesVat: false,
          })),
        },
      },
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{detail.document_number}</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {detail.supplier_name_en} · {new Date(detail.order_date).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={duplicate} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Duplicate
          </button>
          <StatusBadge status={detail.document_status} />
        </div>
      </div>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {detail.document_status === "draft" && hasPermission("purchasing.po.create") && (
        <button onClick={post} disabled={busy} className="mb-3 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {busy ? "Working..." : "Post"}
        </button>
      )}
      {detail.purchase_requisition_id && (
        <button
          onClick={() => navigate(`/purchasing/requisitions/${detail.purchase_requisition_id}`)}
          className="mb-3 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Created from requisition {requisitionNumber ?? "…"}
        </button>
      )}

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 dark:border-slate-700 p-2">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-200">
              {line.item_name_en} <span className="text-xs text-slate-400 dark:text-slate-500">({line.variant_code})</span>
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {Number(line.qty).toLocaleString()} × {Number(line.unit_price).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Total: {formatMoney(detail.gross_amount, detail.currency !== baseCurrency ? detail.currency : undefined)}
      </div>
    </div>
  );
}

function PurchaseOrdersTab() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { token, companyId, hasPermission } = useAuth();
  const { data, error, reload } = useApiList<PurchaseOrder>("/api/purchase-orders");
  const baseCurrency = useBaseCurrency();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const canPost = hasPermission("purchasing.po.create");

  const columns: Column<PurchaseOrder>[] = [
    { key: "number", header: "PO #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{i18n.language.startsWith("ar") ? r.supplier_name_ar : r.supplier_name_en}</span>,
    },
    { key: "date", header: "Order Date", render: (r) => new Date(r.order_date).toLocaleDateString() },
    { key: "amount", header: "Total", render: (r) => formatMoney(r.gross_amount, r.currency !== baseCurrency ? r.currency : undefined), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  async function bulkPost() {
    setBulkMessage(await runBulkAction("/api/purchase-orders/bulk-post", [...selected], { token, companyId }));
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
        getSearchText={(r) => `${r.document_number} ${r.supplier_name_en}`}
        emptyIcon={ShoppingCart}
        emptyText="No purchase orders yet."
        searchPlaceholder="Search purchase orders..."
        actionLabel="New Purchase Order"
        onAction={() => navigate("/purchasing/orders/new", { state: { fromTab: "pos" } })}
        onRowClick={(r) => navigate(`/purchasing/orders/${r.id}`, { state: { fromTab: "pos" } })}
        selectable={canPost}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        bulkActions={canPost ? [{ label: "Post", onClick: bulkPost }] : undefined}
        toolbarExtra={
          <button
            onClick={() =>
              data &&
              exportToCsv("purchase-orders.csv", data, [
                { header: "PO #", value: (r) => r.document_number },
                { header: "Supplier", value: (r) => r.supplier_name_en },
                { header: "Order Date", value: (r) => r.order_date },
                { header: "Total", value: (r) => r.gross_amount },
                { header: "Currency", value: (r) => r.currency },
                { header: "Status", value: (r) => r.document_status },
              ])
            }
            className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download size={14} /> Export CSV
          </button>
        }
      />
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
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Pre-fills the currency on new purchase orders for this supplier — an overseas supplier is usually {baseCurrency !== "USD" ? "USD" : "EUR"} or similar.</p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Supplier" />
    </form>
  );
}

function EditSupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { token, companyId } = useAuth();
  const [nameEn, setNameEn] = useState(supplier.name_en);
  const [nameAr, setNameAr] = useState(supplier.name_ar);
  const [crNumber, setCrNumber] = useState(supplier.cr_number ?? "");
  const [vatRegistrationNumber, setVatRegistrationNumber] = useState(supplier.vat_registration_number ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [city, setCity] = useState(supplier.city ?? "");
  const [country, setCountry] = useState(supplier.country ?? "");
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(supplier.payment_terms_days);
  const [leadTimeDays, setLeadTimeDays] = useState(supplier.lead_time_days != null ? String(supplier.lead_time_days) : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/suppliers/${supplier.id}`, {
        method: "POST",
        token,
        companyId,
        body: {
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
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save supplier");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono">{supplier.supplier_code}</span>
        <span>{supplier.currency} — code and currency can't be changed here</span>
      </div>
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
      <FormActions error={error} submitting={submitting} submitLabel="Save Supplier" />
    </form>
  );
}

function SupplierPriceCatalog({ supplier, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: prices, reload } = useApiList<SupplierItemPrice>(`/api/supplier-item-prices?supplierId=${supplier.id}`);
  const { options: variantOptions } = useVariantOptions();
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
      <form onSubmit={setLinePrice} className="mb-4 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
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

      <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
        Every purchase order placed with this supplier also updates these costs automatically to whatever was last ordered.
      </p>
      {prices && prices.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No quoted prices on file yet.</p>}
      <div className="space-y-1.5">
        {prices?.map((p) => (
          <div key={p.item_variant_id} className="flex items-center justify-between rounded-md border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
            <div>
              <div className="text-slate-700 dark:text-slate-200">{variantLabel(p.item_variant_id)}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {p.lead_time_days != null ? `${p.lead_time_days}d lead time` : "no lead time set"}
                {p.moq ? ` · MOQ ${Number(p.moq)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
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
  const [editing, setEditing] = useState(false);

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
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.supplier_code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.name_en}</span> },
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
        onRowClick={(r) => {
          setEditing(false);
          setDetailId(r.id);
        }}
      />
      {showNew && (
        <Modal title="New Supplier" onClose={() => setShowNew(false)}>
          <NewSupplierForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {detailSupplier && (
        <Modal title={detailSupplier.name_en} onClose={() => setDetailId(null)}>
          {editing ? (
            <EditSupplierForm
              supplier={detailSupplier}
              onClose={() => setEditing(false)}
              onSaved={reload}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="mb-4 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Edit supplier details
            </button>
          )}
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Cost Catalog</div>
          <SupplierPriceCatalog supplier={detailSupplier} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}

interface ReorderSuggestion {
  item_variant_id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  reorder_point: string;
  qty_on_hand: string;
  item_name_en: string;
  item_name_ar: string;
  supplier_id: string | null;
  supplier_name_en: string | null;
  unit_cost: string | null;
  currency: string | null;
  moq: string | null;
  suggested_qty: string;
}

function ReorderSuggestionsTab() {
  const navigate = useNavigate();
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const [storeId, setStoreId] = useState("");
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[] | null>(null);
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, string>>({});

  function load() {
    if (!storeId || !token || !companyId) {
      setSuggestions(null);
      return;
    }
    apiRequest<ReorderSuggestion[]>(`/api/reorder-suggestions?storeId=${storeId}`, { token, companyId }).then((rows) => {
      setSuggestions(rows);
      setQtyOverrides(Object.fromEntries(rows.map((r) => [r.item_variant_id, r.suggested_qty])));
    });
  }

  useEffect(load, [storeId, token, companyId]);

  const withSupplier = (suggestions ?? []).filter((s) => s.supplier_id);
  const withoutSupplier = (suggestions ?? []).filter((s) => !s.supplier_id);
  const groups = new Map<string, { supplierId: string; supplierName: string; rows: ReorderSuggestion[] }>();
  for (const row of withSupplier) {
    const key = row.supplier_id!;
    if (!groups.has(key)) groups.set(key, { supplierId: key, supplierName: row.supplier_name_en!, rows: [] });
    groups.get(key)!.rows.push(row);
  }

  function openPoForGroup(group: { supplierId: string; rows: ReorderSuggestion[] }) {
    const initial: PoFormInitial = {
      supplierId: group.supplierId,
      storeId,
      lines: group.rows.map((r) => ({
        itemVariantId: r.item_variant_id,
        qty: qtyOverrides[r.item_variant_id] ?? r.suggested_qty,
        unitPrice: r.unit_cost ?? "0",
        vatRate: "15",
        priceIncludesVat: false,
      })),
    };
    navigate("/purchasing/orders/new", { state: { fromTab: "reorder", initial } });
  }

  return (
    <div>
      <Field label="Store">
        <SelectInput value={storeId} onChange={(e) => setStoreId(e.target.value)} className="max-w-xs">
          <option value="">Select a store...</option>
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>

      {!storeId && <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">Select a store to see what's below its reorder point there.</p>}

      {storeId && suggestions && suggestions.length === 0 && (
        <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">Nothing at this store is below its reorder point right now.</p>
      )}

      {storeId &&
        [...groups.values()].map((group) => (
          <div key={group.supplierId} className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{group.supplierName}</div>
              <button
                onClick={() => openPoForGroup(group)}
                className="rounded-md bg-brand-500 px-3 py-1 text-xs font-medium text-white hover:bg-brand-600"
              >
                Create PO ({group.rows.length} item{group.rows.length === 1 ? "" : "s"})
              </button>
            </div>
            <div className="space-y-1.5">
              {group.rows.map((r) => (
                <div key={r.item_variant_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                    {r.item_name_en} — {r.variant_code}
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {" "}
                      (on hand {r.qty_on_hand}, reorder point {r.reorder_point}, {r.unit_cost} {r.currency}/unit
                      {r.moq && Number(r.moq) > 0 ? `, MOQ ${r.moq}` : ""})
                    </span>
                  </span>
                  <div className="w-20 flex-none">
                    <TextInput
                      type="number"
                      min={0.001}
                      step="0.001"
                      value={qtyOverrides[r.item_variant_id] ?? r.suggested_qty}
                      onChange={(e) => setQtyOverrides((prev) => ({ ...prev, [r.item_variant_id]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {storeId && withoutSupplier.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1 text-sm font-medium text-amber-800">No supplier price on file — can't be auto-added to a PO</div>
          <p className="mb-2 text-xs text-amber-700">
            Add one under Purchasing → Suppliers → cost catalog, or add this item to a PO manually.
          </p>
          <div className="space-y-1 text-sm text-amber-900">
            {withoutSupplier.map((r) => (
              <div key={r.item_variant_id}>
                {r.item_name_en} — {r.variant_code} (on hand {r.qty_on_hand}, reorder point {r.reorder_point})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Purchasing() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">{t("nav.purchasing")}</h1>
      <Tabs
        initialActive={(location.state as { fromTab?: string } | null)?.fromTab}
        hideHeader
        tabs={[
          { key: "requisitions", label: "Requisitions", content: <RequisitionsTab /> },
          { key: "reorder", label: "Reorder Suggestions", content: <ReorderSuggestionsTab /> },
          { key: "pos", label: "Purchase Orders", content: <PurchaseOrdersTab /> },
          { key: "receipts", label: "Goods Receipts", content: <GoodsReceiptsTab /> },
          { key: "invoices", label: "Supplier Invoices", content: <SupplierInvoicesTab /> },
          { key: "returns", label: "Purchase Returns", content: <PurchaseReturnsTab /> },
          { key: "suppliers", label: "Suppliers", content: <SuppliersTab /> },
        ]}
      />
    </div>
  );
}
