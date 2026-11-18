-- One-time answer to "How did you hear about Mileset?" for members with no ?src= tag (or "skip"). Add-only.
ALTER TABLE users ADD COLUMN src_answer TEXT;
