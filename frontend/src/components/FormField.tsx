import type { ReactNode } from "react";

export function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-3 block min-w-0">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

// min-w-0 matters more here than it looks: a <select>'s automatic minimum
// size in a flex/grid layout is based on its longest <option> text, not the
// container width, so without it a long supplier/account name silently
// blows out a two-column form row (found and fixed once already in the
// journal-line editor — baking it in here so it can't happen again).
const inputClass =
  "w-full min-w-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} bg-white ${props.className ?? ""}`} />;
}

export function FormActions({ error, submitting, submitLabel = "Save" }: { error: string | null; submitting: boolean; submitLabel?: string }) {
  return (
    <div className="mt-4">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}
