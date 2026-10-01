import { pool } from "../api/db.js";
import { computeNotifications } from "../api/routes/notifications.js";
import { sendEmail } from "./senders/email.js";
import { sendSms } from "./senders/sms.js";
import { sendWhatsapp } from "./senders/whatsapp.js";
import { sendWebPush } from "./senders/webPush.js";

/**
 * Runs on a timer (see registerDispatcher below). For every user with
 * access to a company, recomputes the same notification list the bell
 * uses, and for each item delivers to whichever channels that user has
 * enabled -- skipping anything already recorded in notification_deliveries
 * so a 5-minute interval doesn't re-send the same low-stock item forever.
 */
export async function dispatchDueNotifications(): Promise<void> {
  const users = await pool.query<{ user_id: string; company_id: string; email: string; phone: string | null }>(
    `SELECT DISTINCT uca.user_id, uca.company_id, u.email, u.phone
     FROM user_company_access uca
     JOIN users u ON u.id = uca.user_id
     WHERE uca.is_active = true AND u.is_active = true`,
  );

  for (const user of users.rows) {
    const items = await computeNotifications(user.company_id, user.user_id);
    if (items.length === 0) continue;

    const prefs = await pool.query<{ type: string; channel: string }>(
      `SELECT type, channel FROM notification_preferences WHERE user_id = $1 AND enabled = true`,
      [user.user_id],
    );
    const enabledChannels = new Map<string, Set<string>>();
    for (const p of prefs.rows) {
      if (!enabledChannels.has(p.type)) enabledChannels.set(p.type, new Set());
      enabledChannels.get(p.type)!.add(p.channel);
    }
    if (enabledChannels.size === 0) continue;

    for (const item of items) {
      const channels = enabledChannels.get(item.type);
      if (!channels || channels.size === 0) continue;

      const already = await pool.query<{ channel: string }>(
        `SELECT channel FROM notification_deliveries WHERE notification_id = $1 AND user_id = $2`,
        [item.id, user.user_id],
      );
      const alreadySent = new Set(already.rows.map((r) => r.channel));

      for (const channel of channels) {
        if (alreadySent.has(channel)) continue;
        try {
          if (channel === "email") {
            await sendEmail(user.email, item.title, item.detail);
          } else if (channel === "sms") {
            if (user.phone) await sendSms(user.phone, `${item.title} -- ${item.detail}`);
          } else if (channel === "whatsapp") {
            if (user.phone) await sendWhatsapp(user.phone, `${item.title} -- ${item.detail}`);
          } else if (channel === "push") {
            await deliverPush(user.user_id, item.title, item.detail, item.link);
          }
          await pool.query(
            `INSERT INTO notification_deliveries (notification_id, user_id, channel, ok) VALUES ($1, $2, $3, true)
             ON CONFLICT (notification_id, user_id, channel) DO NOTHING`,
            [item.id, user.user_id, channel],
          );
        } catch (err) {
          await pool.query(
            `INSERT INTO notification_deliveries (notification_id, user_id, channel, ok, error) VALUES ($1, $2, $3, false, $4)
             ON CONFLICT (notification_id, user_id, channel) DO NOTHING`,
            [item.id, user.user_id, channel, err instanceof Error ? err.message : "unknown error"],
          );
        }
      }
    }
  }
}

async function deliverPush(userId: string, title: string, body: string, link: string): Promise<void> {
  const subs = await pool.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  for (const sub of subs.rows) {
    const ok = await sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, title, body, link);
    if (!ok) await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
  }
}

/** Starts the background delivery loop; call once at server startup. */
export function registerDispatcher(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    dispatchDueNotifications().catch((err) => console.error("[notifications] dispatch failed:", err));
  }, intervalMs);
}
