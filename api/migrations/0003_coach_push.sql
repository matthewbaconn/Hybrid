-- Lap splits and typed work pace for run checks; coach notes; push notifications; settings
ALTER TABLE activities ADD COLUMN laps TEXT;
ALTER TABLE activities ADD COLUMN work_pace INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS reviews (
  activity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  data TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_user ON reviews(user_id, date);
CREATE TABLE IF NOT EXISTS coach_notes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (user_id, date, kind)
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notif_log (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, day)
);
