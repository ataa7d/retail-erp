import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyIcon: LucideIcon;
  emptyText: string;
  onRowClick?: (row: T) => void;
  /** Renders a checkbox column; selection state is owned by the caller. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
}

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyIcon: EmptyIcon,
  emptyText,
  onRowClick,
  selectable,
  selectedKeys,
  onSelectionChange,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-400 dark:text-slate-500">
        <EmptyIcon size={32} strokeWidth={1.5} />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  const selected = selectedKeys ?? new Set<string>();
  const visibleKeys = rows.map(getRowKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const someVisibleSelected = visibleKeys.some((k) => selected.has(k));

  function toggleAllVisible() {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (allVisibleSelected) {
      visibleKeys.forEach((k) => next.delete(k));
    } else {
      visibleKeys.forEach((k) => next.add(k));
    }
    onSelectionChange(next);
  }

  function toggleRow(key: string) {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  return (
    <table className="w-full text-sm text-slate-700 dark:text-slate-200">
      <thead>
        <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
          {selectable && (
            <th className="w-9 px-4 py-2.5">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                }}
                onChange={toggleAllVisible}
                className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600"
              />
            </th>
          )}
          {columns.map((col) => (
            <th key={col.key} className={`px-4 py-2.5 ${col.numeric ? "text-end" : "text-start"}`}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = getRowKey(row);
          return (
            <tr
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${onRowClick ? "cursor-pointer" : ""}`}
            >
              {selectable && (
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleRow(key)}
                    className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600"
                  />
                </td>
              )}
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-2.5 ${col.numeric ? "text-end tabular-nums" : ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
