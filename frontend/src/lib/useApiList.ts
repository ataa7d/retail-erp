import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { apiRequest } from "./api";

/**
 * Fetches a list from the API whenever the authenticated company changes.
 * `path === null` skips fetching (e.g. waiting on a required filter like a
 * selected store) without needing a separate `enabled` flag.
 */
export function useApiList<T>(path: string | null) {
  const { token, companyId } = useAuth();
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!token || !companyId || !path) return;
    let cancelled = false;
    setData(null);
    setError(null);
    apiRequest<T[]>(path, { token, companyId })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [token, companyId, path, reloadTick]);

  return { data, error, reload: () => setReloadTick((t) => t + 1) };
}
