-- Accounts that are never counted as members: the owner (Matthew) and any other account he marks.
-- Add-only: a new table; existing rows in other tables are untouched.
CREATE TABLE IF NOT EXISTS not_members (user_id TEXT PRIMARY KEY, why TEXT NOT NULL, created TEXT NOT NULL);
INSERT OR IGNORE INTO not_members (user_id, why, created)
  SELECT id, 'owner', datetime('now') FROM users WHERE email NOT LIKE '%@example.com' ORDER BY created LIMIT 1;
