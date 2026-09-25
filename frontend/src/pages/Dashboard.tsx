import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Package,
  Users,
  UserCog,
  Building2,
  ShoppingCart,
  CalendarDays,
  Warehouse,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { apiRequest } from "../lib/api";
import { formatMoney, useBaseCurrency } from "../lib/currency";
import KpiTile from "../components/KpiTile";

interface DashboardSummary {
  todaySales: { total: number; count: number };
  monthToDateSales: { total: number; count: number };
  inventoryValue: number;
  arOutstanding: number;
  apOutstanding: number;
  lowStockCount: number;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, token, hasPermission } = useAuth();
  const company = companies.find((c) => c.id === companyId);
  const currency = useBaseCurrency();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [employeeCount, setEmployeeCount] = useState<number | null>(null);
  const [assetCount, setAssetCount] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;

    apiRequest<DashboardSummary>("/api/dashboard/summary", { token, companyId }).then(setSummary);
    apiRequest<unknown[]>("/api/items", { token, companyId }).then((r) => setItemCount(r.length));
    apiRequest<unknown[]>("/api/customers", { token, companyId }).then((r) => setCustomerCount(r.length));
    if (hasPermission("hr.employee.manage")) {
      apiRequest<unknown[]>("/api/employees", { token, companyId }).then((r) => setEmployeeCount(r.length));
    }
    if (hasPermission("assets.fixed_asset.manage")) {
      apiRequest<unknown[]>("/api/fixed-assets", { token, companyId }).then((r) => setAssetCount(r.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);

  const firstName = me?.user.email.split("@")[0] ?? "";
  const loading = summary === null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          {t("dashboard.welcome")}, {firstName}
        </h1>
        <p className="text-sm text-slate-500">
          {i18n.language.startsWith("ar") ? company?.name_ar : company?.name_en}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KpiTile
          to="/sales"
          label="Today's Sales"
          value={loading ? "—" : formatMoney(summary.todaySales.total)}
          icon={ShoppingCart}
          accent="brand"
          loading={loading}
        />
        <KpiTile
          to="/sales"
          label="Sales This Month"
          value={loading ? "—" : formatMoney(summary.monthToDateSales.total)}
          icon={CalendarDays}
          accent="brand"
          loading={loading}
        />
        <KpiTile
          to="/inventory"
          label="Inventory Value"
          value={loading ? "—" : formatMoney(summary.inventoryValue)}
          icon={Warehouse}
          accent="slate"
          loading={loading}
        />
        <KpiTile
          to="/customers"
          label="AR Outstanding"
          value={loading ? "—" : formatMoney(summary.arOutstanding)}
          icon={ArrowDownCircle}
          accent="green"
          loading={loading}
        />
        <KpiTile
          to="/purchasing"
          label="AP Outstanding"
          value={loading ? "—" : formatMoney(summary.apOutstanding)}
          icon={ArrowUpCircle}
          accent="amber"
          loading={loading}
        />
        <KpiTile
          to="/items"
          label="Low Stock Alerts"
          value={loading ? "—" : summary.lowStockCount}
          icon={AlertTriangle}
          accent={!loading && summary.lowStockCount > 0 ? "amber" : "slate"}
          loading={loading}
        />
        <KpiTile to="/items" label={t("nav.items")} value={itemCount ?? "—"} icon={Package} accent="brand" loading={itemCount === null} />
        <KpiTile to="/customers" label={t("nav.customers")} value={customerCount ?? "—"} icon={Users} accent="green" loading={customerCount === null} />
        {hasPermission("hr.employee.manage") && (
          <KpiTile to="/hr" label={t("nav.hr")} value={employeeCount ?? "—"} icon={UserCog} accent="amber" loading={employeeCount === null} />
        )}
        {hasPermission("assets.fixed_asset.manage") && (
          <KpiTile to="/assets" label={t("nav.assets")} value={assetCount ?? "—"} icon={Building2} accent="slate" loading={assetCount === null} />
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">Sales and stock figures are in {currency}.</p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Your roles</h2>
        <div className="flex flex-wrap gap-2">
          {me?.roles.map((r) => (
            <span
              key={r.id + (r.store_id ?? "")}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {r.name}
              {r.store_id ? " · store-scoped" : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
