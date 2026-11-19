-- Visitor kinds per page per day (Nov 17, 2026 diagnostic): counts only, one broad label per load (api/visits.mjs).
-- No IP, no user agent, no cookie, no person. Add-only; nothing existing changes. Rows older than 30 days are pruned.
CREATE TABLE IF NOT EXISTS page_view_kinds (
  day  TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, kind)
);
