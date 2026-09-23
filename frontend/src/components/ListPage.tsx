import { useMemo, useState, type ReactNode } from "react";
import { Search, Plus, type LucideIcon } from "lucide-react";
import DataTable, { type Column } from "./DataTable";

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
}: ListPageProps<T>) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => getSearchText(row).toLowerCase().includes(q));
  }, [data, query, getSearchText]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">
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

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus-within:border-brand-400 focus-within:bg-white">
            <Search size={15} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent focus:outline-none"
            />
          </div>
          {toolbarExtra}
        </div>

        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && data === null && <p className="p-6 text-sm text-slate-400">Loading...</p>}
        {!error && data !== null && (
          <DataTable columns={columns} rows={filtered} getRowKey={getRowKey} emptyIcon={emptyIcon} emptyText={emptyText} onRowClick={onRowClick} />
        )}
      </div>
    </div>
  );
}
