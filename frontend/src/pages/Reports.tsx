import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Receipt, Boxes, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest } from "../lib/api";
import Tabs from "../components/Tabs";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";
import StatusBadge from "../components/StatusBadge";
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
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "debit", header: "Debit", render: (r) => Number(r.debit_balance ?? 0).toFixed(2), numeric: true },
    { key: "credit", header: "Credit", render: (r) => Number(r.credit_balance ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">As of</label>
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No posted activity yet." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
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
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
    { key: "amount", header: "Amount", render: (r) => Number(r.amount ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">From</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
        <label className="text-sm text-slate-600 dark:text-slate-300">To</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No activity in this period." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
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
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
    { key: "balance", header: "Balance", render: (r) => Number(r.balance ?? 0).toFixed(2), numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">As of</label>
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={BarChart3} emptyText="No posted activity yet." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
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

interface Customer {
  id: string;
  name_en: string;
}

interface StatementRow {
  txn_date: string;
  document_type: "invoice" | "credit_note" | "receipt";
  document_number: string;
  description: string;
  debit: string;
  credit: string;
  running_balance: string;
}

interface StatementResponse {
  openingBalance: string;
  closingBalance: string;
  rows: StatementRow[];
}

const DOCUMENT_TYPE_LABEL: Record<StatementRow["document_type"], string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  receipt: "Receipt",
};

function CustomerStatementTab() {
  const { token, companyId } = useAuth();
  const { data: customers } = useApiList<Customer>("/api/customers");
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState(yearStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [statement, setStatement] = useState<StatementResponse | null>(null);

  useEffect(() => {
    if (!token || !companyId || !customerId) {
      setStatement(null);
      return;
    }
    setStatement(null);
    apiRequest<StatementResponse>(
      `/api/reports/customer-statement?customerId=${customerId}&startDate=${startDate}&endDate=${endDate}`,
      { token, companyId },
    ).then(setStatement);
  }, [token, companyId, customerId, startDate, endDate]);

  const columns: Column<StatementRow>[] = [
    { key: "date", header: "Date", render: (r) => new Date(r.txn_date).toLocaleDateString() },
    { key: "type", header: "Type", render: (r) => DOCUMENT_TYPE_LABEL[r.document_type] },
    { key: "number", header: "Document #", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.document_number}</span> },
    { key: "description", header: "Description", render: (r) => <span className="text-slate-600 dark:text-slate-300">{r.description}</span> },
    { key: "debit", header: "Debit", render: (r) => (Number(r.debit) ? Number(r.debit).toFixed(2) : "—"), numeric: true },
    { key: "credit", header: "Credit", render: (r) => (Number(r.credit) ? Number(r.credit).toFixed(2) : "—"), numeric: true },
    { key: "balance", header: "Balance", render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{Number(r.running_balance).toFixed(2)}</span>, numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">Customer</label>
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="min-w-56 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
        >
          <option value="">Select a customer...</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </select>
        <label className="text-sm text-slate-600 dark:text-slate-300">From</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
        <label className="text-sm text-slate-600 dark:text-slate-300">To</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>

      {!customerId && <p className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-sm text-slate-400 dark:text-slate-500">Select a customer to view their statement.</p>}

      {customerId && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
          {statement === null ? (
            <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
          ) : (
            <>
              <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm">
                <span className="text-slate-500 dark:text-slate-400">Opening Balance</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{Number(statement.openingBalance).toFixed(2)}</span>
              </div>
              <DataTable
                columns={columns}
                rows={statement.rows}
                getRowKey={(r) => `${r.document_type}-${r.document_number}`}
                emptyIcon={Receipt}
                emptyText="No AR activity for this customer in this period."
              />
              <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <span>Closing Balance</span>
                <span>{Number(statement.closingBalance).toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Store {
  id: string;
  name_en: string;
}

interface ItemGroup {
  id: string;
  name_en: string;
}

interface StockValuationRow {
  store_id: string;
  store_name_en: string;
  item_variant_id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  item_code: string;
  item_name_en: string;
  group_name_en: string | null;
  qty_on_hand: string;
  avg_unit_cost: string;
  total_value: string;
}

interface StockValuationResponse {
  totalValue: string;
  rows: StockValuationRow[];
}

interface CashShift {
  id: string;
  status: string;
  opening_float: string;
  opened_at: string;
  closing_float_counted: string | null;
  closed_at: string | null;
  device_code: string;
  device_name: string;
  store_name_en: string;
  opened_by_email: string | null;
  closed_by_email: string | null;
}

interface ZReportPaymentRow {
  payment_method: string;
  total: string;
  invoice_count: string;
}

interface ZReport {
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  closingFloatCounted: string | null;
  paymentTotals: ZReportPaymentRow[];
  cashSalesTotal: number;
  expectedCash: number;
  variance: number | null;
  grossSalesTotal: number;
  invoiceCount: number;
}

function CashShiftDetailModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { token, companyId } = useAuth();
  const [shift, setShift] = useState<CashShift | null>(null);
  const [zReport, setZReport] = useState<ZReport | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    apiRequest<CashShift>(`/api/cash-shifts/${shiftId}`, { token, companyId }).then(setShift);
    apiRequest<ZReport>(`/api/cash-shifts/${shiftId}/z-report`, { token, companyId }).then(setZReport);
  }, [shiftId, token, companyId]);

  if (!shift || !zReport) return <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {shift.device_name} <span className="font-mono text-xs text-slate-400 dark:text-slate-500">({shift.device_code})</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {shift.store_name_en} · opened by {shift.opened_by_email ?? "—"} at {new Date(shift.opened_at).toLocaleString()}
          </div>
        </div>
        <StatusBadge status={shift.status} />
      </div>

      <div className="mb-3 space-y-1 rounded-md border border-slate-200 dark:border-slate-700 p-2 text-sm">
        <div className="flex justify-between text-slate-500 dark:text-slate-400">
          <span>Opening Float</span>
          <span className="tabular-nums text-slate-900 dark:text-slate-100">{Number(zReport.openingFloat).toFixed(2)}</span>
        </div>
        {zReport.paymentTotals.map((p) => (
          <div key={p.payment_method} className="flex justify-between text-slate-500 dark:text-slate-400">
            <span className="capitalize">{p.payment_method} sales ({p.invoice_count})</span>
            <span className="tabular-nums text-slate-900 dark:text-slate-100">{Number(p.total).toFixed(2)}</span>
          </div>
        ))}
        {zReport.paymentTotals.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">No posted sales in this shift yet.</p>}
        <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-1 font-medium text-slate-700 dark:text-slate-200">
          <span>Expected Cash in Drawer</span>
          <span className="tabular-nums">{zReport.expectedCash.toFixed(2)}</span>
        </div>
        {zReport.closingFloatCounted !== null && (
          <>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Counted Cash</span>
              <span className="tabular-nums text-slate-900 dark:text-slate-100">{Number(zReport.closingFloatCounted).toFixed(2)}</span>
            </div>
            <div className={`flex justify-between font-semibold ${zReport.variance === 0 ? "text-slate-700 dark:text-slate-200" : Number(zReport.variance) < 0 ? "text-red-600" : "text-green-600"}`}>
              <span>Variance</span>
              <span className="tabular-nums">{zReport.variance! > 0 ? "+" : ""}{zReport.variance!.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-slate-400 dark:text-slate-500">
        {zReport.invoiceCount} posted invoice{zReport.invoiceCount === 1 ? "" : "s"}, gross sales {zReport.grossSalesTotal.toFixed(2)}.
        {shift.closed_at && ` Closed by ${shift.closed_by_email ?? "—"} at ${new Date(shift.closed_at).toLocaleString()}.`}
      </div>
    </div>
  );
}

function CashShiftsTab() {
  const { data, error } = useApiList<CashShift>("/api/cash-shifts");
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<CashShift>[] = [
    { key: "device", header: "Device", render: (r) => `${r.device_name} (${r.device_code})` },
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "opened", header: "Opened", render: (r) => new Date(r.opened_at).toLocaleString() },
    { key: "opened_by", header: "Opened By", render: (r) => r.opened_by_email ?? "—" },
    { key: "float", header: "Opening Float", render: (r) => Number(r.opening_float).toFixed(2), numeric: true },
    {
      key: "counted",
      header: "Counted",
      render: (r) => (r.closing_float_counted !== null ? Number(r.closing_float_counted).toFixed(2) : "—"),
      numeric: true,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <DataTable
          columns={columns}
          rows={data ?? []}
          getRowKey={(r) => r.id}
          emptyIcon={Wallet}
          emptyText={error ? "Failed to load cash shifts." : "No cash shifts yet."}
          onRowClick={(r) => setOpenId(r.id)}
        />
      </div>
      {openId && (
        <Modal title="Cash Shift" onClose={() => setOpenId(null)}>
          <CashShiftDetailModal shiftId={openId} onClose={() => setOpenId(null)} />
        </Modal>
      )}
    </>
  );
}

function StockValuationTab() {
  const { token, companyId } = useAuth();
  const { data: stores } = useApiList<Store>("/api/stores");
  const { data: groups } = useApiList<ItemGroup>("/api/item-groups");
  const [storeId, setStoreId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [data, setData] = useState<StockValuationResponse | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    setData(null);
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    if (groupId) params.set("groupId", groupId);
    apiRequest<StockValuationResponse>(`/api/reports/stock-valuation?${params.toString()}`, { token, companyId }).then(setData);
  }, [token, companyId, storeId, groupId]);

  const columns: Column<StockValuationRow>[] = [
    { key: "store", header: "Store", render: (r) => r.store_name_en },
    { key: "item_code", header: "Item Code", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.item_code}</span> },
    { key: "name", header: "Name", render: (r) => r.item_name_en },
    { key: "variant", header: "Variant", render: (r) => [r.color, r.size].filter(Boolean).join(" / ") || "—" },
    { key: "group", header: "Group", render: (r) => r.group_name_en ?? "—" },
    { key: "qty", header: "Qty on Hand", render: (r) => Number(r.qty_on_hand).toLocaleString(), numeric: true },
    { key: "cost", header: "Avg Cost", render: (r) => Number(r.avg_unit_cost).toFixed(2), numeric: true },
    { key: "value", header: "Total Value", render: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{Number(r.total_value).toFixed(2)}</span>, numeric: true },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">Store</label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm">
          <option value="">All Stores</option>
          {stores?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name_en}
            </option>
          ))}
        </select>
        <label className="text-sm text-slate-600 dark:text-slate-300">Group</label>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm">
          <option value="">All Groups</option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name_en}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {data === null ? (
          <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data.rows}
              getRowKey={(r) => `${r.store_id}-${r.item_variant_id}`}
              emptyIcon={Boxes}
              emptyText="No stock on hand matches these filters."
            />
            {data.rows.length > 0 && (
              <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <span>Total Inventory Value: {Number(data.totalValue).toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface Budget {
  id: string;
  name: string;
  status: string;
  year_name: string;
}

interface BudgetVsActualRow {
  account_code: string;
  name_en: string;
  name_ar: string;
  account_type: string;
  budget_amount: string;
  actual_amount: string;
  variance: string;
}

function BudgetVsActualTab() {
  const { i18n } = useTranslation();
  const { token, companyId } = useAuth();
  const { data: budgets } = useApiList<Budget>("/api/budgets");
  const [budgetId, setBudgetId] = useState("");
  const [startDate, setStartDate] = useState(yearStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState<BudgetVsActualRow[] | null>(null);

  useEffect(() => {
    if (!budgets || budgetId || budgets.length === 0) return;
    setBudgetId(budgets.find((b) => b.status === "approved")?.id ?? budgets[0]!.id);
  }, [budgets, budgetId]);

  useEffect(() => {
    if (!token || !companyId || !budgetId) return;
    setRows(null);
    apiRequest<{ rows: BudgetVsActualRow[] }>(
      `/api/reports/budget-vs-actual?budgetId=${budgetId}&startDate=${startDate}&endDate=${endDate}`,
      { token, companyId },
    ).then((r) => setRows(r.rows));
  }, [token, companyId, budgetId, startDate, endDate]);

  const totalBudget = rows?.reduce((s, r) => s + Number(r.budget_amount), 0) ?? 0;
  const totalActual = rows?.reduce((s, r) => s + Number(r.actual_amount), 0) ?? 0;

  const columns: Column<BudgetVsActualRow>[] = [
    { key: "code", header: "Account", render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.account_code}</span> },
    { key: "name", header: "Name", render: (r) => (i18n.language.startsWith("ar") ? r.name_ar : r.name_en) },
    { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.account_type}</span> },
    { key: "budget", header: "Budget", render: (r) => Number(r.budget_amount).toFixed(2), numeric: true },
    { key: "actual", header: "Actual", render: (r) => Number(r.actual_amount).toFixed(2), numeric: true },
    {
      key: "variance",
      header: "Variance",
      render: (r) => {
        const v = Number(r.variance);
        // Over budget reads as "bad" for expenses (spent more than
        // planned) but "good" for revenue (earned more than planned) --
        // the raw sign alone doesn't tell you which, so flip it for
        // expense rows before coloring.
        const favorable = r.account_type === "expense" ? v <= 0 : v >= 0;
        return <span className={favorable ? "text-green-600" : "text-red-600"}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>;
      },
      numeric: true,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">Budget</label>
        <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm">
          {budgets?.length === 0 && <option value="">No budgets yet</option>}
          {budgets?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.year_name}) — {b.status}
            </option>
          ))}
        </select>
        <label className="text-sm text-slate-600 dark:text-slate-300">From</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
        <label className="text-sm text-slate-600 dark:text-slate-300">To</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>
      {budgets?.length === 0 && (
        <p className="mb-3 text-sm text-slate-400 dark:text-slate-500">No budgets exist yet — create one under Accounting → Budgets.</p>
      )}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        {rows === null ? (
          <p className="p-6 text-sm text-slate-400 dark:text-slate-500">{budgetId ? "Loading..." : ""}</p>
        ) : (
          <>
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.account_code} emptyIcon={Wallet} emptyText="No budget or actual activity in this range." />
            {rows.length > 0 && (
              <div className="flex justify-end gap-8 border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <span>Total Budget: {totalBudget.toFixed(2)}</span>
                <span>Total Actual: {totalActual.toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface VatSummaryRow {
  direction: "output" | "input";
  vat_rate: string;
  net_amount: string;
  vat_amount: string;
}

// Grouped by direction and rate -- the same shape fn_vat_summary returns,
// not re-derived here, so this can never disagree with what the backend
// computed from posted documents.
function VatSummaryTab() {
  const { token, companyId } = useAuth();
  const [startDate, setStartDate] = useState(yearStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState<VatSummaryRow[] | null>(null);

  useEffect(() => {
    if (!token || !companyId) return;
    setRows(null);
    apiRequest<{ rows: VatSummaryRow[] }>(`/api/reports/vat-summary?startDate=${startDate}&endDate=${endDate}`, {
      token,
      companyId,
    }).then((r) => setRows(r.rows));
  }, [token, companyId, startDate, endDate]);

  const outputRows = rows?.filter((r) => r.direction === "output") ?? [];
  const inputRows = rows?.filter((r) => r.direction === "input") ?? [];
  const outputVat = outputRows.reduce((s, r) => s + Number(r.vat_amount), 0);
  const inputVat = inputRows.reduce((s, r) => s + Number(r.vat_amount), 0);
  const netVat = outputVat - inputVat;

  function Section({ title, sectionRows }: { title: string; sectionRows: VatSummaryRow[] }) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-slate-500 dark:text-slate-400">
              <th className="px-4 py-2 text-start font-medium">VAT Rate</th>
              <th className="px-4 py-2 text-end font-medium">Net Amount</th>
              <th className="px-4 py-2 text-end font-medium">VAT Amount</th>
            </tr>
          </thead>
          <tbody>
            {sectionRows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                  No activity in this range.
                </td>
              </tr>
            )}
            {sectionRows.map((r) => (
              <tr key={r.vat_rate} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2">{Number(r.vat_rate) === 0 ? "Zero-rated / Exempt" : `${Number(r.vat_rate)}%`}</td>
                <td className="px-4 py-2 text-end tabular-nums">{Number(r.net_amount).toFixed(2)}</td>
                <td className="px-4 py-2 text-end tabular-nums">{Number(r.vat_amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">From</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
        <label className="text-sm text-slate-600 dark:text-slate-300">To</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm" />
      </div>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        A working summary to support filing the periodic VAT return, not an official ZATCA form replica — it doesn't distinguish GCC
        sales, exports, or customs-cleared imports from domestic activity, since this app's schema doesn't capture those separately.
        Zero-rated and exempt supplies are also combined (both show as 0% here).
      </p>
      {rows === null ? (
        <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>
      ) : (
        <div className="space-y-4">
          <Section title="Output VAT (Sales)" sectionRows={outputRows} />
          <Section title="Input VAT (Purchases)" sectionRows={inputRows} />
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-300">Total Output VAT</span>
              <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{outputVat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-300">Total Input VAT</span>
              <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{inputVat.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <span>{netVat >= 0 ? "Net VAT Due" : "Net VAT Refundable"}</span>
              <span className="tabular-nums">{Math.abs(netVat).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">{t("nav.reports")}</h1>
      <Tabs
        initialActive={(location.state as { fromTab?: string } | null)?.fromTab}
        hideHeader
        tabs={[
          { key: "tb", label: "Trial Balance", content: <TrialBalanceTab /> },
          { key: "is", label: "Income Statement", content: <IncomeStatementTab /> },
          { key: "bs", label: "Balance Sheet", content: <BalanceSheetTab /> },
          { key: "cs", label: "Customer Statement", content: <CustomerStatementTab /> },
          { key: "sv", label: "Stock Valuation", content: <StockValuationTab /> },
          { key: "cs2", label: "Cash Shifts", content: <CashShiftsTab /> },
          { key: "bva", label: "Budget vs Actual", content: <BudgetVsActualTab /> },
          { key: "vat", label: "VAT Summary", content: <VatSummaryTab /> },
        ]}
      />
    </div>
  );
}
