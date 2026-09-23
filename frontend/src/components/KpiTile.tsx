import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface KpiTileProps {
  to: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: "brand" | "green" | "amber" | "slate";
  loading?: boolean;
}

const accentClasses: Record<NonNullable<KpiTileProps["accent"]>, string> = {
  brand: "bg-brand-50 text-brand-600",
  green: "bg-green-50 text-green-600",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600",
};

export default function KpiTile({ to, label, value, icon: Icon, accent = "brand", loading }: KpiTileProps) {
  return (
    <Link
      to={to}
      className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentClasses[accent]}`}>
          <Icon size={18} strokeWidth={2} />
        </span>
      </div>
      <div className="mt-4">
        <div className="tabular-nums text-2xl font-semibold text-slate-900">
          {loading ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-100" /> : value}
        </div>
        <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
      </div>
    </Link>
  );
}
