-- route maps and details for the Activities tab
ALTER TABLE activities ADD COLUMN poly TEXT;
ALTER TABLE activities ADD COLUMN start_local TEXT;
ALTER TABLE activities ADD COLUMN elev_ft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activities ADD COLUMN sport TEXT;
ALTER TABLE activities ADD COLUMN max_hr INTEGER NOT NULL DEFAULT 0;
-- personal link for Apple Health (iPhone Shortcut) weigh-ins
CREATE TABLE IF NOT EXISTS import_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL,
  last_used TEXT
);
