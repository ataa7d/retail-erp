import { useTranslation } from "react-i18next";
import { UserCog, Wallet } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Tabs from "../components/Tabs";
import type { Column } from "../components/DataTable";

interface Employee {
  id: string;
  employee_code: string;
  full_name_en: string;
  full_name_ar: string;
  hire_date: string;
  basic_salary: string;
  status: string;
}

interface PayrollRun {
  id: string;
  document_number: string;
  pay_period_start: string;
  pay_period_end: string;
  run_date: string;
  document_status: string;
}

function EmployeesTab() {
  const { i18n } = useTranslation();
  const { data, error } = useApiList<Employee>("/api/employees");

  const columns: Column<Employee>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs text-slate-500">{r.employee_code}</span> },
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium text-slate-900">{i18n.language.startsWith("ar") ? r.full_name_ar : r.full_name_en}</span>,
    },
    { key: "hired", header: "Hired", render: (r) => new Date(r.hire_date).toLocaleDateString() },
    { key: "salary", header: "Basic Salary", render: (r) => Number(r.basic_salary).toFixed(2), numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.employee_code} ${r.full_name_en} ${r.full_name_ar}`}
      emptyIcon={UserCog}
      emptyText="No employees yet."
      searchPlaceholder="Search employees..."
      actionLabel="New Employee"
    />
  );
}

function PayrollRunsTab() {
  const { data, error } = useApiList<PayrollRun>("/api/payroll-runs");

  const columns: Column<PayrollRun>[] = [
    { key: "number", header: "Run #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "period", header: "Pay Period", render: (r) => `${new Date(r.pay_period_start).toLocaleDateString()} – ${new Date(r.pay_period_end).toLocaleDateString()}` },
    { key: "runDate", header: "Run Date", render: (r) => new Date(r.run_date).toLocaleDateString() },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => r.document_number}
      emptyIcon={Wallet}
      emptyText="No payroll runs yet."
      searchPlaceholder="Search payroll runs..."
      actionLabel="New Payroll Run"
    />
  );
}

export default function Hr() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.hr")}</h1>
      <Tabs
        tabs={[
          { key: "employees", label: "Employees", content: <EmployeesTab /> },
          { key: "payroll", label: "Payroll Runs", content: <PayrollRunsTab /> },
        ]}
      />
    </div>
  );
}
