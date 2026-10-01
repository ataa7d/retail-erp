import webpush from "web-push";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Returns false (and the subscription should be deleted) on a 404/410 -- the browser revoked it. */
export async function sendWebPush(subscription: PushSubscription, title: string, body: string, link: string): Promise<boolean> {
  if (!ensureConfigured()) {
    console.log(`[notifications] web push not configured, skipping send: ${title}`);
    return true;
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, link }));
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return false;
    throw err;
  }
}
