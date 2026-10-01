const STYLES: Record<string, string> = {
  posted: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  active: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  inactive: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  retired: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  disposed: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  terminated: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  fully_depreciated: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  pending_approval: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  rejected: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  converted_to_po: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  converted_to_invoice: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  withdrawn: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  accepted: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  voided: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  const label = status.replace(/_/g, " ");
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}>{label}</span>;
}
