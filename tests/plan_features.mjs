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
const td = HP.buildPlan({...pl.profile, venue: "treadmill", venues: {[wk.date + "-" + wi]: "outside"}}, today);
t(td.weeks[1].days.flatMap(d => d.sessions).filter(x => ["easy", "long", "workout"].includes(x.type)).every(x => x.venue === "treadmill")
  && td.weeks[2].days.find(x => x.date === wk.date).sessions[wi].venue === "outside", "treadmill default covers every run; one run can still go outside");
t(td.weeks[1].days.flatMap(d => d.sessions).filter(x => x.type === "lift").every(x => !x.venue), "lifts never get a venue");
const zz = HP.zonesFrom({}, 30);
t(zz && zz.estimated && zz.base === 187 && HP.hrFor("E", zz).zone === 2 && HP.hrFor("T", zz).zone === 4, "zones from age; easy = Z2, threshold = Z4");
t(HP.zonesFrom({hr_method: "lthr", hr_lthr: 170}).method === "lthr", "threshold-based zones");
const hp = HP.buildPlan({...pl.profile, target: "hr"}, today), hw = hp.weeks[3].days.flatMap(d => d.sessions).find(x => x.type === "workout");
const hg = HP.garminWorkout({...hp, hrZones: zz}, hw, {}, false, "2026-12-01");
t(hg && JSON.stringify(hg).includes('"HEART_RATE"') && !JSON.stringify(hg).includes('"PACE"'), "run by heart rate: watch gets bpm targets, not pace");
const fg = HP.garminWorkout(HP.buildPlan({...pl.profile, target: "feel"}, today), hw, {}, false, "2026-12-01");
t(fg && !JSON.stringify(fg).includes('"PACE"'), "run by feel: no pace alarms on the watch");
const fb = HP.feedback(pl, [{id: "e", date: ez.date, type: "run", minutes: 40, mi: 0, rpe: 8}], HP.addDays(ez.date, 1));
t(Object.values(fb.assess).some(a => a.byFeel && a.verdict === "hard"), "no-watch run rated 8/10 counts as too hard");
const cy = {on: true, last: "2026-11-01", len: 28, plen: 5};
t(HP.cyclePhase(cy, "2026-11-02").key === "period" && HP.cyclePhase(cy, "2026-11-20").key === "luteal", "cycle phases");
t(/make today easy/.test(HP.cycleAdvice(cy, "2026-11-02", [{type: "workout", title: "Tempo"}], ["cramps"]).today), "cramps turn a hard day easy");
t(HP.cyclePhase({on: false, last: "2026-11-01"}, "2026-11-02") === null, "cycle off: nothing");
// low mileage on many days: week 1 stays within ~20% of what the athlete runs now (beginner 5K page sends people here)
const DAYSETS = {3: [1, 3, 6], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6]}; let over = [];
for (const goal of ["5k", "10k", "half", "fitness"]) for (const wk of [0, 5, 8, 10, 12, 15, 20]) for (const n of [3, 4, 5, 6]) {
  const lp = HP.buildPlan({goal, days: DAYSETS[n], longDay: 6, weekly: wk, longest: 3, raceDate: goal === "fitness" ? undefined : "2027-02-28"}, "2026-11-16");
  if (lp.weeks[0].miles > Math.max(8, wk) * 1.2) over.push(goal + " " + wk + "mi " + n + "d = " + lp.weeks[0].miles);
}
t(!over.length, "low-mileage week 1 within 20% of current miles" + (over.length ? ": " + over.join(", ") : ""));
const b5 = HP.buildPlan({goal: "5k", days: DAYSETS[5], longDay: 6, weekly: 8, longest: 3, raceDate: "2027-02-28"}, "2026-11-16");
const runsW1 = b5.weeks[0].days.filter(d => d.sessions.some(s => s.mi)).map(d => HP.dow(d.date));
t(runsW1.length === 3 && runsW1.every((d, i) => !i || d - runsW1[i - 1] > 1), "8 mi on 5 days: 3 runs, none back to back (" + runsW1 + ")");
const old5 = HP.buildPlan({goal: "5k", days: DAYSETS[5], longDay: 6, weekly: 8, longest: 3, raceDate: "2027-02-28", start: "2026-11-09"}, "2026-11-15");
t(old5.weeks[0].days.filter(d => d.sessions.some(s => s.mi)).length === 5, "weeks before the change keep their run days (check-offs stay put)");
const s20 = HP.buildPlan({goal: "half", days: DAYSETS[5], longDay: 6, weekly: 20, longest: 8, raceDate: "2027-02-28"}, "2026-11-16");
t(s20.weeks.every(w => /Race week/.test(w.phase) || w.days.filter(d => d.sessions.some(s => s.mi)).length === 5), "20 mi/week on 5 days still runs all 5 days");
// Pinned lifting days (Nov 17, preview "liftdays"): lifts stay on the days the athlete picked, the count stays theirs
const liftOn = (w) => w.days.map((d, i) => d.sessions.some(s => s.type === "lift") ? i : -1).filter(i => i >= 0);
const pinRun = HP.buildPlan({goal: "half", raceDate: "2027-03-07", days: [0, 2, 4, 6], longDay: 6, weekly: 20, longest: 8, lifts: 2, liftDays: [1, 3]}, today);
t(pinRun.weeks.filter(w => !/Race week/.test(w.phase)).every(w => liftOn(w).join() === "1,3"), "half plan: lifts on the pinned Tue + Thu every week before race week");
const rw = pinRun.weeks[pinRun.weeks.length - 1], rIdx = rw.days.findIndex(d => d.sessions.some(s => s.type === "race"));
t(!rw.days.slice(Math.max(0, rIdx - 1), rIdx + 1).some(d => d.sessions.some(s => s.type === "lift")), "no lift on race day or the day before, even if pinned");
const pinOne = HP.buildPlan({goal: "10k", raceDate: "2027-02-07", days: [0, 2, 4, 6], longDay: 6, weekly: 20, longest: 8, lifts: 3, liftDays: [5]}, today);
t(pinOne.weeks[1].days[5].sessions.some(s => s.type === "lift") && liftOn(pinOne.weeks[1]).length === 3, "one pinned day + the plan picks the other two");
const pinMore = HP.buildPlan({goal: "10k", raceDate: "2027-02-07", days: [0, 2, 4, 6], longDay: 6, weekly: 20, longest: 8, lifts: 1, liftDays: [1, 3, 5]}, today);
t(liftOn(pinMore.weeks[1]).length === 1, "more pins than lifting days never adds lifts");
const pinBad = HP.buildPlan({goal: "half", raceDate: "2027-03-07", days: [0, 2, 4, 6], longDay: 6, weekly: 20, longest: 8, lifts: 2, liftDays: ["x", 9, -1, 2.5]}, today);
const pinNone = HP.buildPlan({goal: "half", raceDate: "2027-03-07", days: [0, 2, 4, 6], longDay: 6, weekly: 20, longest: 8, lifts: 2}, today);
t(JSON.stringify(pinBad.weeks) === JSON.stringify(pinNone.weeks), "junk pins are ignored (same plan as no pins)");
for (const goal of ["hyrox", "tri_olympic", "everyday"]){
  const pm = HP.buildPlan({goal, raceDate: goal === "everyday" ? null : "2027-03-07", days: [0, 1, 3, 4, 6], longDay: 6, weekly: 15, longest: 6, hours: 6, lifts: 2, fitLevel: "some", liftDays: [1, 4]}, today);
  t(pm.weeks.slice(0, 4).every(w => [1, 4].every(d => w.days[d].sessions.some(s => s.type === "lift"))), goal + ": lifts land on the pinned Tue + Fri");
}
// Nov 17: easy pace is optional in setup ("leave it blank"). Blank = paces from current miles, slower for fewer miles;
// older profiles without a pace keep the 10:00 default (their plans don't change).
{ const base = {goal: "5k", raceDate: HP.addDays(today, 70), days: [1, 3, 6], longDay: 6, longest: 3, prDist: "none", prSec: null, easyPace: null};
  const E = q => HP.fitnessFrom ? HP.fitnessFrom(q).pace.E[0] : null;
  const pl0 = HP.buildPlan({...base, weekly: 5, paceUnknown: true}, today);
  t(pl0 && pl0.weeks.length > 0, "a plan builds with no race and no pace");
  if (HP.fitnessFrom){
    t(E({...base, weekly: 5, paceUnknown: true}) > E({...base, weekly: 30, paceUnknown: true}), "blank pace: fewer miles = slower easy pace");
    t(Math.abs(E({...base, weekly: 5}) - E({...base, weekly: 30})) < 1, "older profiles without a pace keep the same default");
  }
}
{ // Beginner week 1 (CEO shift B3 re-measure, Nov 18): plans built from Nov 18 on (pv 2) start at about what the runner does
  // now: week 1 <= max(stated x 1.2, stated + 2) on 5K/10K, 3-6 days, 2-20 mi; no 25%+ spikes for low-mileage starts;
  // plans built before (no pv) and 15+ mi/week plans keep exactly the same shape (check-offs are keyed to sessions).
  const DAYSET = {3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 6]};
  let over = [], spikes = [], changed = 0;
  for (const goal of ["5k", "10k"]) for (const nd of [3, 4, 5, 6]) for (const w of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20]) {
    const p = {goal, weekly: w, longest: Math.max(2, Math.round(w / 3)), days: DAYSET[nd], longDay: 6, lifts: 0, pv: 2, start: "2026-11-23", raceDate: goal === "5k" ? "2027-02-28" : null};
    const m = HP.buildPlan(p, "2026-11-18").weeks.map(x => x.miles);
    if (m[0] > Math.max(w * 1.2, w + 2) + 1e-9) over.push(`${goal} ${nd}d ${w}mi: week 1 ${m[0]}`);
    if (w < 8) for (let i = 1; i < Math.min(m.length - 3, 10); i++) if (m[i] > Math.max(m[i - 1] * 1.25, m[i - 1] + 2.5) && m[i] > Math.max(...m.slice(0, i)) * 1.25) { spikes.push(`${goal} ${nd}d ${w}mi week ${i + 1}: ${m.slice(0, i + 1)}`); break; }
  }
  for (const goal of ["5k", "half", "marathon"]) for (const w of [15, 20, 30, 45]) {
    const p = {goal, weekly: w, longest: Math.round(w / 3), days: [0, 1, 3, 4, 6], longDay: 6, lifts: 2, start: "2026-11-23", raceDate: "2027-03-28"};
    if (JSON.stringify(HP.buildPlan(p, "2026-11-18").weeks) !== JSON.stringify(HP.buildPlan({...p, pv: 2}, "2026-11-18").weeks)) changed++;
  }
  const old = {goal: "5k", weekly: 3, longest: 2, days: [1, 3, 5], longDay: 5, lifts: 0, start: "2026-11-16"};
  t(!over.length, "beginner week 1 stays within +20% or +2 mi of what they run now" + (over.length ? ": " + over.slice(0, 3).join("; ") : ""));
  t(!spikes.length, "low-mileage starts climb without 25% spikes" + (spikes.length ? ": " + spikes.slice(0, 2).join("; ") : ""));
  t(!changed, "15+ mi/week plans are unchanged by the fix");
  t(JSON.stringify(HP.buildPlan(old, "2026-11-18").weeks) === JSON.stringify(HP.buildPlan({...old, pv: 1}, "2026-11-18").weeks) && HP.buildPlan(old, "2026-11-18").weeks[0].miles === 9,
    "plans built before Nov 18 keep their shape until rebuilt");
  const nw = HP.buildPlan({...old, pv: HP.PLAN_V, start: "2026-11-23"}, "2026-11-18").weeks[0];
  t(nw.miles <= 5 && nw.days.some(d => d.sessions.some(s => /walk breaks/.test(JSON.stringify(s.steps)))) && !nw.days.some(d => d.sessions.some(s => s.type === "workout")),
    "a 3 mi/week beginner's first week: about 5 mi, short runs with walk breaks, no hard workout");
}
console.log(bad ? bad + " failed" : "ALL PASS"); process.exit(bad ? 1 : 0);
