-- Garmin numbers (sleep score, Body Battery, stress) and where each day's watch data came from.
-- Additive only: existing rows keep their values.
ALTER TABLE health_daily ADD COLUMN sleep_score INTEGER;
ALTER TABLE health_daily ADD COLUMN bb INTEGER;
ALTER TABLE health_daily ADD COLUMN stress INTEGER;
ALTER TABLE health_daily ADD COLUMN source TEXT;
-- extra keys per account (kind "garmin"), so the Apple Health key and the Garmin key never cancel each other
CREATE TABLE IF NOT EXISTS link_keys (
  key_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created TEXT NOT NULL,
  last_used TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS link_keys_user_kind ON link_keys (user_id, kind);
