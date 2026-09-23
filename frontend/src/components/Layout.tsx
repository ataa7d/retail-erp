import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Package,
  Users,
  Warehouse,
  ShoppingCart,
  BarChart3,
  UserCog,
  Building2,
  ShieldCheck,
  Landmark,
  Search,
  Bell,
  Globe,
  ChevronDown,
  LogOut,
  Building,
} from "lucide-react";
import { useAuth } from "../lib/auth";

const navItems = [
  { to: "/", label: "nav.dashboard", permission: null, icon: LayoutDashboard },
  { to: "/items", label: "nav.items", permission: "inventory.items.manage", icon: Package },
  { to: "/customers", label: "nav.customers", permission: null, icon: Users },
  { to: "/inventory", label: "nav.inventory", permission: "inventory.adjustment.post", icon: Warehouse },
  { to: "/purchasing", label: "nav.purchasing", permission: "purchasing.po.create", icon: ShoppingCart },
  { to: "/accounting", label: "nav.accounting", permission: "accounting.journal.post", icon: Landmark },
  { to: "/reports", label: "nav.reports", permission: "accounting.reports.view", icon: BarChart3 },
  { to: "/hr", label: "nav.hr", permission: "hr.employee.manage", icon: UserCog },
  { to: "/assets", label: "nav.assets", permission: "assets.fixed_asset.manage", icon: Building2 },
  { to: "/admin", label: "nav.admin", permission: "admin.users.manage", icon: ShieldCheck },
] as const;

function initials(email: string): string {
  const name = email.split("@")[0] ?? "?";
  return name.slice(0, 2).toUpperCase();
}

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const company = companies.find((c) => c.id === companyId);
  const companyName = i18n.language.startsWith("ar") ? company?.name_ar : company?.name_en;

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language.startsWith("ar") ? "en" : "ar");
    setMenuOpen(false);
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f6f8]">
      {/* Shell bar */}
      <header className="flex h-12 shrink-0 items-center gap-4 bg-shell-900 px-4 text-white shadow-sm">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-500 text-xs font-bold">RE</div>
          <span className="hidden text-sm sm:inline">{t("app.title")}</span>
        </div>

        <div className="mx-auto flex max-w-xl flex-1 items-center rounded-md bg-white/10 px-3 py-1.5 text-sm text-white/70 focus-within:bg-white/15">
          <Search size={15} className="me-2 shrink-0" />
          <input
            placeholder="Search..."
            className="w-full bg-transparent text-white placeholder:text-white/50 focus:outline-none"
          />
        </div>

        <button className="rounded-full p-1.5 text-white/80 hover:bg-white/10">
          <Bell size={17} />
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full py-1 pe-2 ps-1 hover:bg-white/10"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-300 text-xs font-semibold text-shell-900">
              {me ? initials(me.user.email) : "?"}
            </div>
            <ChevronDown size={14} className="text-white/70" />
          </button>

          {menuOpen && (
            <div className="absolute end-0 top-10 z-20 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg">
              <div className="border-b border-slate-100 px-3 py-2">
                <div className="truncate font-medium text-slate-900">{me?.user.email}</div>
                <div className="truncate text-xs text-slate-500">{companyName}</div>
              </div>
              <button onClick={toggleLanguage} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
                <Globe size={15} /> {i18n.language.startsWith("ar") ? "English" : "العربية"}
              </button>
              <NavLink
                to="/select-company"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50"
              >
                <Building size={15} /> {t("nav.switchCompany")}
              </NavLink>
              <button onClick={handleLogout} className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50">
                <LogOut size={15} /> {t("nav.logout")}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Nav rail */}
        <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-slate-200 bg-white p-2">
          {navItems
            .filter((item) => !item.permission || hasPermission(item.permission))
            .map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md border-s-[3px] px-2.5 py-2 text-sm transition-colors ${
                      isActive
                        ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                        : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`
                  }
                >
                  <Icon size={16} strokeWidth={2} />
                  {t(item.label)}
                </NavLink>
              );
            })}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
