import { useMemo, useState, type ReactNode } from "react";
import { Search, Plus, X, type LucideIcon } from "lucide-react";
import DataTable, { type Column } from "./DataTable";

export interface BulkAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger";
}

interface ListPageProps<T> {
  title: string;
  subtitle?: string;
  data: T[] | null;
  error: string | null;
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  getSearchText: (row: T) => string;
  emptyIcon: LucideIcon;
  emptyText: string;
  searchPlaceholder?: string;
  actionLabel?: string;
  onAction?: () => void;
  onRowClick?: (row: T) => void;
  /** Extra controls in the toolbar row, e.g. a store selector for stock. */
  toolbarExtra?: ReactNode;
  /** Renders a checkbox column + a bulk-action bar once something is selected. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  bulkActions?: BulkAction[];
}

export default function ListPage<T>({
  title,
  subtitle,
  data,
  error,
  columns,
  getRowKey,
  getSearchText,
  emptyIcon,
  emptyText,
  searchPlaceholder = "Search...",
  actionLabel,
  onAction,
  onRowClick,
  toolbarExtra,
  selectable,
  selectedKeys,
  onSelectionChange,
  bulkActions,
}: ListPageProps<T>) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => getSearchText(row).toLowerCase().includes(q));
  }, [data, query, getSearchText]);

  const selectedCount = selectedKeys?.size ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {subtitle ?? (data ? `${filtered.length} of ${data.length}` : "Loading...")}
          </p>
        </div>
        {actionLabel && (
          <button
            onClick={onAction}
            className="flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Plus size={16} /> {actionLabel}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus-within:border-brand-400 focus-within:bg-white dark:border-slate-600 dark:bg-slate-900 dark:focus-within:bg-slate-900">
            <Search size={15} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-slate-900 focus:outline-none dark:text-slate-100"
            />
          </div>
          {toolbarExtra}
        </div>

        {selectable && selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm dark:border-brand-500/20 dark:bg-brand-500/10">
            <span className="font-medium text-brand-700 dark:text-brand-300">{selectedCount} selected</span>
            {bulkActions?.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  action.variant === "danger"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-brand-500 text-white hover:bg-brand-600"
                }`}
              >
                {action.label}
              </button>
            ))}
            <button
              onClick={() => onSelectionChange?.(new Set())}
              className="ms-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <X size={13} /> Clear selection
            </button>
          </div>
        )}

        {error && <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!error && data === null && <p className="p-6 text-sm text-slate-400 dark:text-slate-500">Loading...</p>}
        {!error && data !== null && (
          <DataTable
            columns={columns}
            rows={filtered}
            getRowKey={getRowKey}
            emptyIcon={emptyIcon}
            emptyText={emptyText}
            onRowClick={onRowClick}
            selectable={selectable}
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
          />
        )}
      </div>
    </div>
  );
}
