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
import { isPushSupported, subscribeToPush } from "../lib/push";
import GlobalSearch from "./GlobalSearch";

// Items now lives inside Inventory's tabs -- this link stays visible to
// anyone who could reach Items before (any of the three permissions that
// replaced the old inventory.items.manage umbrella), not just
// inventory.adjustment.post, so nobody loses access they already had.
// Customers (moved into Accounting below) now carries its own
// sales.customer.view permission (Phase 3 read-access work), granted to
// every active role on deploy, so nobody who could see it before loses
// access; it no longer rides solely on accounting.journal.post.
// subItems mirror each module's own internal <Tabs> keys/labels exactly
// (Purchasing.tsx, Sales.tsx, etc.) so a sub-item navigates straight to
// that tab via the same `state: { fromTab }` mechanism every "New X" page
// and Dashboard KPI tile already uses -- no new routing concept, just
// surfacing the existing one one level higher, in the sidebar itself.
// Each module carries its own accent color (mirrored from the Dashboard's
// KPI tile palette) so the sidebar reads as a set of distinct departments
// at a glance instead of one repeated brand-blue highlight -- color as a
// wayfinding device, not just decoration.
export const navItems = [
  { to: "/", label: "nav.dashboard", permission: null, icon: LayoutDashboard, color: "brand" },
  {
    to: "/sales",
    label: "nav.sales",
    permission: [
      "sales.pos_invoice.create",
      "sales.invoice.view",
      "sales.quotation.view",
      "sales.credit_note.view",
      "sales.gift_card.view",
      "sales.deposit.view",
    ],
    icon: Receipt,
    color: "violet",
    subItems: [
      { key: "quotations", label: "Quotations", permission: "sales.quotation.view" },
      { key: "invoices", label: "Sales Invoices", permission: "sales.invoice.view" },
      { key: "credits", label: "Credit Notes", permission: "sales.credit_note.view" },
      { key: "gift-cards", label: "Gift Cards", permission: "sales.gift_card.view" },
      { key: "deposits", label: "Customer Deposits", permission: "sales.deposit.view" },
      { key: "price-lists", label: "Price Lists", permission: "sales.price_list.manage" },
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
    permission: [
      "inventory.adjustment.post",
      "inventory.items.create",
      "inventory.items.edit",
      "inventory.items.deactivate",
      "inventory.items.view",
      "inventory.stock.view",
      "inventory.transfer.view",
      "inventory.stocktake.view",
    ],
    icon: Warehouse,
    color: "teal",
    subItems: [
      { key: "items", label: "Items", permission: "inventory.items.view" },
      { key: "stock", label: "Stock", permission: "inventory.stock.view" },
      { key: "transfers", label: "Transfers", permission: "inventory.transfer.view" },
      { key: "transfer-orders", label: "Transfer Orders", permission: "inventory.transfer.view" },
      { key: "adjustments", label: "Adjustments", permission: "inventory.stocktake.view" },
    ],
  },
  {
    to: "/purchasing",
    label: "nav.purchasing",
    permission: [
      "purchasing.po.create",
      "purchasing.requisition.view",
      "purchasing.po.view",
      "purchasing.goods_receipt.view",
      "purchasing.supplier_invoice.view",
      "purchasing.return.view",
      "purchasing.supplier.view",
    ],
    icon: ShoppingCart,
    color: "amber",
    subItems: [
      { key: "requisitions", label: "Requisitions", permission: "purchasing.requisition.view" },
      { key: "reorder", label: "Reorder Suggestions", permission: "purchasing.po.view" },
      { key: "pos", label: "Purchase Orders", permission: "purchasing.po.view" },
      { key: "receipts", label: "Goods Receipts", permission: "purchasing.goods_receipt.view" },
      { key: "invoices", label: "Supplier Invoices", permission: "purchasing.supplier_invoice.view" },
      { key: "returns", label: "Purchase Returns", permission: "purchasing.return.view" },
      { key: "suppliers", label: "Suppliers", permission: "purchasing.supplier.view" },
    ],
  },
  {
    to: "/accounting",
    label: "nav.accounting",
    permission: [
      "accounting.journal.post",
      "accounting.coa.view",
      "sales.customer.view",
      "accounting.tax_code.view",
      "sales.loyalty_tier.view",
      "accounting.journal.view",
      "accounting.receipt.view",
      "accounting.payment.view",
      "accounting.bank_account.view",
      "accounting.bank_reconciliation.view",
      "accounting.ar_ageing.view",
      "accounting.ap_ageing.view",
      "accounting.exchange_rate.view",
      "accounting.fiscal_period.view",
      "accounting.budget.view",
    ],
    icon: Landmark,
    color: "green",
    subItems: [
      { key: "coa", label: "Chart of Accounts", permission: "accounting.coa.view" },
      { key: "customers", label: "Customers", permission: "sales.customer.view" },
      { key: "tax-codes", label: "Tax Codes", permission: "accounting.tax_code.view" },
      { key: "loyalty-tiers", label: "Loyalty Tiers", permission: "sales.loyalty_tier.view" },
      { key: "journals", label: "Journals", permission: "accounting.journal.view" },
      { key: "receipts", label: "Customer Receipts", permission: "accounting.receipt.view" },
      { key: "payments", label: "Supplier Payments", permission: "accounting.payment.view" },
      { key: "bank", label: "Bank Reconciliation", permission: "accounting.bank_reconciliation.view" },
      { key: "ar", label: "AR Ageing", permission: "accounting.ar_ageing.view" },
      { key: "ap", label: "AP Ageing", permission: "accounting.ap_ageing.view" },
      { key: "fx", label: "Exchange Rates", permission: "accounting.exchange_rate.view" },
      { key: "close", label: "Period Close", permission: "accounting.fiscal_period.view" },
      { key: "budgets", label: "Budgets", permission: "accounting.budget.view" },
    ],
  },
  {
    to: "/reports",
    label: "nav.reports",
    permission: [
      "accounting.reports.trial_balance.view",
      "accounting.reports.income_statement.view",
      "accounting.reports.balance_sheet.view",
      "accounting.reports.customer_statement.view",
      "accounting.reports.stock_valuation.view",
      "sales.cash_shift.view",
      "accounting.reports.budget_vs_actual.view",
      "accounting.reports.vat_summary.view",
    ],
    icon: BarChart3,
    color: "sky",
    subItems: [
      { key: "tb", label: "Trial Balance", permission: "accounting.reports.trial_balance.view" },
      { key: "is", label: "Income Statement", permission: "accounting.reports.income_statement.view" },
      { key: "bs", label: "Balance Sheet", permission: "accounting.reports.balance_sheet.view" },
      { key: "cs", label: "Customer Statement", permission: "accounting.reports.customer_statement.view" },
      { key: "sv", label: "Stock Valuation", permission: "accounting.reports.stock_valuation.view" },
      { key: "cs2", label: "Cash Shifts", permission: "sales.cash_shift.view" },
      { key: "bva", label: "Budget vs Actual", permission: "accounting.reports.budget_vs_actual.view" },
      { key: "vat", label: "VAT Summary", permission: "accounting.reports.vat_summary.view" },
    ],
  },
  {
    to: "/hr",
    label: "nav.hr",
    permission: ["hr.employee.manage", "hr.employee.view", "hr.payroll.view"],
    icon: UserCog,
    color: "pink",
    subItems: [
      { key: "employees", label: "Employees", permission: "hr.employee.view" },
      { key: "payroll", label: "Payroll Runs", permission: "hr.payroll.view" },
    ],
  },
  {
    to: "/assets",
    label: "nav.assets",
    permission: ["assets.fixed_asset.manage", "assets.fixed_asset.view", "assets.depreciation.view"],
    icon: Building2,
    color: "cyan",
    subItems: [
      { key: "assets", label: "Assets", permission: "assets.fixed_asset.view" },
      { key: "depreciation", label: "Depreciation Runs", permission: "assets.depreciation.view" },
    ],
  },
  {
    to: "/admin",
    label: "nav.admin",
    permission: [
      "admin.users.manage",
      "admin.users.view",
      "admin.roles.manage",
      "admin.roles.view",
      "admin.branches.view",
      "admin.companies.manage",
      "sales.pos_device.manage",
      "admin.zatca_onboarding.view",
      "admin.audit_log.view",
    ],
    icon: ShieldCheck,
    color: "indigo",
    subItems: [
      // Company Profile has no dedicated view permission -- GET
      // /companies/current is an intentionally open shared lookup every
      // invoice print and VAT calc depends on (Sales/POS/HR), so this
      // reuses the existing write permission for tab-only gating, same
      // as Sales' price-lists tab in Phase 2.
      { key: "company", label: "Company Profile", permission: "admin.companies.manage" },
      { key: "branches-stores", label: "Branches & Stores", permission: "admin.branches.view" },
      { key: "users", label: "Users", permission: "admin.users.view" },
      { key: "roles", label: "Roles", permission: "admin.roles.view" },
      // Same reuse: GET /pos-devices is a shared lookup (POS login's
      // device picker for ordinary cashiers), no dedicated view
      // permission exists or is warranted.
      { key: "pos-devices", label: "POS Devices", permission: "sales.pos_device.manage" },
      { key: "offline-sync", label: "Offline Sync", permission: "admin.users.manage" },
      { key: "zatca", label: "ZATCA Onboarding", permission: "admin.zatca_onboarding.view" },
      // Notification preferences are the viewer's own, not company-wide
      // admin config -- no permission needed beyond reaching /admin.
      { key: "notifications", label: "Notification Preferences" },
      { key: "audit", label: "Audit Log", permission: "admin.audit_log.view" },
    ],
  },
] as const;

// Static class strings (not template-built) so Tailwind's scanner picks
// them all up -- one entry per navItem color above.
const NAV_ACTIVE_CLASSES: Record<string, string> = {
  brand: "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  violet: "border-violet-500 bg-violet-50 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  teal: "border-teal-500 bg-teal-50 font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  amber: "border-amber-500 bg-amber-50 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  green: "border-green-500 bg-green-50 font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300",
  sky: "border-sky-500 bg-sky-50 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  pink: "border-pink-500 bg-pink-50 font-medium text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
  cyan: "border-cyan-500 bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  indigo: "border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
};

const NAV_SUBACTIVE_CLASSES: Record<string, string> = {
  brand: "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  violet: "bg-violet-50 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  teal: "bg-teal-50 font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  amber: "bg-amber-50 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  green: "bg-green-50 font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300",
  sky: "bg-sky-50 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  pink: "bg-pink-50 font-medium text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
  cyan: "bg-cyan-50 font-medium text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  indigo: "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
};

const NAV_ICON_CLASSES: Record<string, string> = {
  brand: "text-brand-500 dark:text-brand-400",
  violet: "text-violet-500 dark:text-violet-400",
  teal: "text-teal-500 dark:text-teal-400",
  amber: "text-amber-500 dark:text-amber-400",
  green: "text-green-500 dark:text-green-400",
  sky: "text-sky-500 dark:text-sky-400",
  pink: "text-pink-500 dark:text-pink-400",
  cyan: "text-cyan-500 dark:text-cyan-400",
  indigo: "text-indigo-500 dark:text-indigo-400",
};

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
  read: boolean;
}

function NotificationBell() {
  const { token, companyId } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  function load() {
    if (!token || !companyId) return;
    apiRequest<{ count: number; items: NotificationItem[] }>("/api/notifications", { token, companyId })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }

  useEffect(load, [token, companyId]);

  const count = items?.filter((i) => !i.read).length ?? 0;

  async function openItem(item: NotificationItem) {
    setOpen(false);
    navigate(item.link);
    if (!item.read) {
      await apiRequest(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST", token, companyId });
      load();
    }
  }

  async function enablePush() {
    setPushError(null);
    setPushBusy(true);
    try {
      await subscribeToPush(token, companyId);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to enable push notifications");
    } finally {
      setPushBusy(false);
    }
  }

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
                onClick={() => openItem(item)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-700 ${item.read ? "opacity-50" : ""}`}
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
          {isPushSupported() && (
            <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-700">
              {pushError && <p className="mb-1 text-xs text-red-600 dark:text-red-400">{pushError}</p>}
              <button onClick={enablePush} disabled={pushBusy} className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 dark:text-brand-400">
                {pushBusy ? "Enabling..." : "Enable browser push notifications"}
              </button>
            </div>
          )}
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

  const fromTab = (location.state as { fromTab?: string } | null)?.fromTab;

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

        <GlobalSearch />

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
              const isActive = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
              const iconColorClass = NAV_ICON_CLASSES[item.color] ?? "";
              return (
                <div key={item.to}>
                  <div
                    className={`flex items-center rounded-md border-s-[3px] text-sm transition-colors ${indent ? "ms-4" : ""} ${
                      isActive
                        ? NAV_ACTIVE_CLASSES[item.color]
                        : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {subItems ? (
                      // Modules with a dropdown aren't a page of their own anymore --
                      // only the sub-items below navigate. The header is just the
                      // expand/collapse toggle for the list of sub-items.
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [item.to]: !prev[item.to] }))}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 text-start ${indent ? "ps-2 pe-1 text-[13px]" : "px-2.5"}`}
                      >
                        <Icon size={indent ? 14 : 16} strokeWidth={2} className={`shrink-0 ${isActive ? "" : iconColorClass}`} />
                        <span className="truncate">{t(item.label)}</span>
                      </button>
                    ) : (
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 ${indent ? "ps-2 pe-1 text-[13px]" : "px-2.5"}`}
                      >
                        <Icon size={indent ? 14 : 16} strokeWidth={2} className={`shrink-0 ${isActive ? "" : iconColorClass}`} />
                        <span className="truncate">{t(item.label)}</span>
                      </NavLink>
                    )}
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
                      {subItems
                        .filter((sub) => {
                          if (!("permission" in sub) || !sub.permission) return true;
                          const codes = Array.isArray(sub.permission) ? sub.permission : [sub.permission];
                          return codes.some((code) => hasPermission(code));
                        })
                        .map((sub) => {
                        const SubIcon = "icon" in sub ? sub.icon : null;
                        const isSubActive =
                          "to" in sub
                            ? location.pathname === sub.to
                            : location.pathname === item.to && fromTab === sub.key;
                        return (
                          <button
                            key={sub.key}
                            type="button"
                            onClick={() =>
                              "to" in sub ? navigate(sub.to) : navigate(item.to, { state: { fromTab: sub.key } })
                            }
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-[13px] ${
                              isSubActive
                                ? NAV_SUBACTIVE_CLASSES[item.color]
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                            }`}
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
