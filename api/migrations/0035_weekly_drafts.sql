-- Weekly member email written and sent by the Worker (Nov 23, 2026). One row per week: the draft, when it goes out,
-- and its status (ready, sent, cancelled, skipped). token = the private link in Matthew's [Test] copy to read or cancel it.
-- Add-only; no member data.
CREATE TABLE IF NOT EXISTS weekly_drafts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL,
  created TEXT NOT NULL,
  send_after TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  token TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_drafts_token ON weekly_drafts (token);
