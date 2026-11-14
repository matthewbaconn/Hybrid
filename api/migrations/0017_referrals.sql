-- who invited each member (the first 8 characters of the inviter's id came in the invite link); add-only
ALTER TABLE users ADD COLUMN ref TEXT;
