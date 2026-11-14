-- how hard an activity felt (1-10, session RPE) so every sport counts without a watch, and where a run happened
-- (treadmill/outside). Add-only: existing rows keep NULL.
ALTER TABLE activities ADD COLUMN rpe INTEGER;
ALTER TABLE activities ADD COLUMN venue TEXT;
