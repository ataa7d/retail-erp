-- Notifications today (src/api/routes/notifications.ts) are computed fresh
-- on every bell fetch -- accurate, but with no read state and no way to
-- also deliver by email/SMS/WhatsApp/push. Rather than duplicate that
-- computation into a second, persisted source of truth (which can drift
-- out of sync with the live data), this keeps the on-the-fly computation
-- as-is and adds just what's missing: per-user read state (keyed by the
-- same deterministic "type:id" string the bell already generates), a
-- preferences matrix of which channels a user wants per notification
-- type, delivery dedup so a background dispatcher doesn't re-send the
-- same item twice, and Web Push subscriptions.

ALTER TABLE users ADD COLUMN phone TEXT;

CREATE TABLE notification_reads (
  user_id         UUID NOT NULL REFERENCES users(id),
  notification_id TEXT NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE notification_preferences (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id),
  type      TEXT NOT NULL CHECK (type IN ('requisition_pending', 'low_stock')),
  channel   TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
  enabled   BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, type, channel)
);

CREATE TABLE notification_deliveries (
  notification_id TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id),
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok              BOOLEAN NOT NULL,
  error           TEXT,
  PRIMARY KEY (notification_id, user_id, channel)
);

CREATE TABLE push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
