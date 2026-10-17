import type { ButtonHTMLAttributes } from "react";

// The single place that styles a document's workflow actions (Post, Approve,
// Withdraw, Unapprove, Mark Accepted, ...). `primary` advances the document,
// `secondary` steps it back or sideways, `danger` is for rejection. Callers
// own layout (margins, width) through `className`; the look stays uniform.
const VARIANTS = {
  primary: "bg-green-600 text-white hover:bg-green-700",
  secondary: "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800",
  danger: "border border-red-200 text-red-600 hover:bg-red-50",
} as const;

interface WorkflowActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
}

export default function WorkflowActionButton({ variant = "primary", className = "", type = "button", ...rest }: WorkflowActionButtonProps) {
  return (
    <button
      type={type}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
