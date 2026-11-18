// Members screen dates (Nov 17): joined/active are the member's local day, not the UTC date; "active" uses the newest of
// when the app last saw them and their last logged day, never a future day.   TZ=America/New_York node tests/member_dates.mjs
import "../plan.js";
const HP = globalThis.HP; let bad = 0;
const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
process.env.TZ || console.log("(run with TZ=America/New_York for the Florida checks)");
const ny = Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York";
if (ny) {
  t(HP.localDay("2026-11-18T01:30:00.000Z") === "2026-11-17", "a 8:30pm Florida sign-up shows as that day, not the next (UTC date)");
  t(HP.localDay("2026-11-17T14:00:00.000Z") === "2026-11-17", "a daytime time keeps its day");
}
t(HP.localDay("2026-11-16") === "2026-11-16" && HP.localDay(null) === null, "a plain day stays as it is; nothing stays nothing");
const today = "2026-11-17";
t(HP.lastActiveDay({last_seen: null, last_day: "2026-11-16"}, today) === "2026-11-16", "a logged day counts when the app has no time yet");
t(HP.lastActiveDay({last_seen: "2026-11-17T15:00:00.000Z", last_day: "2026-11-12"}, today) === "2026-11-17", "the newest of the two wins");
t(HP.lastActiveDay({last_seen: null, last_day: "2026-11-20"}, today) === null, "a meal planned for a future day is not activity");
t(HP.lastActiveDay({}, today) === null, "never seen = nothing");
process.exit(bad ? 1 : 0);
