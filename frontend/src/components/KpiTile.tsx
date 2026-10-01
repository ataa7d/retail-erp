import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface KpiTileProps {
  to: string;
  state?: Record<string, unknown>;
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: "brand" | "green" | "amber" | "slate" | "violet" | "teal" | "rose" | "sky" | "indigo" | "pink" | "cyan";
  loading?: boolean;
}

const accentClasses: Record<NonNullable<KpiTileProps["accent"]>, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
  green: "bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  teal: "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  pink: "bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300",
  cyan: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300",
};

const accentBorder: Record<NonNullable<KpiTileProps["accent"]>, string> = {
  brand: "before:bg-brand-500",
  green: "before:bg-green-500",
  amber: "before:bg-amber-500",
  slate: "before:bg-slate-300 dark:before:bg-slate-600",
  violet: "before:bg-violet-500",
  teal: "before:bg-teal-500",
  rose: "before:bg-rose-500",
  sky: "before:bg-sky-500",
  indigo: "before:bg-indigo-500",
  pink: "before:bg-pink-500",
  cyan: "before:bg-cyan-500",
};

export default function KpiTile({ to, state, label, value, icon: Icon, accent = "brand", loading }: KpiTileProps) {
  return (
    <Link
      to={to}
      state={state}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 before:absolute before:inset-x-0 before:top-0 before:h-1 ${accentBorder[accent]}`}
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
