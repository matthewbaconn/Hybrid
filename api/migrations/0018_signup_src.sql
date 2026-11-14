-- where each member first came from (?src= on the link: ig, reddit, calc, invite, email, site); add-only, existing rows stay NULL
ALTER TABLE users ADD COLUMN src TEXT;
