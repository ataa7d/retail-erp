const STYLES: Record<string, string> = {
  posted: "bg-green-100 text-green-700",
  active: "bg-green-100 text-green-700",
  draft: "bg-amber-100 text-amber-700",
  inactive: "bg-slate-100 text-slate-500",
  retired: "bg-slate-100 text-slate-500",
  disposed: "bg-slate-100 text-slate-500",
  terminated: "bg-red-100 text-red-600",
  fully_depreciated: "bg-blue-100 text-blue-700",
  pending_approval: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  converted_to_po: "bg-slate-100 text-slate-600",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-600";
  const label = status.replace(/_/g, " ");
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}>{label}</span>;
}
