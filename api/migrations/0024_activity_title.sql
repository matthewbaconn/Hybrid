-- the member's own name for a workout ("Sunday long run with Dad"). Kept apart from `name`, which every Strava/Garmin
-- sync writes again, so a rename is never overwritten and the original name is never lost. Add-only: existing rows keep NULL.
ALTER TABLE activities ADD COLUMN title TEXT;
