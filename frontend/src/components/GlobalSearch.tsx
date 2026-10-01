import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { apiRequest } from "../lib/api";

interface SearchResult {
  type: "customer" | "supplier" | "item" | "sales_invoice" | "purchase_order";
  id: string;
  label: string;
  detail: string;
  link: string;
}

export default function GlobalSearch() {
  const { token, companyId } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !token || !companyId) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiRequest<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(trimmed)}`, { token, companyId })
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            setOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, token, companyId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function goTo(result: SearchResult) {
    setOpen(false);
    setQuery("");
    navigate(result.link);
  }

  return (
    <div ref={containerRef} className="relative mx-auto max-w-xl flex-1">
      <div className="flex items-center rounded-md bg-white/10 px-3 py-1.5 text-sm text-white/70 focus-within:bg-white/15">
        <Search size={15} className="me-2 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          placeholder="Search customers, suppliers, items, invoices, POs..."
          className="w-full bg-transparent text-white placeholder:text-white/50 focus:outline-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute start-0 top-9 z-30 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {results.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              onClick={() => goTo(r)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <span className="truncate font-medium text-slate-900 dark:text-slate-100">{r.label}</span>
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <div className="absolute start-0 top-9 z-30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
          No matches.
        </div>
      )}
    </div>
  );
}
