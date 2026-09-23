import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { apiRequest } from "../lib/api";
import Tabs from "../components/Tabs";
import DataTable from "../components/DataTable";
import type { Column } from "../components/DataTable";

interface ReportRow {
  account_code: string;
  name_en: string;
  name_ar: string;
  account_type: string;
  debit_balance?: string;
  credit_balance?: string;
  amount?: string;
  balance?: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function yearStartISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function TrialBalanceTab() {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [rows, setRows] = useState<ReportRow[] | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    setRows(null);
    apiRequest<{ rows: ReportRow[] }>(`/api/reports/trial-balance?asOfDate=${asOfDate}`, { token, companyId }).then((r) =>
      setRows(r.rows),
    );
  }, [token, companyId, asOfDate]);

  const totalDebit = rows?.reduce((s, r) => s + Number(r.debit_balance ?? 0), 0) ?? 0;
  const totalCredit = rows?.reduce((s, r) => s + Number(r.credit_balance ?? 0), 0) ?? 0;

  const columns: Column<ReportRow>[] = [
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "debit", header: "Debit", render: (r) => Number(r.debit_balance ?? 0).toFixed(2), numeric: true },
    { key: "credit", header: "Credit", render: (r) => Number(r.credit_balance ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600">As of</label>
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No posted activity yet." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
                <span>Total Debit: {totalDebit.toFixed(2)}</span>
                <span>Total Credit: {totalCredit.toFixed(2)}</span>
                {Math.abs(totalDebit - totalCredit) < 0.01 && <span className="text-green-600">Balanced ✓</span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IncomeStatementTab() {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const [startDate, setStartDate] = useState(yearStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState<ReportRow[] | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    setRows(null);
    apiRequest<{ rows: ReportRow[] }>(`/api/reports/income-statement?startDate=${startDate}&endDate=${endDate}`, {
      token,
      companyId,
    }).then((r) => setRows(r.rows));
  }, [token, companyId, startDate, endDate]);

  const revenue = rows?.filter((r) => r.account_type === "revenue").reduce((s, r) => s + Number(r.amount ?? 0), 0) ?? 0;
  const expense = rows?.filter((r) => r.account_type === "expense").reduce((s, r) => s + Number(r.amount ?? 0), 0) ?? 0;

  const columns: Column<ReportRow>[] = [
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
    { key: "amount", header: "Amount", render: (r) => Number(r.amount ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600">From</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
        <label className="text-sm text-slate-600">To</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No activity in this period." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
                <span>Revenue: {revenue.toFixed(2)}</span>
                <span>Expenses: {expense.toFixed(2)}</span>
                <span className={revenue - expense >= 0 ? "text-green-600" : "text-red-600"}>Net Income: {(revenue - expense).toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BalanceSheetTab() {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [rows, setRows] = useState<ReportRow[] | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    setRows(null);
    apiRequest<{ rows: ReportRow[] }>(`/api/reports/balance-sheet?asOfDate=${asOfDate}`, { token, companyId }).then((r) =>
      setRows(r.rows),
    );
  }, [token, companyId, asOfDate]);

  const assets = rows?.filter((r) => r.account_type === "asset").reduce((s, r) => s + Number(r.balance ?? 0), 0) ?? 0;
  const liabilities = rows?.filter((r) => r.account_type === "liability").reduce((s, r) => s + Number(r.balance ?? 0), 0) ?? 0;
  const equity = rows?.filter((r) => r.account_type === "equity").reduce((s, r) => s + Number(r.balance ?? 0), 0) ?? 0;

  const columns: Column<ReportRow>[] = [
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
    { key: "balance", header: "Balance", render: (r) => Number(r.balance ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600">As of</label>
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No posted activity yet." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
                <span>Assets: {assets.toFixed(2)}</span>
                <span>Liabilities + Equity: {(liabilities + equity).toFixed(2)}</span>
                {Math.abs(assets - (liabilities + equity)) < 0.01 && <span className="text-green-600">Balanced ✓</span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Reports() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.reports")}</h1>
      <Tabs
        tabs={[
          { key: "tb", label: "Trial Balance", content: <TrialBalanceTab /> },
          { key: "is", label: "Income Statement", content: <IncomeStatementTab /> },
          { key: "bs", label: "Balance Sheet", content: <BalanceSheetTab /> },
        ]}
      />
    </div>
  );
}
