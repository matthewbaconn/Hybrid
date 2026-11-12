-- problems people report from inside the app
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  text TEXT NOT NULL,
  info TEXT,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created);
