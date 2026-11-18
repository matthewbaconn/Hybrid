-- When the app last saw each member (Members screen "active"). Add-only.
ALTER TABLE users ADD COLUMN last_seen TEXT;
