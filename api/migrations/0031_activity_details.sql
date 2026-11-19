-- Edit a workout like Strava (Matthew, Nov 18 11:36am): a description ("How'd it go?"), the member's own sport type, a tag
-- (race, long run, workout...), private notes and which shoes. Kept in their own columns so a Strava/Garmin sync, which
-- rewrites name/type, never overwrites what the member wrote. Shoes live in `gear`, miles add up from activities.gear_id.
-- Add-only: existing rows keep NULL.
ALTER TABLE activities ADD COLUMN descr TEXT;
ALTER TABLE activities ADD COLUMN type_set TEXT;
ALTER TABLE activities ADD COLUMN tag TEXT;
ALTER TABLE activities ADD COLUMN note TEXT;
ALTER TABLE activities ADD COLUMN gear_id TEXT;
CREATE TABLE IF NOT EXISTS gear (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_mi REAL NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gear_user ON gear(user_id);
