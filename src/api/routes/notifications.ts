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
 * Things that actually need this user's attention, not a generic activity
 * feed. Two kinds today -- requisitions waiting on someone who can approve
 * them (and isn't the requester), and reorder-point items running low --
 * both computed fresh from live data rather than a separate persisted
 * table, so there's no risk of drifting out of sync with reality. Shared
 * between the bell's GET route and the background delivery dispatcher
 * (src/notifications/dispatch.ts), which recomputes the same list per user
 * to decide what's newly due for email/SMS/WhatsApp/push.
 */
export async function computeNotifications(companyId: string, userId: string): Promise<NotificationItem[]> {
  const items: NotificationItem[] = [];

  if (await hasPermission(companyId, userId, "purchasing.requisition.approve")) {
    const pending = await pool.query<{ id: string; document_number: string; requested_by_email: string | null }>(
      `SELECT pr.id, pr.document_number, u.email AS requested_by_email
       FROM purchase_requisitions pr
       LEFT JOIN users u ON u.id = pr.created_by
       WHERE pr.company_id = $1 AND pr.document_status = 'pending_approval' AND pr.created_by <> $2
       ORDER BY pr.submitted_at ASC
       LIMIT 20`,
      [companyId, userId],
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
    [companyId],
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

  return items;
}

const NOTIFICATION_TYPES = ["requisition_pending", "low_stock"] as const;
const NOTIFICATION_CHANNELS = ["email", "sms", "whatsapp", "push"] as const;

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", { preHandler: app.authenticate }, async (request) => {
    const items = await computeNotifications(request.companyId, request.authUser.id);
    const reads = await pool.query<{ notification_id: string }>(
      `SELECT notification_id FROM notification_reads WHERE user_id = $1 AND notification_id = ANY($2)`,
      [request.authUser.id, items.map((i) => i.id)],
    );
    const readIds = new Set(reads.rows.map((r) => r.notification_id));
    const withRead = items.map((item) => ({ ...item, read: readIds.has(item.id) }));
    return { count: withRead.filter((i) => !i.read).length, items: withRead };
  });

  app.post<{ Params: { id: string } }>("/notifications/:id/read", { preHandler: app.authenticate }, async (request) => {
    await pool.query(
      `INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)
       ON CONFLICT (user_id, notification_id) DO NOTHING`,
      [request.authUser.id, request.params.id],
    );
    return { ok: true };
  });

  app.get("/notification-preferences", { preHandler: app.authenticate }, async (request) => {
    const result = await pool.query<{ type: string; channel: string; enabled: boolean }>(
      `SELECT type, channel, enabled FROM notification_preferences WHERE user_id = $1`,
      [request.authUser.id],
    );
    return { types: NOTIFICATION_TYPES, channels: NOTIFICATION_CHANNELS, preferences: result.rows };
  });

  app.post<{ Body: { type: string; channel: string; enabled: boolean } }>(
    "/notification-preferences",
    { preHandler: app.authenticate },
    async (request) => {
      const { type, channel, enabled } = request.body;
      if (!NOTIFICATION_TYPES.includes(type as never) || !NOTIFICATION_CHANNELS.includes(channel as never)) {
        return { ok: false };
      }
      await pool.query(
        `INSERT INTO notification_preferences (user_id, type, channel, enabled) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, type, channel) DO UPDATE SET enabled = $4`,
        [request.authUser.id, type, channel, enabled],
      );
      return { ok: true };
    },
  );

  app.get("/push/public-key", { preHandler: app.authenticate }, async () => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
  });

  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
    "/push/subscribe",
    { preHandler: app.authenticate },
    async (request) => {
      const { endpoint, keys } = request.body;
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
        [request.authUser.id, endpoint, keys.p256dh, keys.auth],
      );
      return { ok: true };
    },
  );

  app.post<{ Body: { endpoint: string } }>("/push/unsubscribe", { preHandler: app.authenticate }, async (request) => {
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [request.body.endpoint, request.authUser.id]);
    return { ok: true };
  });
}
