-- Where plan holders get stuck before their first workout (Nov 25, 2026; Vesper objective: trained/plan 4 of 15).
-- COUNTS only, computed by the app from its own tables; Vesper reads these totals and never the tables behind them.
-- "stuck" = built a plan and never trained (no check-off, no synced/logged workout since joining). Of those:
-- Add-only: new columns with defaults on the totals table; no other table is touched.
ALTER TABLE funnel_daily ADD COLUMN stuck INTEGER NOT NULL DEFAULT 0;         -- plan, never trained
ALTER TABLE funnel_daily ADD COLUMN stuck_back INTEGER NOT NULL DEFAULT 0;    -- opened the app on a later day than sign-up
ALTER TABLE funnel_daily ADD COLUMN stuck_push INTEGER NOT NULL DEFAULT 0;    -- notifications on (reminders can reach them)
ALTER TABLE funnel_daily ADD COLUMN stuck_linked INTEGER NOT NULL DEFAULT 0;  -- Strava or Garmin linked (a real run would sync)
ALTER TABLE funnel_daily ADD COLUMN stuck_nudged INTEGER NOT NULL DEFAULT 0;  -- the one "first workout is waiting" nudge reached them
