import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface TransactionPageProps {
  title: string;
  subtitle?: ReactNode;
  backLabel?: string;
  onBack: () => void;
  children: ReactNode;
}

// Full-page shell for "create a new transaction" screens, replacing the
// <Modal> these used to render inside -- same header/card conventions as
// ListPage (rounded-xl border/shadow card) so the two don't feel like
// different apps, just no overlay/backdrop and no width cap.
export default function TransactionPage({ title, subtitle, backLabel = "Back", onBack, children }: TransactionPageProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="max-w-4xl rounded-xl border border-slate-200 bg-white p-5 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {children}
      </div>
    </div>
  );
}
