-- reps per set and number of sets for each logged exercise (progressive overload tracking); add-only, existing rows keep NULL
ALTER TABLE lift_logs ADD COLUMN reps INTEGER;
ALTER TABLE lift_logs ADD COLUMN sets INTEGER;
