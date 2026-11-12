-- one-time "forgot password" links (only a hash of the link's code is stored; links last 1 hour)
CREATE TABLE IF NOT EXISTS pw_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pw_resets_user ON pw_resets(user_id);
