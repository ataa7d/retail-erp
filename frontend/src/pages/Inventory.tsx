import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Warehouse } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest } from "../lib/api";
import ListPage from "../components/ListPage";
import type { Column } from "../components/DataTable";

interface Store {
  id: string;
  store_code: string;
  name_en: string;
  name_ar: string;
}

interface StockBalance {
  item_variant_id: string;
  qty_on_hand: string;
  avg_unit_cost: string;
  last_movement_at: string | null;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
}

interface Item {
  item_code: string;
  name_en: string;
  name_ar: string;
  variants: ItemVariant[];
}

interface StockRow extends StockBalance {
  itemCode: string;
  itemName: string;
  variantCode: string;
  variantDetail: string;
}

export default function Inventory() {
  const { t, i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: items } = useApiList<Item>("/api/items");
  const [storeId, setStoreId] = useState<string>("");
  const [balances, setBalances] = useState<StockBalance[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    if (stores && stores.length > 0 && !storeId) setStoreId(stores[0]!.id);
  }, [stores, storeId]);

  useEffect(() => {
    if (!token || !companyId || !storeId) return;
    setBalances(null);
    apiRequest<{ asOf: string; balances: StockBalance[] }>(`/api/stock-balances?storeId=${storeId}`, { token, companyId }).then(
      (r) => {
        setBalances(r.balances);
        setAsOf(r.asOf);
      },
    );
  }, [token, companyId, storeId]);

  const variantIndex = useMemo(() => {
    const map = new Map<string, { itemCode: string; itemName: string; variantCode: string; variantDetail: string }>();
    for (const item of items ?? []) {
      for (const v of item.variants) {
        const detail = [v.color, v.size].filter(Boolean).join(" / ");
        map.set(v.id, {
          itemCode: item.item_code,
          itemName: i18n.language.startsWith("ar") ? item.name_ar : item.name_en,
          variantCode: v.variant_code,
          variantDetail: detail,
        });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, i18n.language]);

  const rows: StockRow[] | null = balances?.map((b) => {
    const info = variantIndex.get(b.item_variant_id);
    return {
      ...b,
      itemCode: info?.itemCode ?? "—",
      itemName: info?.itemName ?? "Unknown item",
      variantCode: info?.variantCode ?? "—",
      variantDetail: info?.variantDetail ?? "",
    };
  }) ?? null;

  const columns: Column<StockRow>[] = [
    { key: "code", header: "Item", render: (r) => <span className="font-mono text-xs text-slate-500">{r.itemCode}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.itemName}</div>
          {r.variantDetail && <div className="text-xs text-slate-400">{r.variantDetail}</div>}
        </div>
      ),
    },
    { key: "qty", header: "Qty on Hand", render: (r) => Number(r.qty_on_hand).toLocaleString(), numeric: true },
    { key: "cost", header: "Avg Unit Cost", render: (r) => Number(r.avg_unit_cost).toFixed(2), numeric: true },
  ];

  return (
    <ListPage
      title={t("nav.inventory")}
      subtitle={asOf ? `As of ${new Date(asOf).toLocaleString()}` : undefined}
      data={rows}
      error={null}
      columns={columns}
      getRowKey={(r) => r.item_variant_id}
      getSearchText={(r) => `${r.itemCode} ${r.itemName} ${r.variantCode}`}
      emptyIcon={Warehouse}
      emptyText="No stock at this store."
      searchPlaceholder="Search stock..."
      toolbarExtra={
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        >
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {i18n.language.startsWith("ar") ? s.name_ar : s.name_en}
            </option>
          ))}
        </select>
      }
    />
  );
}
