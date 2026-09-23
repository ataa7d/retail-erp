import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ChevronRight } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-shell-900 bg-[radial-gradient(circle_at_top,rgba(122,180,245,0.18),transparent_55%)]">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white p-8 shadow-2xl">
        <h1 className="mb-1 text-lg font-semibold text-slate-900">{t("companyPicker.title")}</h1>
        <p className="mb-6 text-sm text-slate-500">{t("companyPicker.subtitle")}</p>

        {companies.length === 0 && <p className="text-sm text-slate-500">{t("companyPicker.none")}</p>}

        <div className="space-y-2">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className="group flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-start text-sm transition-colors hover:border-brand-400 hover:bg-brand-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-600">
                <Building2 size={17} />
              </span>
              <span className="flex-1">
                <div className="font-medium text-slate-900">{c.name_en}</div>
                <div className="text-xs text-slate-500">{c.company_code}</div>
              </span>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-brand-500" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
