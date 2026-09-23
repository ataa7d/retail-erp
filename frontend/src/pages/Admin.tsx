import { useTranslation } from "react-i18next";
import { ShieldCheck, KeyRound, ScrollText } from "lucide-react";
import { useApiList } from "../lib/useApiList";
import ListPage from "../components/ListPage";
import StatusBadge from "../components/StatusBadge";
import Tabs from "../components/Tabs";
import type { Column } from "../components/DataTable";

interface AdminUser {
  id: string;
  email: string;
  full_name_en: string;
  full_name_ar: string;
  user_is_active: boolean;
  has_company_access: boolean;
  roles: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  permissions: string[];
}

interface AuditLogEntry {
  id: string;
  table_name: string;
  row_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor_user_id: string | null;
  occurred_at: string;
}

const ACTION_STYLE: Record<AuditLogEntry["action"], string> = {
  INSERT: "bg-green-100 text-green-700",
  UPDATE: "bg-amber-100 text-amber-700",
  DELETE: "bg-red-100 text-red-600",
};

function UsersTab() {
  const { data, error } = useApiList<AdminUser>("/api/admin/users");

  const columns: Column<AdminUser>[] = [
    { key: "email", header: "Email", render: (r) => <span className="font-medium text-slate-900">{r.email}</span> },
    { key: "name", header: "Name", render: (r) => r.full_name_en },
    { key: "roles", header: "Roles", render: (r) => (r.roles.length ? r.roles.join(", ") : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.user_is_active && r.has_company_access ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.email} ${r.full_name_en}`}
      emptyIcon={ShieldCheck}
      emptyText="No users yet."
      searchPlaceholder="Search users..."
      actionLabel="Invite User"
    />
  );
}

function RolesTab() {
  const { data, error } = useApiList<Role>("/api/admin/roles");

  const columns: Column<Role>[] = [
    { key: "name", header: "Role", render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: "description", header: "Description", render: (r) => r.description ?? "—" },
    { key: "permissions", header: "Permissions", render: (r) => r.permissions.length, numeric: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.is_active ? "active" : "inactive"} /> },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => r.name}
      emptyIcon={KeyRound}
      emptyText="No roles yet."
      searchPlaceholder="Search roles..."
      actionLabel="New Role"
    />
  );
}

function AuditLogTab() {
  const { data, error } = useApiList<AuditLogEntry>("/api/admin/audit-log?limit=100");

  const columns: Column<AuditLogEntry>[] = [
    { key: "action", header: "Action", render: (r) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ACTION_STYLE[r.action]}`}>{r.action}</span> },
    { key: "table", header: "Table", render: (r) => <span className="font-mono text-xs text-slate-600">{r.table_name}</span> },
    { key: "row", header: "Row", render: (r) => <span className="font-mono text-xs text-slate-400">{r.row_id.slice(0, 8)}…</span> },
    { key: "when", header: "When", render: (r) => new Date(r.occurred_at).toLocaleString() },
  ];

  return (
    <ListPage
      title=""
      data={data}
      error={error}
      columns={columns}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.table_name} ${r.action}`}
      emptyIcon={ScrollText}
      emptyText="No audit history yet."
      searchPlaceholder="Search audit log..."
    />
  );
}

export default function Admin() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t("nav.admin")}</h1>
      <Tabs
        tabs={[
          { key: "users", label: "Users", content: <UsersTab /> },
          { key: "roles", label: "Roles", content: <RolesTab /> },
          { key: "audit", label: "Audit Log", content: <AuditLogTab /> },
        ]}
      />
    </div>
  );
}
