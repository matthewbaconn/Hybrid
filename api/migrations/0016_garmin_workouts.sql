-- Planned sessions sent to each athlete's Garmin calendar (Training API), so changes update the watch
CREATE TABLE IF NOT EXISTS garmin_workouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  idx INTEGER NOT NULL,
  hash TEXT NOT NULL,
  workout_id TEXT,
  schedule_id TEXT,
  updated TEXT NOT NULL,
  PRIMARY KEY (user_id, date, idx)
);
