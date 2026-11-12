-- strength logging, meal prep plans, private crews
CREATE TABLE IF NOT EXISTS lift_logs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ex TEXT NOT NULL,
  weight REAL,
  hit INTEGER NOT NULL DEFAULT 1,
  updated TEXT NOT NULL,
  PRIMARY KEY (user_id, date, ex)
);
CREATE TABLE IF NOT EXISTS meal_plans (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT 'minutes',
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crew_members (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  joined TEXT NOT NULL,
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX IF NOT EXISTS crew_members_user ON crew_members (user_id);
