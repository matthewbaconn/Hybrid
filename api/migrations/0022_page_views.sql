-- Website visits per page per day (counts only: no IP, no cookie, no person). Add-only; nothing existing changes.
-- Lets growth see visits -> sign-ups per page instead of guessing which pages work.
CREATE TABLE IF NOT EXISTS page_views (
  day  TEXT NOT NULL,
  path TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
