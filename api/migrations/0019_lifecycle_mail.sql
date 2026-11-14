-- lifecycle emails already sent to a member (each kind at most once per member, ever); add-only
CREATE TABLE IF NOT EXISTS lifecycle_mail (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind)
);
