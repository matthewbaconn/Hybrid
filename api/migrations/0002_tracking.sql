-- Morning check-ins, weigh-ins, workouts and Strava links
CREATE TABLE IF NOT EXISTS checkins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep_h REAL NOT NULL,
  sleep_q INTEGER NOT NULL,
  soreness INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  stress INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS weights (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  lb REAL NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,            -- manual | strava
  ext_id TEXT,                     -- Strava activity id
  date TEXT NOT NULL,
  type TEXT NOT NULL,              -- run | lift | bike | swim | other
  name TEXT NOT NULL,
  mi REAL NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  cal INTEGER NOT NULL DEFAULT 0,
  avg_hr INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS activities_ext ON activities(user_id, source, ext_id);
CREATE INDEX IF NOT EXISTS activities_user_date ON activities(user_id, date);
CREATE TABLE IF NOT EXISTS strava_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL,
  athlete_name TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_sync TEXT
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created TEXT NOT NULL
);
