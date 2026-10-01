import { Check, X } from "lucide-react";

interface Step {
  key: string;
  label: string;
}

interface StatusStepperProps {
  steps: Step[];
  current: string;
  /** Statuses that are a dead end (rejected/withdrawn/voided) -- rendered as a red terminal badge instead of a step. */
  terminalStatuses?: Record<string, string>;
}

// A small visual of where a document sits in its own workflow cycle --
// draft -> pending_approval -> approved -> posted, or whatever subset
// applies to that document type. Driven by the same status value the
// detail page already reads for its action buttons.
export default function StatusStepper({ steps, current, terminalStatuses }: StatusStepperProps) {
  const terminalLabel = terminalStatuses?.[current];
  if (terminalLabel) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <X size={12} strokeWidth={3} />
        </span>
        <span className="font-medium text-red-600 dark:text-red-400">{terminalLabel}</span>
      </div>
    );
  }

  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <div className="mb-4 flex items-center">
      {steps.map((step, i) => {
        const done = currentIndex > i;
        const active = currentIndex === i;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  done
                    ? "bg-brand-500 text-white"
                    : active
                      ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500 dark:bg-brand-500/20 dark:text-brand-300"
                      : "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                }`}
              >
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-xs ${active ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && <div className={`mx-2 h-px w-8 ${done ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />}
          </div>
        );
      })}
    </div>
  );
}
