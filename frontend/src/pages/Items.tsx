import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Plus, Package } from "lucide-react";
import { useAuth } from "../lib/auth";
import { apiRequest } from "../lib/api";

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

export default function Items() {
  const { t, i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<Item[]>("/api/items", { token, companyId })
      .then(setItems)
      .catch(() => setError(t("common.error")));
  }, [token, companyId, t]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.item_code.toLowerCase().includes(q) || i.name_en.toLowerCase().includes(q) || i.name_ar.includes(q),
    );
  }, [items, query]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t("nav.items")}</h1>
          <p className="text-sm text-slate-500">{items ? `${filtered.length} of ${items.length}` : t("common.loading")}</p>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600">
          <Plus size={16} /> New Item
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus-within:border-brand-400 focus-within:bg-white">
            <Search size={15} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code or name..."
              className="w-full bg-transparent focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="p-6 text-sm text-red-600">{error}</p>}

        {!error && items && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-400">
            <Package size={32} strokeWidth={1.5} />
            <p className="text-sm">No items found.</p>
          </div>
        )}

        {!error && filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-start text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 text-start">Code</th>
                <th className="px-4 py-2.5 text-start">{i18n.language.startsWith("ar") ? "الاسم" : "Name"}</th>
                <th className="px-4 py-2.5 text-start">Variants</th>
                <th className="px-4 py-2.5 text-start">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.item_code}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {i18n.language.startsWith("ar") ? item.name_ar : item.name_en}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600">{item.variants.length}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
