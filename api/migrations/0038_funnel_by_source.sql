-- Sign-ups and trained members per sign-up source, as one JSON of COUNTS (Nov 27, 2026; Matthew's tracking audit).
-- ceo_state's "by_source" was built by Vesper from check-offs and lift logs only (it may never read activities), so a
-- member whose first workout was a synced run was missing from it. The app counts it here with the same rule as
-- funnel_daily.trained (plan + check-off OR a workout synced/logged on or after joining), so the per-source trained
-- totals always add up to "trained". Shape: {"<src>": {"signed_up": n, "trained": n}}. No member is named.
-- Add-only: one new nullable column on the totals table; no other table is touched.
ALTER TABLE funnel_daily ADD COLUMN by_source TEXT;
