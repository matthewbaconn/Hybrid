-- member update emails already sent from mail/outbox.json (so each one goes out once)
CREATE TABLE IF NOT EXISTS mail_sent (
  id TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
);
