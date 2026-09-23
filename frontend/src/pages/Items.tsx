import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { token, companyId } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<Item[]>("/api/items", { token, companyId })
      .then(setItems)
      .catch(() => setError(t("common.error")));
  }, [token, companyId, t]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!items) return <p className="text-sm text-slate-500">{t("common.loading")}</p>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">{t("nav.items")}</h1>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-start">Code</th>
              <th className="px-4 py-2 text-start">Name</th>
              <th className="px-4 py-2 text-start">Variants</th>
              <th className="px-4 py-2 text-start">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{item.item_code}</td>
                <td className="px-4 py-2">{item.name_en}</td>
                <td className="px-4 py-2 text-slate-500">{item.variants.length}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${item.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {item.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No items yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
