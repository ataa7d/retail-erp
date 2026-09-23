import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId } = useAuth();
  const company = companies.find((c) => c.id === companyId);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">
        {t("dashboard.welcome")}, {me?.user.email}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        {t("dashboard.company")}: {i18n.language.startsWith("ar") ? company?.name_ar : company?.name_en}
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-slate-900">Your roles</h2>
        <ul className="text-sm text-slate-600">
          {me?.roles.map((r) => (
            <li key={r.id + (r.store_id ?? "")}>{r.name}{r.store_id ? ` (store-scoped)` : ""}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
