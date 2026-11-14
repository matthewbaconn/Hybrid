// Plan logic for the Nov 14 batch: short races, every sport counts, treadmill/outside, effort-based feedback, cycle.
//   node tests/plan_features.mjs
import "../plan.js";
const HP = globalThis.HP; let bad = 0;
const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const today = "2026-11-14";
for (const goal of ["5k", "10k", "half", "marathon", "50k", "hyrox", "tri_sprint", "tri_half", "tri_full", "swim", "bike"]) for (const d of [1, 4, 9, 13]) {
  const pl = HP.buildPlan({goal, raceDate: HP.addDays(today, d), days: [0, 1, 3, 5, 6], longDay: 6, weekly: 25, longest: 10, hours: 5}, today);
  const race = pl.weeks.flatMap(w => w.days).find(x => x.sessions.some(s => s.type === "race"));
  t(race && race.date === HP.addDays(today, d) && /Race week/.test(pl.weeks[pl.weeks.length - 1].phase), goal + " race in " + d + " days builds a plan ending in race week");
}
const pl = HP.buildPlan({goal: "half", raceDate: "2027-02-07", days: [0, 1, 3, 5, 6], longDay: 6, weekly: 20, longest: 8, age: 30}, today);
const ez = pl.weeks[1].days.find(x => x.sessions.some(s => s.type === "easy"));
const pk = {id: "p", date: ez.date, type: "other", sport: "Pickleball", name: "Evening game", minutes: 70};
t(HP.sportOf(pk).label === "Racquet sport", "pickleball is a racquet sport");
t(HP.dayMatches(pl, [pk], ez.date)[0] && HP.dayMatches(pl, [pk], ez.date)[0].sub, "pickleball covers a missed easy run");
t(!HP.dayMatches(pl, [{...pk, minutes: 10}], ez.date)[0], "10 min of pickleball does not");
const run = {id: "r", date: ez.date, type: "run", mi: 4, minutes: 40};
t(HP.dayMatches(pl, [pk, run], ez.date)[0].id === "r", "a real run still takes the easy session first");
const sm = HP.actSummary(pl, [pk], pk, ez.date);
t(sm.name === "Pickleball" && /Counted as today's easy run/.test(sm.lines.join(" ")), "summary names the sport and how it counted");
t(HP.effortOf({type: "other", minutes: 30, rpe: 8}) === 8, "typed effort wins");
t(HP.effortOf({type: "other", minutes: 30, avg_hr: 170}, 190) >= 7, "heart rate sets effort when there is no rating");
const wk = pl.weeks[2].days.find(x => x.sessions.some(s => s.type === "workout")), wi = wk.sessions.findIndex(s => s.type === "workout");
const tm = HP.buildPlan({...pl.profile, venues: {[wk.date + "-" + wi]: "treadmill"}}, today), s2 = tm.weeks[2].days.find(x => x.date === wk.date).sessions[wi];
t(s2.venue === "treadmill", "treadmill choice sticks to its session");
const gw = HP.garminWorkout(tm, s2, {}, false, wk.date);
t(!gw || /^Treadmill · /.test(gw.workoutName), "watch gets one workout labeled Treadmill");
const fb = HP.feedback(pl, [{id: "e", date: ez.date, type: "run", minutes: 40, mi: 0, rpe: 8}], HP.addDays(ez.date, 1));
t(Object.values(fb.assess).some(a => a.byFeel && a.verdict === "hard"), "no-watch run rated 8/10 counts as too hard");
const cy = {on: true, last: "2026-11-01", len: 28, plen: 5};
t(HP.cyclePhase(cy, "2026-11-02").key === "period" && HP.cyclePhase(cy, "2026-11-20").key === "luteal", "cycle phases");
t(/make today easy/.test(HP.cycleAdvice(cy, "2026-11-02", [{type: "workout", title: "Tempo"}], ["cramps"]).today), "cramps turn a hard day easy");
t(HP.cyclePhase({on: false, last: "2026-11-01"}, "2026-11-02") === null, "cycle off: nothing");
console.log(bad ? bad + " failed" : "ALL PASS"); process.exit(bad ? 1 : 0);
