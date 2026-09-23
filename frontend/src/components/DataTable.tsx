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
}

export default function DataTable<T>({ columns, rows, getRowKey, emptyIcon: EmptyIcon, emptyText, onRowClick }: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-400">
        <EmptyIcon size={32} strokeWidth={1.5} />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
          {columns.map((col) => (
            <th key={col.key} className={`px-4 py-2.5 ${col.numeric ? "text-end" : "text-start"}`}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={getRowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${onRowClick ? "cursor-pointer" : ""}`}
          >
            {columns.map((col) => (
              <td key={col.key} className={`px-4 py-2.5 ${col.numeric ? "text-end tabular-nums" : ""}`}>
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
