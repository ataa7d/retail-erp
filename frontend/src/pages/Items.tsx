import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Package, Plus, Barcode as BarcodeIcon, Tag, Upload, Download, Printer } from "lucide-react";
import JsBarcode from "jsbarcode";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError, uploadFile } from "../lib/api";
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

interface ItemGroup {
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
  standard_cost: string | null;
  weight_kg: string | null;
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
  group_id: string | null;
  item_year: number | null;
  default_tax_code_id: string | null;
  material: string | null;
  country_of_origin: string | null;
  supplier_style_number: string | null;
  is_active: boolean;
  variants: ItemVariant[];
}

function NewItemForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: units } = useApiList<UnitOfMeasure>("/api/units-of-measure");
  const { data: brands } = useApiList<Brand>("/api/brands");
  const { data: categories } = useApiList<Category>("/api/categories");
  const { data: seasons } = useApiList<Season>("/api/seasons");
  const { data: groups } = useApiList<ItemGroup>("/api/item-groups");
  const { data: taxCodes } = useApiList<TaxCode>("/api/tax-codes");
  const [itemCode, setItemCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [baseUnitOfMeasureId, setBaseUnitOfMeasureId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [itemYear, setItemYear] = useState("");
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState("");
  const [material, setMaterial] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("");
  const [supplierStyleNumber, setSupplierStyleNumber] = useState("");
  const [variantCode, setVariantCode] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [standardCost, setStandardCost] = useState("");
  const [weightKg, setWeightKg] = useState("");
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
          groupId: groupId || null,
          itemYear: itemYear ? Number(itemYear) : null,
          defaultTaxCodeId: defaultTaxCodeId || null,
          material: material || null,
          countryOfOrigin: countryOfOrigin || null,
          supplierStyleNumber: supplierStyleNumber || null,
          variantCode,
          color: color || null,
          size: size || null,
          standardCost: standardCost ? Number(standardCost) : null,
          weightKg: weightKg ? Number(weightKg) : null,
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
        <Field label="Group">
          <SelectInput value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">None</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name_en} ({g.code})
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
        <Field label="Material">
          <TextInput value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. 100% Cotton" />
        </Field>
        <Field label="Country of Origin">
          <TextInput value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} placeholder="e.g. Bangladesh" />
        </Field>
        <Field label="Supplier Style #">
          <TextInput value={supplierStyleNumber} onChange={(e) => setSupplierStyleNumber(e.target.value)} placeholder="Supplier's own code" />
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Standard Cost">
          <TextInput type="number" min={0} step="0.01" value={standardCost} onChange={(e) => setStandardCost(e.target.value)} placeholder="Budget/planning cost" />
        </Field>
        <Field label="Weight (kg)">
          <TextInput type="number" min={0} step="0.001" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
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
  const [standardCost, setStandardCost] = useState("");
  const [weightKg, setWeightKg] = useState("");
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
        body: {
          variantCode,
          color: color || null,
          size: size || null,
          standardCost: standardCost ? Number(standardCost) : null,
          weightKg: weightKg ? Number(weightKg) : null,
        },
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Standard Cost">
          <TextInput type="number" min={0} step="0.01" value={standardCost} onChange={(e) => setStandardCost(e.target.value)} />
        </Field>
        <Field label="Weight (kg)">
          <TextInput type="number" min={0} step="0.001" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
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
  const { data: groups } = useApiList<ItemGroup>("/api/item-groups");
  const { data: taxCodes } = useApiList<TaxCode>("/api/tax-codes");
  const [brandId, setBrandId] = useState(item.brand_id ?? "");
  const [categoryId, setCategoryId] = useState(item.category_id ?? "");
  const [seasonId, setSeasonId] = useState(item.season_id ?? "");
  const [groupId, setGroupId] = useState(item.group_id ?? "");
  const [itemYear, setItemYear] = useState(item.item_year != null ? String(item.item_year) : "");
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState(item.default_tax_code_id ?? "");
  const [material, setMaterial] = useState(item.material ?? "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(item.country_of_origin ?? "");
  const [supplierStyleNumber, setSupplierStyleNumber] = useState(item.supplier_style_number ?? "");
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
          groupId: groupId || null,
          itemYear: itemYear ? Number(itemYear) : null,
          defaultTaxCodeId: defaultTaxCodeId || null,
          material: material || null,
          countryOfOrigin: countryOfOrigin || null,
          supplierStyleNumber: supplierStyleNumber || null,
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
      <Field label="Group">
        <SelectInput value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">None</option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.code}
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
      <Field label="Material">
        <TextInput value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. 100% Cotton" />
      </Field>
      <Field label="Country of Origin">
        <TextInput value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} placeholder="e.g. Bangladesh" />
      </Field>
      <Field label="Supplier Style #">
        <TextInput value={supplierStyleNumber} onChange={(e) => setSupplierStyleNumber(e.target.value)} placeholder="Supplier's own code" />
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
  const [costDrafts, setCostDrafts] = useState<Record<string, { standardCost: string; weightKg: string }>>({});
  const [savingAttributesId, setSavingAttributesId] = useState<string | null>(null);

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

  function costDraft(variant: ItemVariant) {
    return costDrafts[variant.id] ?? { standardCost: variant.standard_cost ?? "", weightKg: variant.weight_kg ?? "" };
  }

  async function saveAttributes(variant: ItemVariant) {
    const draft = costDraft(variant);
    setSavingAttributesId(variant.id);
    try {
      await apiRequest(`/api/item-variants/${variant.id}/attributes`, {
        method: "POST",
        token,
        companyId,
        body: {
          standardCost: draft.standardCost ? Number(draft.standardCost) : null,
          weightKg: draft.weightKg ? Number(draft.weightKg) : null,
        },
      });
      onChanged();
    } finally {
      setSavingAttributesId(null);
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
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
              <label className="text-xs text-slate-500">Standard cost</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={costDraft(v).standardCost}
                onChange={(e) => setCostDrafts((prev) => ({ ...prev, [v.id]: { ...costDraft(v), standardCost: e.target.value } }))}
                className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:border-brand-400 focus:outline-none"
              />
              <label className="text-xs text-slate-500">Weight (kg)</label>
              <input
                type="number"
                min={0}
                step="0.001"
                value={costDraft(v).weightKg}
                onChange={(e) => setCostDrafts((prev) => ({ ...prev, [v.id]: { ...costDraft(v), weightKg: e.target.value } }))}
                className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:border-brand-400 focus:outline-none"
              />
              <button
                onClick={() => saveAttributes(v)}
                disabled={savingAttributesId === v.id}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-30"
              >
                {savingAttributesId === v.id ? "Saving..." : "Save"}
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

const IMPORT_TEMPLATE_HEADER = [
  "item_code", "name_en", "name_ar", "brand_code", "category_code", "season_code", "item_year",
  "material", "country_of_origin", "supplier_style_number", "base_unit_code", "default_tax_code",
  "variant_code", "color", "size", "barcode", "standard_cost", "weight_kg", "reorder_point",
  "store_code", "opening_qty", "retail_price", "wholesale_price", "tender_price", "bigsale_price", "reference_price",
];

// item_code left blank on purpose -- shows the minimal-effort case (code
// and barcode both generated by the system); a catalog with its own
// coding convention can still fill item_code in and it's respected as-is.
const IMPORT_TEMPLATE_EXAMPLE = [
  "", "Basic Tee", "تيشيرت أساسي", "GEN", "APPAREL", "SS26", "2026",
  "100% Cotton", "Bangladesh", "SUP-001", "PC", "VAT15",
  "IT-1001-BLK-M", "Black", "M", "", "15.00", "0.200", "10",
  "ST01", "50", "35.00", "25.00", "", "", "30.00",
];

function downloadImportTemplate() {
  const csv = `${IMPORT_TEMPLATE_HEADER.join(",")}\n${IMPORT_TEMPLATE_EXAMPLE.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "item_import_template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface ImportRowResult {
  row: number;
  itemCode: string;
  variantCode: string;
  status: "created" | "error";
  message?: string;
  internalBarcode?: string;
}

interface ImportSummary {
  totalRows: number;
  created: number;
  failed: number;
  results: ImportRowResult[];
}

function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { token, companyId } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setError(null);
    setUploading(true);
    setSummary(null);
    try {
      const result = await uploadFile<ImportSummary>("/api/items/bulk-import", file, { token, companyId });
      setSummary(result);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to import file");
    } finally {
      setUploading(false);
    }
  }

  const failedRows = summary?.results.filter((r) => r.status === "error") ?? [];

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Upload a CSV to create many items/variants at once. Each row creates a new item the first time its item_code is
        seen (or adds a variant to an existing one). Leave item_code blank to have one generated automatically — an
        internal barcode is always generated automatically for every new variant. variant_code and name_en are still
        required; a blank name_ar falls back to name_en so a sheet that hasn't been translated yet isn't blocked.
      </p>
      <button
        type="button"
        onClick={downloadImportTemplate}
        className="mb-4 flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <Download size={14} /> Download CSV template
      </button>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="mb-3 block w-full text-sm text-slate-600" />
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <button
        type="button"
        onClick={handleUpload}
        disabled={uploading}
        className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {uploading ? "Importing..." : "Import"}
      </button>

      {summary && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="mb-3 flex gap-4 text-sm">
            <span className="text-slate-500">Total: {summary.totalRows}</span>
            <span className="font-medium text-green-700">Created: {summary.created}</span>
            {summary.failed > 0 && <span className="font-medium text-red-600">Failed: {summary.failed}</span>}
          </div>
          {failedRows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-red-100">
              {failedRows.map((r) => (
                <div key={r.row} className="border-b border-red-50 px-3 py-1.5 text-xs last:border-b-0">
                  <span className="font-mono text-slate-500">row {r.row}</span>{" "}
                  <span className="text-slate-700">
                    {r.itemCode || "?"} / {r.variantCode || "?"}
                  </span>
                  <span className="text-red-600"> — {r.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemsTab() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Item>("/api/items");
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
        toolbarExtra={
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload size={14} /> Bulk Import
          </button>
        }
      />
      {showNew && (
        <Modal title="New Item" onClose={() => setShowNew(false)}>
          <NewItemForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
      {showImport && (
        <Modal title="Bulk Import Items" onClose={() => setShowImport(false)}>
          <BulkImportModal onClose={() => setShowImport(false)} onImported={reload} />
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

interface VariantRow {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
  reorder_point: string;
  standard_cost: string | null;
  weight_kg: string | null;
  item_id: string;
  item_code: string;
  name_en: string;
  name_ar: string;
  brand_name: string | null;
  category_name: string | null;
  season_name: string | null;
  group_name: string | null;
  primary_barcode: string | null;
}

interface VariantSearchResponse {
  rows: VariantRow[];
  total: number;
  page: number;
  pageSize: number;
}

type VariantSortColumn = "variantCode" | "itemCode" | "name" | "color" | "size" | "standardCost" | "reorderPoint" | "status";

interface VariantFilters {
  search: string;
  itemCode: string;
  variantCode: string;
  name: string;
  color: string;
  size: string;
  barcode: string;
  brandId: string;
  categoryId: string;
  seasonId: string;
  groupId: string;
  isActive: string; // "" | "true" | "false"
}

const EMPTY_VARIANT_FILTERS: VariantFilters = {
  search: "", itemCode: "", variantCode: "", name: "", color: "", size: "", barcode: "",
  brandId: "", categoryId: "", seasonId: "", groupId: "", isActive: "",
};

/**
 * A flat, one-row-per-variant grid with an Excel-style filter row under the
 * headers, built to stay usable when the catalog runs into the millions of
 * variants -- everything (search, filters, sorting, paging) happens on the
 * server via GET /item-variants, never by loading the whole catalog into
 * the browser and filtering client-side the way the grouped Items tab does.
 */
interface LabelPriceList {
  id: string;
  is_default: boolean;
}

interface LabelPriceListItem {
  item_variant_id: string;
  price: string;
}

function LabelBarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        height: 40,
        margin: 0,
      });
    } catch {
      // Some stored barcodes are short/legacy values CODE128 still renders
      // fine, but a genuinely invalid string shouldn't crash the whole
      // print run -- leave that one label's barcode blank.
    }
  }, [value]);

  return <svg ref={ref} />;
}

function PrintLabelsModal({ variants, onClose }: { variants: VariantRow[]; onClose: () => void }) {
  const { token, companyId } = useAuth();
  const { data: priceLists } = useApiList<LabelPriceList>("/api/price-lists");
  const defaultPriceListId = priceLists?.find((p) => p.is_default)?.id ?? null;
  const [priceMap, setPriceMap] = useState<Record<string, string>>({});
  const [copies, setCopies] = useState<Record<string, number>>(() => Object.fromEntries(variants.map((v) => [v.id, 1])));
  const [showPrice, setShowPrice] = useState(true);

  useEffect(() => {
    if (!defaultPriceListId || !token || !companyId) return;
    apiRequest<LabelPriceListItem[]>(`/api/price-lists/${defaultPriceListId}/items`, { token, companyId }).then((items) => {
      setPriceMap(Object.fromEntries(items.map((i) => [i.item_variant_id, i.price])));
    });
  }, [defaultPriceListId, token, companyId]);

  const printable = variants.filter((v) => v.primary_barcode);
  const skipped = variants.filter((v) => !v.primary_barcode);
  const labels = printable.flatMap((v) => Array.from({ length: Math.max(0, copies[v.id] ?? 1) }, () => v));

  return (
    <Modal title={`Print Labels (${printable.length})`} onClose={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #barcode-print-area, #barcode-print-area * { visibility: visible; }
          #barcode-print-area { position: fixed; inset: 0; width: 100%; margin: 0; padding: 8mm; }
        }
      `}</style>

      {skipped.length > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {skipped.length} selected variant{skipped.length === 1 ? "" : "s"} have no barcode and will be skipped:{" "}
          {skipped.map((v) => v.variant_code).join(", ")}.
        </p>
      )}

      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
        Show price (from the default price list) on each label
      </label>

      <div className="mb-4 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-2">
        {printable.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-slate-700">
              {v.name_en} <span className="text-xs text-slate-400">({v.variant_code})</span>
            </span>
            <div className="flex flex-none items-center gap-1.5">
              <span className="text-xs text-slate-400">Copies</span>
              <input
                type="number"
                min={0}
                value={copies[v.id] ?? 1}
                onChange={(e) => setCopies((prev) => ({ ...prev, [v.id]: Number(e.target.value) }))}
                className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-end text-xs tabular-nums focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => window.print()}
        disabled={labels.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        <Printer size={15} /> Print {labels.length} Label{labels.length === 1 ? "" : "s"}
      </button>

      <div id="barcode-print-area" className="hidden print:grid print:grid-cols-3 print:gap-3">
        {labels.map((v, i) => (
          <div key={`${v.id}-${i}`} className="flex flex-col items-center border border-dashed border-slate-300 p-2 text-center">
            <div className="w-full truncate text-[10px] font-medium text-slate-900">{v.name_en}</div>
            <div className="text-[9px] text-slate-500">
              {[v.color, v.size].filter(Boolean).join(" / ") || v.variant_code}
            </div>
            <LabelBarcodeSvg value={v.primary_barcode!} />
            <div className="font-mono text-[9px] text-slate-700">{v.primary_barcode}</div>
            {showPrice && priceMap[v.id] && <div className="mt-0.5 text-xs font-semibold text-slate-900">{Number(priceMap[v.id]).toFixed(2)}</div>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AllVariantsTab() {
  const { data: brands } = useApiList<Brand>("/api/brands");
  const { data: categories } = useApiList<Category>("/api/categories");
  const { data: seasons } = useApiList<Season>("/api/seasons");
  const { data: groups } = useApiList<ItemGroup>("/api/item-groups");
  const { token, companyId } = useAuth();

  const [filters, setFilters] = useState<VariantFilters>(EMPTY_VARIANT_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState<VariantFilters>(EMPTY_VARIANT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<VariantSortColumn>("itemCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [result, setResult] = useState<VariantSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [reorderDrafts, setReorderDrafts] = useState<Record<string, string>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  // Keyed by id rather than just a Set<string> so a selection made on one
  // page survives paging away and back -- the row data (needed for the
  // label itself) doesn't have to be re-fetched to print it.
  const [selected, setSelected] = useState<Record<string, VariantRow>>({});
  const [showPrintLabels, setShowPrintLabels] = useState(false);

  // Debounce free-typed filter input so every keystroke doesn't hit the
  // server -- 300ms after the user stops typing, the debounced value (and
  // therefore the actual fetch below) updates and resets to page 1.
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
    for (const [key, value] of Object.entries(debouncedFilters)) {
      if (value) params.set(key, value);
    }
    apiRequest<VariantSearchResponse>(`/api/item-variants?${params.toString()}`, { token, companyId })
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setCostDrafts({});
          setReorderDrafts({});
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load variants");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, companyId, page, pageSize, sortBy, sortDir, debouncedFilters]);

  function updateFilter(key: keyof VariantFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function patchRow(id: string, patch: Partial<VariantRow>) {
    setResult((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev));
  }

  async function saveCost(row: VariantRow, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;
    if (value === (row.standard_cost !== null ? Number(row.standard_cost) : null)) return;
    setSavingCell(`${row.id}:cost`);
    setError(null);
    try {
      await apiRequest(`/api/item-variants/${row.id}/attributes`, {
        method: "POST",
        token,
        companyId,
        body: { standardCost: value, weightKg: row.weight_kg ? Number(row.weight_kg) : null },
      });
      patchRow(row.id, { standard_cost: value !== null ? String(value) : null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save cost");
    } finally {
      setSavingCell(null);
    }
  }

  async function saveReorderPoint(row: VariantRow, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    if (value === Number(row.reorder_point)) return;
    setSavingCell(`${row.id}:reorder`);
    setError(null);
    try {
      await apiRequest(`/api/item-variants/${row.id}/reorder-point`, {
        method: "POST",
        token,
        companyId,
        body: { reorderPoint: value },
      });
      patchRow(row.id, { reorder_point: String(value) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save reorder point");
    } finally {
      setSavingCell(null);
    }
  }

  async function toggleStatus(row: VariantRow) {
    setSavingCell(`${row.id}:status`);
    setError(null);
    try {
      await apiRequest(`/api/item-variants/${row.id}/${row.is_active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        token,
        companyId,
      });
      patchRow(row.id, { is_active: !row.is_active });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change status");
    } finally {
      setSavingCell(null);
    }
  }

  function toggleSelected(row: VariantRow) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[row.id]) delete next[row.id];
      else next[row.id] = row;
      return next;
    });
  }

  function toggleSelectPage() {
    const rows = result?.rows ?? [];
    const allSelected = rows.length > 0 && rows.every((r) => selected[r.id]);
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (allSelected) delete next[r.id];
        else next[r.id] = r;
      }
      return next;
    });
  }

  function toggleSort(col: VariantSortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  function sortIndicator(col: VariantSortColumn) {
    if (sortBy !== col) return null;
    return <span className="ms-1 text-slate-400">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  const thClass = "cursor-pointer select-none whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-600";
  const filterInputClass = "w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:border-brand-400 focus:outline-none";

  const editableInputClass = "w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-end text-xs tabular-nums hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:outline-none";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={filters.search}
          onChange={(e) => updateFilter("search", e.target.value)}
          placeholder="Search item code, name, or variant code..."
          className="min-w-64 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none"
        />
        {(Object.keys(filters) as Array<keyof VariantFilters>).some((k) => filters[k]) && (
          <button
            onClick={() => setFilters(EMPTY_VARIANT_FILTERS)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
        <span className="text-sm text-slate-500">
          {result ? `${result.total.toLocaleString()} variant${result.total === 1 ? "" : "s"}` : loading ? "Loading..." : ""}
        </span>
        {Object.keys(selected).length > 0 && (
          <button
            onClick={() => setShowPrintLabels(true)}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer size={13} /> Print Labels ({Object.keys(selected).length})
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={(result?.rows.length ?? 0) > 0 && result!.rows.every((r) => selected[r.id])}
                  onChange={toggleSelectPage}
                />
              </th>
              <th className={thClass} onClick={() => toggleSort("variantCode")}>Variant Code{sortIndicator("variantCode")}</th>
              <th className={thClass} onClick={() => toggleSort("itemCode")}>Item Code{sortIndicator("itemCode")}</th>
              <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400">Brand</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400">Category</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400">Season</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400">Group</th>
              <th className={thClass} onClick={() => toggleSort("color")}>Color{sortIndicator("color")}</th>
              <th className={thClass} onClick={() => toggleSort("size")}>Size{sortIndicator("size")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium uppercase tracking-wide text-slate-400">Barcode</th>
              <th className={`${thClass} text-end`} onClick={() => toggleSort("standardCost")}>Cost{sortIndicator("standardCost")}</th>
              <th className={`${thClass} text-end`} onClick={() => toggleSort("reorderPoint")}>Reorder{sortIndicator("reorderPoint")}</th>
              <th className={thClass} onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
            </tr>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.variantCode} onChange={(e) => updateFilter("variantCode", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.itemCode} onChange={(e) => updateFilter("itemCode", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.name} onChange={(e) => updateFilter("name", e.target.value)} /></th>
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.brandId} onChange={(e) => updateFilter("brandId", e.target.value)}>
                  <option value="">All</option>
                  {brands?.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select>
              </th>
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.categoryId} onChange={(e) => updateFilter("categoryId", e.target.value)}>
                  <option value="">All</option>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </th>
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.seasonId} onChange={(e) => updateFilter("seasonId", e.target.value)}>
                  <option value="">All</option>
                  {seasons?.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                </select>
              </th>
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.groupId} onChange={(e) => updateFilter("groupId", e.target.value)}>
                  <option value="">All</option>
                  {groups?.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
                </select>
              </th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.color} onChange={(e) => updateFilter("color", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.size} onChange={(e) => updateFilter("size", e.target.value)} /></th>
              <th className="px-2 py-1.5"><input className={filterInputClass} value={filters.barcode} onChange={(e) => updateFilter("barcode", e.target.value)} /></th>
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5">
                <select className={filterInputClass} value={filters.isActive} onChange={(e) => updateFilter("isActive", e.target.value)}>
                  <option value="">All</option>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {result?.rows.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-12 text-center text-sm text-slate-400">
                  No variants match these filters.
                </td>
              </tr>
            )}
            {result?.rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-2 py-2">
                  <input type="checkbox" checked={Boolean(selected[r.id])} onChange={() => toggleSelected(r)} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">{r.variant_code}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">{r.item_code}</td>
                <td className="px-3 py-2 text-slate-900">{r.name_en}</td>
                <td className="px-3 py-2 text-slate-600">{r.brand_name ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.category_name ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.season_name ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.group_name ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.color ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.size ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">{r.primary_barcode ?? "—"}</td>
                <td className="px-1 py-1 text-end">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={editableInputClass}
                    value={costDrafts[r.id] ?? r.standard_cost ?? ""}
                    onChange={(e) => setCostDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    onBlur={(e) => saveCost(r, e.target.value)}
                    disabled={savingCell === `${r.id}:cost`}
                    placeholder="—"
                  />
                </td>
                <td className="px-1 py-1 text-end">
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    className={editableInputClass}
                    value={reorderDrafts[r.id] ?? r.reorder_point}
                    onChange={(e) => setReorderDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    onBlur={(e) => saveReorderPoint(r, e.target.value)}
                    disabled={savingCell === `${r.id}:reorder`}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggleStatus(r)}
                    disabled={savingCell === `${r.id}:status`}
                    className="disabled:opacity-50"
                    title={r.is_active ? "Click to deactivate" : "Click to reactivate"}
                  >
                    <StatusBadge status={r.is_active ? "active" : "inactive"} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result && result.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-slate-200 px-2 py-1 text-xs"
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
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showPrintLabels && (
        <PrintLabelsModal variants={Object.values(selected)} onClose={() => setShowPrintLabels(false)} />
      )}
    </div>
  );
}

// Embedded directly as the Inventory page's "Items" tab -- no h1/page wrapper
// of its own, since Inventory already provides one.
export function ItemsSection() {
  const { t } = useTranslation();
  const tabs = useMemo(
    () => [
      { key: "items", label: t("nav.items"), content: <ItemsTab /> },
      { key: "all-variants", label: "All Variants", content: <AllVariantsTab /> },
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
      {
        key: "groups",
        label: "Groups",
        content: <ClassificationTab title="Group" basePath="/api/item-groups" emptyText="No groups found." />,
      },
    ],
    [t],
  );
  return <Tabs tabs={tabs} />;
}
