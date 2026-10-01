import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface KpiTileProps {
  to: string;
  state?: Record<string, unknown>;
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: "brand" | "green" | "amber" | "slate";
  loading?: boolean;
}

const accentClasses: Record<NonNullable<KpiTileProps["accent"]>, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300",
  green: "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

export default function KpiTile({ to, state, label, value, icon: Icon, accent = "brand", loading }: KpiTileProps) {
  return (
    <Link
      to={to}
      state={state}
      className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentClasses[accent]}`}>
          <Icon size={18} strokeWidth={2} />
        </span>
      </div>
      <div className="mt-4">
        <div className="tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {loading ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-700" /> : value}
        </div>
        <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </Link>
  );
}
