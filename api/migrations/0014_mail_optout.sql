-- people who tapped "unsubscribe" in a HYBRD update email
ALTER TABLE users ADD COLUMN no_mail INTEGER NOT NULL DEFAULT 0;
