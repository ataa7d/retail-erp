import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package, Users, UserCog, Building2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { apiRequest } from "../lib/api";
import KpiTile from "../components/KpiTile";

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, token, hasPermission } = useAuth();
  const company = companies.find((c) => c.id === companyId);

  const [itemCount, setItemCount] = useState<number | null>(null);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [employeeCount, setEmployeeCount] = useState<number | null>(null);
  const [assetCount, setAssetCount] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;

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
        <KpiTile to="/items" label={t("nav.items")} value={itemCount ?? "—"} icon={Package} accent="brand" loading={itemCount === null} />
        <KpiTile to="/customers" label={t("nav.customers")} value={customerCount ?? "—"} icon={Users} accent="green" loading={customerCount === null} />
        {hasPermission("hr.employee.manage") && (
          <KpiTile to="/hr" label={t("nav.hr")} value={employeeCount ?? "—"} icon={UserCog} accent="amber" loading={employeeCount === null} />
        )}
        {hasPermission("assets.fixed_asset.manage") && (
          <KpiTile to="/assets" label={t("nav.assets")} value={assetCount ?? "—"} icon={Building2} accent="slate" loading={assetCount === null} />
        )}
      </div>

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
