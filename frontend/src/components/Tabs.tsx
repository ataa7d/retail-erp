import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";

interface Tab {
  key: string;
  label: string;
  content: ReactNode;
  /** Hidden entirely (button and content) when the user lacks this permission (any, if an array). Omit for no gate. */
  permission?: string | string[];
}

// hideHeader skips the in-page tab-button row for modules whose tabs are
// now switched from the sidebar dropdown instead (see Layout.tsx subItems).
export default function Tabs({
  tabs: allTabs,
  initialActive,
  hideHeader,
}: {
  tabs: Tab[];
  initialActive?: string;
  hideHeader?: boolean;
}) {
  const { hasPermission } = useAuth();
  const tabs = useMemo(
    () =>
      allTabs.filter((tab) => {
        if (!tab.permission) return true;
        const codes = Array.isArray(tab.permission) ? tab.permission : [tab.permission];
        return codes.some((code) => hasPermission(code));
      }),
    [allTabs, hasPermission],
  );
  const [active, setActive] = useState(initialActive ?? tabs[0]?.key);

  // initialActive only set the state on first mount before; re-syncing here
  // picks up a new sidebar sub-item click even when the page itself doesn't
  // remount (same route, just a different `fromTab` navigation state). Also
  // falls back to the first permitted tab if the active one got filtered out.
  useEffect(() => {
    if (initialActive && tabs.some((t) => t.key === initialActive)) {
      setActive(initialActive);
    } else if (!tabs.some((t) => t.key === active)) {
      setActive(tabs[0]?.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialActive, tabs]);

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
