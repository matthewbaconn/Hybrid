-- HQ command tiers (Nov 20): each mailbox row can carry the command's own id (a random UUID, plus ":<n>" for the
-- n-th status update Vesper posts about it). A retried POST with the same id is answered with the row already
-- stored, so a network retry never queues a command twice. The id is random and says nothing. Add-only.
ALTER TABLE hq_box ADD COLUMN cid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS hq_box_cid ON hq_box (box, d, cid) WHERE cid IS NOT NULL;
