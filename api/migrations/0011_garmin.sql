-- Direct Garmin Connect link (OAuth2 PKCE). One row per Hybrid account.
CREATE TABLE IF NOT EXISTS garmin_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  garmin_user_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  permissions TEXT,
  connected TEXT NOT NULL,
  last_push TEXT
);
-- PKCE code verifier for the Garmin sign-in (Strava rows leave it empty)
ALTER TABLE oauth_states ADD COLUMN verifier TEXT;
