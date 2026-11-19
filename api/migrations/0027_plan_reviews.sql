-- Referral reward (backlog 13, audit P1-8, approved by Matthew Nov 15 and Nov 17, 2026): "bring 2 training partners
-- -> a personal plan review from Matthew". One row per member who earned it and asked for it. The note is the
-- member's own optional question for Matthew (max 300 characters). Add-only: a new table; nothing else changes.
CREATE TABLE IF NOT EXISTS plan_reviews (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',   -- requested | done
  created TEXT NOT NULL
);
