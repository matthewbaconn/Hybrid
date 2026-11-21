-- HQ mailbox (Nov 20): opaque encrypted envelopes between the owner's HQ page and Vesper's server.
-- No member data: the Worker can't read an envelope (it never has the key). Add-only.
CREATE TABLE IF NOT EXISTS hq_box (id INTEGER PRIMARY KEY AUTOINCREMENT, box TEXT NOT NULL, d TEXT NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hq_box_box ON hq_box (box, id);
