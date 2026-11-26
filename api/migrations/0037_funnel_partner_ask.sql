-- Partner ask (#146, "Training with someone?" after the 3rd workout) measured on the server (Nov 26, 2026; growth sprint
-- ask, product/log.md Nov 24). Until now its state lived only in the member's browser, so the Dec 1 read could not tell
-- "nobody reached 3 workouts" from "saw it and didn't share". COUNTS only: the app keeps each member's own answer in
-- their settings (pm = shown | sent | skip) and the nightly writes the totals here.
-- Add-only: new columns with defaults on the totals table; no other table is touched.
ALTER TABLE funnel_daily ADD COLUMN pm_shown INTEGER NOT NULL DEFAULT 0;  -- members who were shown the ask (any answer)
ALTER TABLE funnel_daily ADD COLUMN pm_sent INTEGER NOT NULL DEFAULT 0;   -- tapped "Send them your link" and shared it
ALTER TABLE funnel_daily ADD COLUMN pm_skip INTEGER NOT NULL DEFAULT 0;   -- tapped "Not now"
