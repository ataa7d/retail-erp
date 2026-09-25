import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Package, Plus, Barcode as BarcodeIcon, Tag } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface Brand {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

interface Category {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  parent_id: string | null;
  is_active: boolean;
}

interface Season {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

interface UnitOfMeasure {
  id: string;
  code: string;
  name_en: string;
}

interface TaxCode {
  id: string;
  code: string;
  name_en: string;
  rate: string;
  is_active: boolean;
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
  reorder_point: string;
  barcodes: ItemBarcode[] | null;
}

interface Item {
  id: string;
  item_code: string;
  name_en: string;
  name_ar: string;
  brand_id: string | null;
  category_id: string | null;
  season_id: string | null;
  item_year: number | null;
  default_tax_code_id: string | null;
  is_active: boolean;
  variants: ItemVariant[];
}

function NewItemForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const { data: brands } = useApiList<Brand>("/api/brands");
  const { data: categories } = useApiList<Category>("/api/categories");
  const { data: seasons } = useApiList<Season>("/api/seasons");
  const { data: taxCodes } = useApiList<TaxCode>("/api/tax-codes");
  const [itemCode, setItemCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [baseUnitOfMeasureId, setBaseUnitOfMeasureId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [itemYear, setItemYear] = useState("");
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState("");
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
        body: {
          itemCode,
          nameEn,
          nameAr,
          baseUnitOfMeasureId,
          brandId: brandId || null,
          categoryId: categoryId || null,
          seasonId: seasonId || null,
          itemYear: itemYear ? Number(itemYear) : null,
          defaultTaxCodeId: defaultTaxCodeId || null,
          variantCode,
          color: color || null,
          size: size || null,
        },
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand">
          <SelectInput value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">None</option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name_en} ({b.code})
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Category">
          <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en} ({c.code})
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Season">
          <SelectInput value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">None</option>
            {seasons?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en} ({s.code})
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Year">
          <TextInput type="number" value={itemYear} onChange={(e) => setItemYear(e.target.value)} placeholder="e.g. 2026" />
        </Field>
        <Field label="Tax Code">
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

function ClassifyItemForm({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: brands } = useApiList<Brand>("/api/brands");
  const { data: categories } = useApiList<Category>("/api/categories");
  const { data: seasons } = useApiList<Season>("/api/seasons");
  const { data: taxCodes } = useApiList<TaxCode>("/api/tax-codes");
  const [brandId, setBrandId] = useState(item.brand_id ?? "");
  const [categoryId, setCategoryId] = useState(item.category_id ?? "");
  const [seasonId, setSeasonId] = useState(item.season_id ?? "");
  const [itemYear, setItemYear] = useState(item.item_year != null ? String(item.item_year) : "");
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState(item.default_tax_code_id ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiRequest(`/api/items/${item.id}/classify`, {
        method: "POST",
        token,
        companyId,
        body: {
          brandId: brandId || null,
          categoryId: categoryId || null,
          seasonId: seasonId || null,
          itemYear: itemYear ? Number(itemYear) : null,
          defaultTaxCodeId: defaultTaxCodeId || null,
        },
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-5">
      <Field label="Brand">
        <SelectInput value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">None</option>
          {brands?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Category">
        <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">None</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Season">
        <SelectInput value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          <option value="">None</option>
          {seasons?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Year">
        <TextInput type="number" value={itemYear} onChange={(e) => setItemYear(e.target.value)} />
      </Field>
      <Field label="Tax Code">
        <SelectInput value={defaultTaxCodeId} onChange={(e) => setDefaultTaxCodeId(e.target.value)}>
          <option value="">None</option>
          {taxCodes?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="col-span-2 sm:col-span-5">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Classification"}
        </button>
      </div>
    </div>
  );
}

function ItemDetail({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const unitLabel = (id: string) => units?.find((u) => u.id === id)?.code ?? "?";

  const [showAddVariant, setShowAddVariant] = useState(false);
  const [barcodeForVariant, setBarcodeForVariant] = useState<string | null>(null);
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);
  const [reorderDrafts, setReorderDrafts] = useState<Record<string, string>>({});
  const [savingReorderId, setSavingReorderId] = useState<string | null>(null);

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

  async function saveReorderPoint(variant: ItemVariant) {
    const raw = reorderDrafts[variant.id] ?? variant.reorder_point;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setSavingReorderId(variant.id);
    try {
      await apiRequest(`/api/item-variants/${variant.id}/reorder-point`, {
        method: "POST",
        token,
        companyId,
        body: { reorderPoint: value },
      });
      onChanged();
    } finally {
      setSavingReorderId(null);
    }
  }

  return (
    <div>
      <ClassifyItemForm item={item} onChanged={onChanged} />
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
            <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
              <label className="text-xs text-slate-500">Reorder point</label>
              <input
                type="number"
                min={0}
                step="0.001"
                value={reorderDrafts[v.id] ?? v.reorder_point}
                onChange={(e) => setReorderDrafts((prev) => ({ ...prev, [v.id]: e.target.value }))}
                className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:border-brand-400 focus:outline-none"
              />
              <button
                onClick={() => saveReorderPoint(v)}
                disabled={savingReorderId === v.id || (reorderDrafts[v.id] ?? v.reorder_point) === v.reorder_point}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-30"
              >
                {savingReorderId === v.id ? "Saving..." : "Save"}
              </button>
              <span className="text-xs text-slate-400">0 = no low-stock alert</span>
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

function ItemsTab() {
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

interface ClassificationEntity {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

function ClassificationForm({
  path,
  showParent,
  categories,
  onClose,
  onCreated,
}: {
  path: string;
  showParent?: boolean;
  categories?: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token, companyId } = useAuth();
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(path, {
        method: "POST",
        token,
        companyId,
        body: showParent ? { code, nameEn, nameAr, parentId: parentId || null } : { code, nameEn, nameAr },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Code" required>
        <TextInput required value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label="Name (English)" required>
        <TextInput required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </Field>
      <Field label="Name (Arabic)" required>
        <TextInput required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </Field>
      {showParent && (
        <Field label="Parent Category">
          <SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en} ({c.code})
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      <FormActions error={error} submitting={submitting} submitLabel="Create" />
    </form>
  );
}

function ClassificationTab({
  title,
  basePath,
  emptyText,
  showParent,
}: {
  title: string;
  basePath: string;
  emptyText: string;
  showParent?: boolean;
}) {
  const { token, companyId } = useAuth();
  const { data, error, reload } = useApiList<ClassificationEntity & { parent_id?: string | null }>(basePath);
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const categories = (basePath === "/api/categories" ? data : undefined) as Category[] | undefined;

  async function toggleActive(row: ClassificationEntity) {
    setBusyId(row.id);
    try {
      await apiRequest(`${basePath}/${row.id}/${row.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const parentName = (id: string | null | undefined) => data?.find((c) => c.id === id)?.name_en ?? "-";

  const columns: Column<ClassificationEntity & { parent_id?: string | null }>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.code}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium text-slate-900">{r.name_en}</span> },
    { key: "name_ar", header: "الاسم", render: (r) => <span dir="rtl">{r.name_ar}</span> },
    ...(showParent
      ? [{ key: "parent", header: "Parent", render: (r: ClassificationEntity & { parent_id?: string | null }) => parentName(r.parent_id) }]
      : []),
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

  return (
    <>
      <ListPage
        title={title}
        data={data}
        error={error}
        columns={columns}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.code} ${r.name_en} ${r.name_ar}`}
        emptyIcon={Tag}
        emptyText={emptyText}
        searchPlaceholder="Search by code or name..."
        actionLabel="New"
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title={`New ${title}`} onClose={() => setShowNew(false)}>
          <ClassificationForm path={basePath} showParent={showParent} categories={categories} onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

export default function Items() {
  const { t } = useTranslation();
  const tabs = useMemo(
    () => [
      { key: "items", label: t("nav.items"), content: <ItemsTab /> },
      {
        key: "brands",
        label: "Brands",
        content: <ClassificationTab title="Brand" basePath="/api/brands" emptyText="No brands found." />,
      },
      {
        key: "categories",
        label: "Categories",
        content: <ClassificationTab title="Category" basePath="/api/categories" emptyText="No categories found." showParent />,
      },
      {
        key: "seasons",
        label: "Seasons",
        content: <ClassificationTab title="Season" basePath="/api/seasons" emptyText="No seasons found." />,
      },
    ],
    [t],
  );
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.items")}</h1>
      <Tabs tabs={tabs} />
    </div>
  );
}
