import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { UserCog, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest, ApiError } from "../lib/api";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Modal from "../components/Modal";
import Tabs from "../components/Tabs";
import { Field, TextInput, SelectInput, FormActions } from "../components/FormField";
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

interface Department {
  id: string;
  code: string;
  name_en: string;
}

interface Position {
  id: string;
  code: string;
  name_en: string;
}

interface FiscalPeriod {
  id: string;
  period_number: number;
  year_name: string;
  start_date: string;
  end_date: string;
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

function NewEmployeeForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: departments } = useApiList<Department>("/api/departments");
  const { data: positions } = useApiList<Position>("/api/positions");
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullNameEn, setFullNameEn] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [basicSalary, setBasicSalary] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("/api/employees", {
        method: "POST",
        token,
        companyId,
        body: {
          employeeCode,
          fullNameEn,
          fullNameAr,
          departmentId: departmentId || null,
          positionId: positionId || null,
          hireDate,
          basicSalary,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create employee");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Employee Code" required>
        <TextInput required value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
      </Field>
      <Field label="Full Name (English)" required>
        <TextInput required value={fullNameEn} onChange={(e) => setFullNameEn(e.target.value)} />
      </Field>
      <Field label="Full Name (Arabic)" required>
        <TextInput required dir="rtl" value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} />
      </Field>
      <Field label="Department">
        <SelectInput value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">—</option>
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Position">
        <SelectInput value={positionId} onChange={(e) => setPositionId(e.target.value)}>
          <option value="">—</option>
          {positions?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name_en}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Hire Date" required>
        <TextInput type="date" required value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
      </Field>
      <Field label="Basic Salary" required>
        <TextInput type="number" min={0} step="0.01" required value={basicSalary} onChange={(e) => setBasicSalary(Number(e.target.value))} />
      </Field>
      <FormActions error={error} submitting={submitting} submitLabel="Create Employee" />
    </form>
  );
}

function NewPayrollRunForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token, companyId } = useAuth();
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const openPeriods = periods?.filter((p) => p.status === "open") ?? [];
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [payPeriodStart, setPayPeriodStart] = useState("");
  const [payPeriodEnd, setPayPeriodEnd] = useState("");
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/payroll-runs", {
        method: "POST",
        token,
        companyId,
        body: { fiscalPeriodId, payPeriodStart, payPeriodEnd, runDate },
      });
      // Payroll lines are computed from each employee's stored salary at
      // posting time, not entered here — so create and post happen as one
      // user action ("Create & Post"), not a separate draft-review step.
      await apiRequest(`/api/payroll-runs/${created.id}/post`, { method: "POST", token, companyId });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create payroll run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Fiscal Period" required>
        <SelectInput required value={fiscalPeriodId} onChange={(e) => setFiscalPeriodId(e.target.value)}>
          <option value="">Select a period...</option>
          {openPeriods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.year_name} — Period {p.period_number}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Pay Period Start" required>
        <TextInput type="date" required value={payPeriodStart} onChange={(e) => setPayPeriodStart(e.target.value)} />
      </Field>
      <Field label="Pay Period End" required>
        <TextInput type="date" required value={payPeriodEnd} onChange={(e) => setPayPeriodEnd(e.target.value)} />
      </Field>
      <Field label="Run Date" required>
        <TextInput type="date" required value={runDate} onChange={(e) => setRunDate(e.target.value)} />
      </Field>
      <p className="mb-3 text-xs text-slate-400">
        Computes gross pay and GOSI for every active employee eligible in this pay period, and posts the GL journal immediately.
      </p>
      <FormActions error={error} submitting={submitting} submitLabel="Create & Post Payroll Run" />
    </form>
  );
}

function EmployeesTab() {
  const { i18n } = useTranslation();
  const { data, error, reload } = useApiList<Employee>("/api/employees");
  const [showNew, setShowNew] = useState(false);

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
    <>
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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Employee" onClose={() => setShowNew(false)}>
          <NewEmployeeForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
  );
}

function PayrollRunsTab() {
  const { data, error, reload } = useApiList<PayrollRun>("/api/payroll-runs");
  const [showNew, setShowNew] = useState(false);

  const columns: Column<PayrollRun>[] = [
    { key: "number", header: "Run #", render: (r) => <span className="font-mono text-xs text-slate-500">{r.document_number}</span> },
    { key: "period", header: "Pay Period", render: (r) => `${new Date(r.pay_period_start).toLocaleDateString()} – ${new Date(r.pay_period_end).toLocaleDateString()}` },
    { key: "runDate", header: "Run Date", render: (r) => new Date(r.run_date).toLocaleDateString() },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.document_status} /> },
  ];

  return (
    <>
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
        onAction={() => setShowNew(true)}
      />
      {showNew && (
        <Modal title="New Payroll Run" onClose={() => setShowNew(false)}>
          <NewPayrollRunForm onClose={() => setShowNew(false)} onCreated={reload} />
        </Modal>
      )}
    </>
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
