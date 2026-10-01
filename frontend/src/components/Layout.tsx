import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Receipt,
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
  Monitor,
  ClipboardList,
  AlertTriangle,
  Sun,
  Moon,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { apiRequest } from "../lib/api";

// Items now lives inside Inventory's tabs -- this link stays visible to
// anyone who could reach Items before (inventory.items.manage), not just
// inventory.adjustment.post, so nobody loses access they already had.
// Customers (moved into Accounting below) doesn't get the same treatment:
// it used to be visible to *everyone* (no permission at all), and Accounting
// is gated behind accounting.journal.post -- users who could see customers
// but not post journals will lose the sidebar link. Flagged, not silently
// widened, since broadening Accounting's gate would expose GL data instead.
// subItems mirror each module's own internal <Tabs> keys/labels exactly
// (Purchasing.tsx, Sales.tsx, etc.) so a sub-item navigates straight to
// that tab via the same `state: { fromTab }` mechanism every "New X" page
// and Dashboard KPI tile already uses -- no new routing concept, just
// surfacing the existing one one level higher, in the sidebar itself.
const navItems = [
  { to: "/", label: "nav.dashboard", permission: null, icon: LayoutDashboard },
  {
    to: "/sales",
    label: "nav.sales",
    permission: "sales.pos_invoice.create",
    icon: Receipt,
    subItems: [
      { key: "quotations", label: "Quotations" },
      { key: "invoices", label: "Sales Invoices" },
      { key: "credits", label: "Credit Notes" },
      { key: "gift-cards", label: "Gift Cards" },
      { key: "deposits", label: "Customer Deposits" },
      { key: "price-lists", label: "Price Lists" },
      // Not a tab on Sales's own page -- POS Terminal is a separate,
      // full-screen route with no sidebar at all. `to` overrides the
      // default "navigate to the parent module with this fromTab" behavior
      // every other sub-item uses, going straight to /pos instead.
      { key: "pos", label: "POS Terminal", to: "/pos", icon: Monitor },
    ],
  },
  {
    to: "/inventory",
    label: "nav.inventory",
    permission: ["inventory.adjustment.post", "inventory.items.manage"],
    icon: Warehouse,
    subItems: [
      { key: "items", label: "Items" },
      { key: "stock", label: "Stock" },
      { key: "transfers", label: "Transfers" },
      { key: "transfer-orders", label: "Transfer Orders" },
      { key: "adjustments", label: "Adjustments" },
    ],
  },
  {
    to: "/purchasing",
    label: "nav.purchasing",
    permission: "purchasing.po.create",
    icon: ShoppingCart,
    subItems: [
      { key: "requisitions", label: "Requisitions" },
      { key: "reorder", label: "Reorder Suggestions" },
      { key: "pos", label: "Purchase Orders" },
      { key: "receipts", label: "Goods Receipts" },
      { key: "invoices", label: "Supplier Invoices" },
      { key: "returns", label: "Purchase Returns" },
      { key: "suppliers", label: "Suppliers" },
    ],
  },
  {
    to: "/accounting",
    label: "nav.accounting",
    permission: "accounting.journal.post",
    icon: Landmark,
    subItems: [
      { key: "coa", label: "Chart of Accounts" },
      { key: "customers", label: "Customers" },
      { key: "tax-codes", label: "Tax Codes" },
      { key: "journals", label: "Journals" },
      { key: "receipts", label: "Customer Receipts" },
      { key: "payments", label: "Supplier Payments" },
      { key: "bank", label: "Bank Reconciliation" },
      { key: "ar", label: "AR Ageing" },
      { key: "ap", label: "AP Ageing" },
      { key: "fx", label: "Exchange Rates" },
      { key: "close", label: "Period Close" },
      { key: "budgets", label: "Budgets" },
    ],
  },
  {
    to: "/reports",
    label: "nav.reports",
    permission: "accounting.reports.view",
    icon: BarChart3,
    subItems: [
      { key: "tb", label: "Trial Balance" },
      { key: "is", label: "Income Statement" },
      { key: "bs", label: "Balance Sheet" },
      { key: "cs", label: "Customer Statement" },
      { key: "sv", label: "Stock Valuation" },
      { key: "cs2", label: "Cash Shifts" },
      { key: "bva", label: "Budget vs Actual" },
      { key: "vat", label: "VAT Summary" },
    ],
  },
  {
    to: "/hr",
    label: "nav.hr",
    permission: "hr.employee.manage",
    icon: UserCog,
    subItems: [
      { key: "employees", label: "Employees" },
      { key: "payroll", label: "Payroll Runs" },
    ],
  },
  {
    to: "/assets",
    label: "nav.assets",
    permission: "assets.fixed_asset.manage",
    icon: Building2,
    subItems: [
      { key: "assets", label: "Assets" },
      { key: "depreciation", label: "Depreciation Runs" },
    ],
  },
  {
    to: "/admin",
    label: "nav.admin",
    permission: "admin.users.manage",
    icon: ShieldCheck,
    subItems: [
      { key: "company", label: "Company Profile" },
      { key: "branches-stores", label: "Branches & Stores" },
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles" },
      { key: "pos-devices", label: "POS Devices" },
      { key: "offline-sync", label: "Offline Sync" },
      { key: "zatca", label: "ZATCA Onboarding" },
      { key: "audit", label: "Audit Log" },
    ],
  },
] as const;

function initials(email: string): string {
  const name = email.split("@")[0] ?? "?";
  return name.slice(0, 2).toUpperCase();
}

interface NotificationItem {
  id: string;
  type: "requisition_pending" | "low_stock";
  title: string;
  detail: string;
  link: string;
}

function NotificationBell() {
  const { token, companyId } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    let cancelled = false;
    apiRequest<{ count: number; items: NotificationItem[] }>("/api/notifications", { token, companyId })
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, companyId]);

  const count = items?.length ?? 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative rounded-full p-1.5 text-white/80 hover:bg-white/10">
        <Bell size={17} />
        {count > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-10 z-20 w-80 rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Notifications
          </div>
          {items === null && <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">Loading...</div>}
          {items?.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">You're all caught up.</div>
          )}
          <div className="max-h-80 overflow-y-auto">
            {items?.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setOpen(false);
                  navigate(item.link);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                {item.type === "requisition_pending" ? (
                  <ClipboardList size={15} className="mt-0.5 shrink-0 text-blue-500" />
                ) : (
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{item.detail}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { me, companies, companyId, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Auto-opens a module's dropdown the moment you arrive in it from
  // somewhere else -- but only on that transition, not on every sub-path
  // change while you're already inside it, so a manual collapse (see the
  // header/chevron handlers below) isn't immediately re-forced open by
  // this effect the next time a tab inside the same module navigates.
  const lastAutoModule = useRef<string | null>(null);
  useEffect(() => {
    const current = navItems.find((item) => item.to !== "/" && location.pathname.startsWith(item.to));
    const currentKey = current && "subItems" in current ? current.to : null;
    if (currentKey && currentKey !== lastAutoModule.current) {
      setExpanded((prev) => ({ ...prev, [currentKey]: true }));
    }
    lastAutoModule.current = currentKey;
  }, [location.pathname]);

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
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f6f8] dark:bg-[#0b1220]">
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

        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <NotificationBell />

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
            <div className="absolute end-0 top-10 z-20 w-56 rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                <div className="truncate font-medium text-slate-900 dark:text-slate-100">{me?.user.email}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{companyName}</div>
              </div>
              <button onClick={toggleLanguage} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700">
                <Globe size={15} /> {i18n.language.startsWith("ar") ? "English" : "العربية"}
              </button>
              <NavLink
                to="/select-company"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Building size={15} /> {t("nav.switchCompany")}
              </NavLink>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <LogOut size={15} /> {t("nav.logout")}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Nav rail */}
        <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          {navItems
            .filter((item) => {
              if (!item.permission) return true;
              const required = Array.isArray(item.permission) ? item.permission : [item.permission];
              return required.some((p) => hasPermission(p));
            })
            .map((item) => {
              const Icon = item.icon;
              const indent = "indent" in item && item.indent;
              const subItems = "subItems" in item ? item.subItems : null;
              const isOpen = !!expanded[item.to];
              return (
                <div key={item.to}>
                  <div
                    className={`flex items-center rounded-md border-s-[3px] text-sm transition-colors ${indent ? "ms-4" : ""} ${
                      location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to))
                        ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => {
                        if (subItems) setExpanded((prev) => ({ ...prev, [item.to]: !prev[item.to] }));
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 ${indent ? "ps-2 pe-1 text-[13px]" : "px-2.5"}`}
                    >
                      <Icon size={indent ? 14 : 16} strokeWidth={2} className="shrink-0" />
                      <span className="truncate">{t(item.label)}</span>
                    </NavLink>
                    {subItems && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [item.to]: !prev[item.to] }))}
                        className="me-1 shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
                        title={isOpen ? "Collapse" : "Expand"}
                      >
                        <ChevronRight size={14} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                    )}
                  </div>
                  {subItems && isOpen && (
                    <div className="ms-4 mt-0.5 flex flex-col gap-0.5 border-s border-slate-200 ps-2 dark:border-slate-700">
                      {subItems.map((sub) => {
                        const SubIcon = "icon" in sub ? sub.icon : null;
                        return (
                          <button
                            key={sub.key}
                            type="button"
                            onClick={() =>
                              "to" in sub ? navigate(sub.to) : navigate(item.to, { state: { fromTab: sub.key } })
                            }
                            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          >
                            {SubIcon && <SubIcon size={13} strokeWidth={2} className="shrink-0" />}
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
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
