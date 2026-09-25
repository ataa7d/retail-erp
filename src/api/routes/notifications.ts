import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export interface NotificationItem {
  id: string;
  type: "requisition_pending" | "low_stock";
  title: string;
  detail: string;
  link: string;
}

async function hasPermission(companyId: string, userId: string, code: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1 AND ur.company_id = $2 AND p.code = $3
     LIMIT 1`,
    [userId, companyId, code],
  );
  return r.rows.length > 0;
}

/**
 * The bell icon's contents: things that actually need this user's
 * attention, not a generic activity feed. Two kinds today --
 * requisitions waiting on someone who can approve them (and isn't the
 * requester), and reorder-point items running low -- both already
 * computed elsewhere (purchase_requisitions, the dashboard's low-stock
 * query) and just re-surfaced here as actionable items with a link.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", { preHandler: app.authenticate }, async (request) => {
    const items: NotificationItem[] = [];

    if (await hasPermission(request.companyId, request.authUser.id, "purchasing.requisition.approve")) {
      const pending = await pool.query<{ id: string; document_number: string; requested_by_email: string | null }>(
        `SELECT pr.id, pr.document_number, u.email AS requested_by_email
         FROM purchase_requisitions pr
         LEFT JOIN users u ON u.id = pr.created_by
         WHERE pr.company_id = $1 AND pr.document_status = 'pending_approval' AND pr.created_by <> $2
         ORDER BY pr.submitted_at ASC
         LIMIT 20`,
        [request.companyId, request.authUser.id],
      );
      for (const row of pending.rows) {
        items.push({
          id: `requisition_pending:${row.id}`,
          type: "requisition_pending",
          title: `${row.document_number} awaiting approval`,
          detail: row.requested_by_email ? `Requested by ${row.requested_by_email}` : "Awaiting your approval",
          link: "/purchasing",
        });
      }
    }

    const lowStock = await pool.query<{ item_variant_id: string; variant_code: string; item_name_en: string; qty_on_hand: string; reorder_point: string }>(
      `SELECT iv.id AS item_variant_id, iv.variant_code, i.name_en AS item_name_en, iv.reorder_point,
              COALESCE(SUM(sb.qty_on_hand), 0) AS qty_on_hand
       FROM item_variants iv
       JOIN items i ON i.id = iv.item_id
       LEFT JOIN stock_balances sb ON sb.item_variant_id = iv.id AND sb.company_id = iv.company_id
       WHERE iv.company_id = $1 AND iv.is_active = true AND iv.reorder_point > 0
       GROUP BY iv.id, iv.reorder_point, i.name_en
       HAVING COALESCE(SUM(sb.qty_on_hand), 0) < iv.reorder_point
       ORDER BY i.name_en
       LIMIT 20`,
      [request.companyId],
    );
    for (const row of lowStock.rows) {
      items.push({
        id: `low_stock:${row.item_variant_id}`,
        type: "low_stock",
        title: `${row.item_name_en} (${row.variant_code}) is low on stock`,
        detail: `${Number(row.qty_on_hand)} on hand, reorder point ${Number(row.reorder_point)}`,
        link: "/items",
      });
    }

    return { count: items.length, items };
  });
}
