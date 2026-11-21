-- Signed admin actions from Vesper (Nov 20, 2026: "Resend welcome" in HQ). One row per signed request, so a
-- request can never be replayed, and per-member / per-day limits can be counted. Add-only; no member data changes.
CREATE TABLE IF NOT EXISTS admin_log (sig_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admin_log_user ON admin_log (user_id, kind, at);
