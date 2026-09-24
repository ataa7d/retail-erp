import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Package, Plus, Barcode as BarcodeIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface UnitOfMeasure {
  id: string;
  code: string;
  name_en: string;
}

interface ItemBarcode {
  id: string;
  barcode: string;
  unitOfMeasureId: string;
  isPrimary: boolean;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
  barcodes: ItemBarcode[] | null;
}

interface Item {
  id: string;
  item_code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  variants: ItemVariant[];
}

function NewItemForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const [itemCode, setItemCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [baseUnitOfMeasureId, setBaseUnitOfMeasureId] = useState("");
  const [variantCode, setVariantCode] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/items", {
        method: "POST",
        token,
        companyId,
        body: { itemCode, nameEn, nameAr, baseUnitOfMeasureId, variantCode, color: color || null, size: size || null },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Item Code" required>
        <TextInput required value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
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
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 sm:col-span-1">
          <Field label="Variant / SKU Code" required>
            <TextInput required value={variantCode} onChange={(e) => setVariantCode(e.target.value)} placeholder="e.g. TS-001-BLK-M" />
          </Field>
        </div>
        <Field label="Color">
          <TextInput value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <Field label="Size">
          <TextInput value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Creates the item with a single default variant. Additional color/size variants can be added afterward from the item's detail view.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Item" />
    </form>
  );
}

function AddVariantForm({ itemId, onClose, onCreated }: { itemId: string; onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const [variantCode, setVariantCode] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/items/${itemId}/variants`, {
        method: "POST",
        token,
        companyId,
        body: { variantCode, color: color || null, size: size || null },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add variant");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Variant / SKU Code" required>
        <TextInput required value={variantCode} onChange={(e) => setVariantCode(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <TextInput value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <Field label="Size">
          <TextInput value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
      </div>
      <FormActions error={error} submitting={submitting} submitLabel="Add Variant" />
    </form>
  );
}

function AddBarcodeForm({ variantId, onClose, onCreated }: { variantId: string; onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const [barcode, setBarcode] = useState("");
  const [unitOfMeasureId, setUnitOfMeasureId] = useState("");
  const [isPrimary, setIsPrimary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(`/api/item-variants/${variantId}/barcodes`, {
        method: "POST",
        token,
        companyId,
        body: { barcode, unitOfMeasureId, isPrimary },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add barcode");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Barcode" required>
        <TextInput required value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      </Field>
      <Field label="Unit" required>
        <SelectInput required value={unitOfMeasureId} onChange={(e) => setUnitOfMeasureId(e.target.value)}>
          <option value="">Select...</option>
          {units?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name_en} ({u.code})
            </option>
          ))}
        </SelectInput>
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        Primary barcode for this unit
      </label>
      <FormActions error={error} submitting={submitting} submitLabel="Add Barcode" />
    </form>
  );
}

function ItemDetail({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const unitLabel = (id: string) => units?.find((u) => u.id === id)?.code ?? "?";

  const [showAddVariant, setShowAddVariant] = useState(false);
  const [barcodeForVariant, setBarcodeForVariant] = useState<string | null>(null);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);

  async function toggleActive(variant: ItemVariant) {
    setBusyVariantId(variant.id);
    try {
      await apiRequest(`/api/item-variants/${variant.id}/${variant.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      onChanged();
    } finally {
      setBusyVariantId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-slate-500">
          <span className="font-mono text-xs">{item.item_code}</span> · {item.variants.length} variant{item.variants.length === 1 ? "" : "s"}
        </div>
        <button
          onClick={() => setShowAddVariant(true)}
          className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus size={13} /> Add Variant
        </button>
      </div>

      <div className="space-y-2">
        {item.variants.map((v) => (
          <div key={v.id} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="font-mono text-sm text-slate-900">{v.variant_code}</span>
                {(v.color || v.size) && (
                  <span className="ms-2 text-xs text-slate-500">{[v.color, v.size].filter(Boolean).join(" / ")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={v.is_active ? "active" : "inactive"} />
                <button
                  onClick={() => toggleActive(v)}
                  disabled={busyVariantId === v.id}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                >
                  {v.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(v.barcodes ?? []).map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  <BarcodeIcon size={11} /> {b.barcode} ({unitLabel(b.unitOfMeasureId)}){b.isPrimary ? "" : " alt"}
                </span>
              ))}
              <button onClick={() => setBarcodeForVariant(v.id)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                + Barcode
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAddVariant && (
        <Modal title="Add Variant" onClose={() => setShowAddVariant(false)}>
          <AddVariantForm itemId={item.id} onClose={() => setShowAddVariant(false)} onCreated={onChanged} />
        </Modal>
      )}
      {barcodeForVariant && (
        <Modal title="Add Barcode" onClose={() => setBarcodeForVariant(null)}>
          <AddBarcodeForm variantId={barcodeForVariant} onClose={() => setBarcodeForVariant(null)} onCreated={onChanged} />
        </Modal>
      )}
    </div>
  );
}

export default function Items() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Item>("/api/items");
  const [showNew, setShowNew] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  const columns: Column<Item>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.item_code}</span> },
    {
      key: "name",
      header: i18n.language.startsWith("ar") ? "الاسم" : "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.name_ar : r.name_en}</span>,
    },
    { key: "variants", header: "Variants", render: (r) => r.variants.length, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  const detailItem = data?.find((i) => i.id === detailItemId) ?? null;

  return (
    <>
      <ListPage
        title={t("nav.items")}
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.item_code} ${r.name_en} ${r.name_ar}`}
        emptyIcon={Package}
        emptyText="No items found."
        searchPlaceholder="Search by code or name..."
        actionLabel="New Item"
        onAction={() => setShowNew(true)}
        onRowClick={(r) => setDetailItemId(r.id)}
      />
      {showNew && (
        <Modal title="New Item" onClose={() => setShowNew(false)}>
          <NewItemForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {detailItem && (
        <Modal title={detailItem.name_en} onClose={() => setDetailItemId(null)}>
          <ItemDetail item={detailItem} onChanged={reload} />
        </Modal>
      )}
    </>
  );
}
