import { z } from "zod";

export const bulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export interface BulkResult {
  id: string;
  ok: boolean;
  status?: string;
  error?: string;
}

/** Runs one action per id, isolating failures so one bad row doesn't block the rest. */
export async function runBulkAction(ids: string[], status: string, action: (id: string) => Promise<void>): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const id of ids) {
    try {
      await action(id);
      results.push({ id, ok: true, status });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : "unknown error" });
    }
  }
  return results;
}
