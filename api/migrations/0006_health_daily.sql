-- daily watch data sent from Apple Health (Apple Watch, or Garmin via Apple Health) by an iPhone Shortcut
CREATE TABLE IF NOT EXISTS health_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep_h REAL,
  rhr INTEGER,
  hrv INTEGER,
  steps INTEGER,
  active_cal INTEGER,
  updated TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
