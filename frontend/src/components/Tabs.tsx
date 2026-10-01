import { useEffect, useState, type ReactNode } from "react";

interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

// hideHeader skips the in-page tab-button row for modules whose tabs are
// now switched from the sidebar dropdown instead (see Layout.tsx subItems).
export default function Tabs({
  tabs,
  initialActive,
  hideHeader,
}: {
  tabs: Tab[];
  initialActive?: string;
  hideHeader?: boolean;
}) {
  const [active, setActive] = useState(initialActive ?? tabs[0]?.key);

  // initialActive only set the state on first mount before; re-syncing here
  // picks up a new sidebar sub-item click even when the page itself doesn't
  // remount (same route, just a different `fromTab` navigation state).
  useEffect(() => {
    if (initialActive) setActive(initialActive);
  }, [initialActive]);

  return (
    <div>
      {!hideHeader && (
        <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active === tab.key
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {tabs.find((tab) => tab.key === active)?.content}
    </div>
  );
}
