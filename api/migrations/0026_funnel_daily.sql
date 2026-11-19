-- Daily activation counts (audit P1-2, Nov 17, 2026): how many real members trained, as COUNTS only.
-- The app computes them from its own tables (check-offs and synced runs); Vesper reads only these totals, so it
-- never reads the activities table or any Strava/Garmin data. No member ids, names or activity details are stored.
-- Add-only: a new table; existing rows in other tables are untouched.
CREATE TABLE IF NOT EXISTS funnel_daily (
  day TEXT PRIMARY KEY,           -- UTC date the counts were taken (refreshed every cron run that day)
  signed_up INTEGER NOT NULL,     -- real members
  plan INTEGER NOT NULL,          -- built a plan
  checked_off INTEGER NOT NULL,   -- built a plan and ever checked off a workout in the app
  trained INTEGER NOT NULL,       -- built a plan and ever trained: a check-off OR a synced/logged workout
  trained_7d INTEGER NOT NULL,    -- trained in the last 7 days (check-off or workout dated in the last 7 days)
  d7_eligible INTEGER NOT NULL,   -- joined 7+ days ago
  active_d7 INTEGER NOT NULL,     -- of those, still active after their first week
  returned INTEGER NOT NULL DEFAULT 0,   -- came back: any activity (check-off, food, check-in, workout, login) on a later day than sign-up
  via_invite INTEGER NOT NULL DEFAULT 0, -- joined through a member's invite link
  referrers INTEGER NOT NULL DEFAULT 0,  -- members who brought at least one member
  act72_eligible INTEGER NOT NULL DEFAULT 0, -- built a plan and joined 3+ days ago (activation denominator)
  act72 INTEGER NOT NULL DEFAULT 0,          -- of those, trained within 3 days of joining: check-off OR synced/logged workout
  updated TEXT NOT NULL
);
