import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";

export default function CompanyPicker() {
  const { t } = useTranslation();
  const { companies, selectCompany } = useAuth();
  const navigate = useNavigate();

  async function pick(companyId: string) {
    await selectCompany(companyId);
    navigate("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">{t("companyPicker.title")}</h1>
        <p className="mb-6 text-sm text-slate-500">{t("companyPicker.subtitle")}</p>

        {companies.length === 0 && <p className="text-sm text-slate-500">{t("companyPicker.none")}</p>}

        <div className="space-y-2">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className="w-full rounded-md border border-slate-200 px-4 py-3 text-start text-sm hover:border-blue-400 hover:bg-blue-50"
            >
              <div className="font-medium text-slate-900">{c.name_en}</div>
              <div className="text-xs text-slate-500">{c.company_code}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
