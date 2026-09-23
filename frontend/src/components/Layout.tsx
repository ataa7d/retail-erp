import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";

const navItems = [
  { to: "/", label: "nav.dashboard", permission: null },
  { to: "/items", label: "nav.items", permission: "inventory.items.manage" },
  { to: "/customers", label: "nav.customers", permission: null },
  { to: "/inventory", label: "nav.inventory", permission: "inventory.adjustment.post" },
  { to: "/purchasing", label: "nav.purchasing", permission: "purchasing.po.create" },
  { to: "/reports", label: "nav.reports", permission: "accounting.reports.view" },
  { to: "/hr", label: "nav.hr", permission: "hr.employee.manage" },
  { to: "/assets", label: "nav.assets", permission: "assets.fixed_asset.manage" },
  { to: "/admin", label: "nav.admin", permission: "admin.users.manage" },
] as const;

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const company = companies.find((c) => c.id === companyId);

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language.startsWith("ar") ? "en" : "ar");
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 flex-col border-e border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-sm font-semibold text-slate-900">{t("app.title")}</div>
          <div className="mt-1 truncate text-xs text-slate-500">
            {i18n.language.startsWith("ar") ? company?.name_ar : company?.name_en}
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems
            .filter((item) => !item.permission || hasPermission(item.permission))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-2 text-sm ${
                    isActive ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-100"
                  }`
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
        </nav>

        <div className="space-y-1 border-t border-slate-200 p-2">
          <button onClick={toggleLanguage} className="block w-full rounded-md px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100">
            {i18n.language.startsWith("ar") ? "English" : "العربية"}
          </button>
          <NavLink to="/select-company" className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            {t("nav.switchCompany")}
          </NavLink>
          <button onClick={handleLogout} className="block w-full rounded-md px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100">
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6">
        <div className="mb-4 text-xs text-slate-400">{me?.user.email}</div>
        <Outlet />
      </main>
    </div>
  );
}
