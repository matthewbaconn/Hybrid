-- Onboarding drop-off (growth funnel question 4, Nov 17, 2026): the furthest plan-setup step a member reached
-- (0 goal + race, 1 running now, 2 strength and body, 3 training days; 4 = built a plan). Lets the nightly funnel
-- count WHERE members without a plan stopped (counts only). Add-only: existing rows keep NULL ("not recorded yet").
ALTER TABLE users ADD COLUMN setup_step INTEGER;
-- Time to first plan (Matthew's growth metrics, Nov 17): when the member first built a plan. profiles.updated changes on
-- every edit, so it can't say this. Add-only; set once, never overwritten.
ALTER TABLE users ADD COLUMN first_plan_at TEXT;
