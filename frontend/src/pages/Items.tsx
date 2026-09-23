import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import { Field, TextInput, FormActions } from "../components/FormField";
import type { Column } from "../components/DataTable";

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
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
  const [itemCode, setItemCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [variantCode, setVariantCode] = useState("");
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
        body: { itemCode, nameEn, nameAr, variantCode },
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
      <Field label="Variant / SKU Code" required>
        <TextInput required value={variantCode} onChange={(e) => setVariantCode(e.target.value)} placeholder="e.g. TS-001-BLK-M" />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        Creates the item with a single default variant. Additional color/size variants can be added afterward.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create Item" />
    </form>
  );
}

export default function Items() {
  const { t, i18n } = useTranslation();
  const { data, error, reload } = useApiList<Item>("/api/items");
  const [showNew, setShowNew] = useState(false);

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
      />
      {showNew && (
        <Modal title="New Item" onClose={() => setShowNew(false)}>
          <NewItemForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}
