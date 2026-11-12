/* Hybrid plan logic, shared by the app (index.html) and the server (api/worker.js).
   Plan builder, paces, run feedback and calorie rules. No DOM, no network. */
(function(root){
"use strict";
const pad = n => String(n).padStart(2, "0");
const isoLocal = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const dow = s => (parseD(s).getUTCDay() + 6) % 7;            // 0 = Monday
const mondayOf = s => addDays(s, -dow(s));
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAYF = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtD = s => { const d = parseD(s); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
const r5 = x => Math.round(x / 5) * 5;
const half = x => Math.round(x * 2) / 2;
const fmtPace = s => { s = Math.round(s); return Math.floor(s / 60) + ":" + pad(s % 60); };
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? h + ":" + pad(m) + ":" + pad(x) : m + ":" + pad(x); };
// "2410" -> "24:10", "14500" -> "1:45:00": colons fill in from the right (seconds, minutes, hours)
const fmtDigits = v => { const d = String(v).replace(/\D/g, "").replace(/^0+(?=\d{3})/, "").slice(0, 6); if (d.length <= 2) return d;
  const sec = d.slice(-2), rest = d.slice(0, -2); return rest.length <= 2 ? rest + ":" + sec : rest.slice(0, -2) + ":" + rest.slice(-2) + ":" + sec; };
const parseTime = t => { if (!t) return null; t = String(t).trim(); if (/^\d+$/.test(t)) t = fmtDigits(t); const p = t.split(/[:.]/).map(x => x.trim()); if (p.some(x => !/^\d+$/.test(x))) return null;
  const n = p.map(Number); if (n.length === 2) return n[0] * 60 + n[1]; if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2]; return null; };
const comma = n => Math.round(n).toLocaleString("en-US");


/* ============ plan builder (rule-based) ============ */
const RACES = { "5k": {name:"5K", mi:3.107}, "10k": {name:"10K", mi:6.214}, "half": {name:"Half marathon", mi:13.109}, "marathon": {name:"Marathon", mi:26.219}, "fitness": {name:"General fitness", mi:null} };
const LONG_CAP = {"5k":9, "10k":11, "half":13, "marathon":20, "fitness":10};
const LONG_GOAL = {"5k":7, "10k":9, "half":12, "marathon":20, "fitness":7};   // longest run reached at peak
const PEAK = {"5k":[1.25,18,40], "10k":[1.3,22,45], "half":[1.35,28,50], "marathon":[1.4,35,55], "fitness":[1.2,15,35]};
const TAPER = {"5k":[.65], "10k":[.65], "half":[.75,.55], "marathon":[.75,.6,.45], "fitness":[.7]};
const riegel = (t, d1, d2) => t * Math.pow(d2 / d1, 1.06);

function fitnessFrom(p){
  // seconds per mile at each effort, from a recent race (Riegel) or a typical easy pace
  let base;
  if (p.prDist && p.prSec) base = {d: RACES[p.prDist].mi, t: p.prSec};
  else { const easy = p.easyPace || 600; base = {d: 26.219, t: (easy - 80) * 26.219}; }
  const T = d => riegel(base.t, base.d, d);
  const pred = {"5k": T(3.107), "10k": T(6.214), "half": T(13.109), "marathon": T(26.219)};
  const p5 = pred["5k"] / 3.107, p10 = pred["10k"] / 6.214, pH = pred.half / 13.109, pM = pred.marathon / 26.219;
  return {pred, pace: {E: [pM + 60, pM + 110], L: [pM + 45, pM + 100], M: pM, H: pH, T: (p10 + pH) / 2, I: p5 - 5, R: p5 - 25}};
}

const LIFTS = {
  lower: {title:"Strength · lower body", steps:["Back squat 4 × 5","Romanian deadlift 3 × 8","Walking lunge 3 × 10 / leg","Calf raise 3 × 15","Plank 3 × 45 s"]},
  upper: {title:"Strength · upper body", steps:["Bench press 4 × 6","Pull-ups 4 × max (leave 1–2 in the tank)","Overhead press 3 × 8","Dumbbell row 3 × 10","Curls + triceps 3 × 12"]},
  full:  {title:"Strength · full body", steps:["Trap-bar deadlift 4 × 5","Push-ups 3 × 12","Goblet squat 3 × 10","Single-arm row 3 × 10","Side plank 3 × 30 s / side"]},
  dura:  {title:"Strength · running legs", steps:["Step-ups 3 × 8 / leg","Single-leg RDL 3 × 8 / leg","Bulgarian split squat 3 × 8 / leg","Hip thrust 3 × 10","Copenhagen plank 3 × 20 s / side"]},
  size:  {title:"Strength · upper size", steps:["Incline dumbbell press 4 × 10","Lat pulldown 4 × 10","Lateral raise 3 × 15","Cable row 3 × 12","Arms superset 3 × 12"]}
};
const LIFT_SETS = {1:["full"], 2:["lower","upper"], 3:["lower","upper","full"], 4:["lower","upper","dura","size"]};

function pace(P, k){ return k === "E" || k === "L" ? fmtPace(P[k][0]) + "–" + fmtPace(P[k][1]) : fmtPace(P[k] - 5) + "–" + fmtPace(P[k] + 5); }
const PNAME = {E:"easy", L:"easy", M:"marathon pace", H:"half pace", T:"threshold", I:"interval", R:"fast", G:"goal pace"};

function workoutFor(goal, phase, i, P){
  // work is in miles; reps measured in metres
  const lib = {
    base: [
      {name:"Hill sprints", k:"E", work:0, steps:[["Easy", null, "E"], ["8 × 15 s hill sprints, walk back down", null, null]]},
      {name:"Progression run", k:"T", work:1.5, steps:[["Easy", null, "E"], ["Last 1.5 mi steady", null, "T", 15]]},
      {name:"Fartlek", k:"I", work:1.5, steps:[["Easy", null, "E"], ["8 × 1 min quick / 1 min easy", null, "I"]]}
    ],
    "5k":    [{name:"800s", reps:6, m:800, k:"I", rest:"400 m jog"}, {name:"Mile repeats", reps:3, m:1609, k:"T", rest:"1 min jog"}, {name:"1K repeats", reps:5, m:1000, k:"I", rest:"2 min jog"}, {name:"400s", reps:10, m:400, k:"R", rest:"200 m jog"}],
    "10k":   [{name:"1K repeats", reps:5, m:1000, k:"I", rest:"2 min jog"}, {name:"Threshold miles", reps:4, m:1609, k:"T", rest:"1 min jog"}, {name:"2K repeats", reps:3, m:2000, k:"I", rest:"3 min jog"}, {name:"Tempo", cont:4, k:"T"}],
    "half":  [{name:"Threshold 2s", reps:3, m:3218, k:"T", rest:"2 min jog"}, {name:"Tempo", cont:5, k:"T"}, {name:"Mile repeats", reps:5, m:1609, k:"T", rest:"1 min jog"}, {name:"Half-pace run", cont:6, k:"H"}],
    "marathon": [{name:"Threshold 3s", reps:2, m:4828, k:"T", rest:"3 min jog"}, {name:"Marathon-pace run", cont:7, k:"M"}, {name:"Mile repeats", reps:5, m:1609, k:"T", rest:"1 min jog"}, {name:"Marathon-pace run", cont:9, k:"M"}],
    "fitness": [{name:"Tempo", cont:3, k:"T"}, {name:"Fartlek", reps:8, m:400, k:"I", rest:"1 min easy"}, {name:"Mile repeats", reps:3, m:1609, k:"T", rest:"2 min jog"}]
  };
  if (phase === "Base"){ const w = lib.base[i % lib.base.length]; return {kind:"base", ...w}; }
  const L = lib[goal]; let w = {...L[i % L.length]};
  if (phase === "Taper") w = w.cont ? {...w, cont: Math.max(2, Math.round(w.cont * .5))} : {...w, reps: Math.max(2, Math.round(w.reps * .6))};
  if (phase === "Peak" && w.reps) w.reps += 1;
  return w;
}

function buildPlan(p, today){
  today = today || isoLocal(new Date());
  const goal = p.goal, fit = fitnessFrom(p), P = {...fit.pace};
  const goalSec = p.goal !== "fitness" && p.goalSec ? p.goalSec : null;
  P.G = goalSec ? goalSec / RACES[goal].mi : (goal !== "fitness" ? fit.pred[goal] / RACES[goal].mi : P.T);
  let start = p.start || mondayOf(today), N, raceDate = null;
  if (goal !== "fitness" && p.raceDate){
    raceDate = p.raceDate;
    N = Math.floor(daysBetween(start, raceDate) / 7) + 1;
    if (N > 24){ start = addDays(mondayOf(raceDate), -23 * 7); N = 24; }
  } else N = 12;
  const tw = TAPER[goal].length, B = Math.max(1, N - tw);
  const m0 = Math.max(8, p.weekly || 0), [mul, floorM, cap] = PEAK[goal];
  let peak = Math.min(cap, Math.max(m0 * mul, Math.min(floorM, m0 * 1.6)));
  peak = Math.min(peak, m0 * Math.pow(1.1, Math.max(1, B - 1)));
  const runDays = p.days.slice().sort((a, b) => a - b), longDay = p.longDay;
  // quality days: furthest from the long run, 2+ days away
  const gap = (a, b) => Math.min(Math.abs(a - b), 7 - Math.abs(a - b));
  const cands = runDays.filter(d => d !== longDay && gap(d, longDay) >= 2).sort((a, b) => (Math.abs(a - 2) - Math.abs(b - 2)) || (gap(b, longDay) - gap(a, longDay)));
  const q1 = cands.length ? cands[0] : runDays.find(d => d !== longDay);
  const q2c = cands.filter(d => d !== q1 && gap(d, q1) >= 2);
  const q2 = runDays.length >= 5 && q2c.length ? q2c[0] : null;
  const weeks = []; let prevLong = Math.max(3, p.longest || 3), wIdx = {q:0, b:0};
  for (let i = 0; i < N; i++){
    const ws = addDays(start, i * 7);
    let phase, miles;
    if (i < B){
      phase = i < B * .4 ? "Base" : i < B * .85 ? "Build" : "Peak";
      miles = m0 + (peak - m0) * (B === 1 ? 1 : i / (B - 1));
      if (i % 4 === 3 && i < B - 1) { miles *= .8; phase = phase + " · lighter"; }
    } else { phase = i === N - 1 && goal !== "fitness" ? "Race week" : "Taper"; miles = peak * TAPER[goal][i - B]; }
    miles = half(miles);
    const isLight = /lighter/.test(phase), ph = phase.split(" ·")[0];
    const days = Array.from({length: 7}, (_, d) => ({date: addDays(ws, d), sessions: []}));
    const raceIdx = raceDate && raceDate >= ws && raceDate <= addDays(ws, 6) ? dow(raceDate) : null;
    const lastFit = goal === "fitness" && i === N - 1;
    let used = 0;
    // long run (or the race)
    if (raceIdx != null){
      const r = RACES[goal];
      days[raceIdx].sessions.push({type:"race", title:"Race day · " + r.name, mi: r.mi, k:"G",
        steps:[["Warm up 10–15 min easy + 4 strides", null, null], [r.name + (goalSec ? " · goal " + fmtTime(goalSec) : ""), null, "G"], ["Start 5 s/mi slower than goal for the first mile, then settle in", null, null]],
        why:"Everything in the plan builds to this. Trust the taper; you will feel fresh."});
      used += r.mi;
    } else if (lastFit){
      days[longDay].sessions.push({type:"race", title:"5K time trial", mi:5, k:"I", steps:[["Warm up 1.5 mi easy + 4 strides", 1.5, "E"], ["5K all-out, even effort", 3.1, null], ["Cool down easy", 0.5, "E"]], why:"See how far you have come. The result sets your next plan's paces."});
      used += 5;
    } else {
      const capL = LONG_CAP[goal];
      const l0 = Math.max(3, p.longest || 3), lg = Math.max(l0, LONG_GOAL[goal]);
      const ramp = l0 + (lg - l0) * Math.min(1, B === 1 ? 1 : i / Math.max(1, B - 1 - (goal === "marathon" ? 1 : 0)));
      let L = Math.min(capL, Math.max(Math.round(miles * .28), Math.round(ramp)), prevLong + 2, Math.max(4, Math.round(miles * (goal === "marathon" ? .5 : .45))));
      if (ph === "Taper") L = Math.max(3, Math.round(prevLong * [.65, .45, .35][Math.min(2, i - B)]));
      if (isLight) L = Math.max(3, Math.round(L * .8));
      L = half(L); if (!isLight && ph !== "Taper") prevLong = Math.max(prevLong, L);
      const mpFinish = goal === "marathon" && (ph === "Build" || ph === "Peak") && i % 2 === 1;
      const halfFinish = goal === "half" && ph === "Peak";
      const steps = mpFinish ? [["Easy " + half(L - 4) + " mi", L - 4, "L"], ["Last 4 mi at marathon pace", 4, "M"]]
        : halfFinish ? [["Easy " + half(L - 3) + " mi", L - 3, "L"], ["Last 3 mi at half pace", 3, "H"]]
        : [["Easy, conversational the whole way", L, "L"]];
      days[longDay].sessions.push({type:"long", title:"Long run · " + L + " mi", mi: L, k:"L", steps,
        why: mpFinish || halfFinish ? "Practising race pace on tired legs is the most race-specific thing you can do." : "Builds the aerobic engine and leg durability. Slow is correct here."});
      used += L;
    }
    // quality sessions
    const qDays = [];
    if (!lastFit && runDays.length >= 3 && q1 != null && !(raceIdx != null && Math.abs(q1 - raceIdx) < 3) && q1 !== raceIdx) qDays.push(q1);
    if (q2 != null && (ph === "Build" || ph === "Peak") && !isLight && raceIdx == null) qDays.push(q2);
    if (raceIdx != null && qDays.length === 0){ const sh = runDays.find(d => d <= raceIdx - 3) ?? null; if (sh != null) qDays.push(sh); }
    qDays.forEach((d, qi) => {
      let w;
      if (qi === 1) w = {name:"Tempo", cont: Math.min(5, Math.max(2, Math.round(miles * .1))), k:"T"};
      else if (raceIdx != null) w = {name:"Sharpener", reps:4, m:400, k:"G", rest:"2 min easy"};
      else w = workoutFor(goal, ph, wIdx[ph === "Base" ? "b" : "q"]++, P);
      if (isLight && w.reps) w = {...w, reps: Math.max(2, w.reps - 2)};
      let steps, mi;
      if (w.kind === "base"){
        const e = Math.max(3, half(miles * .15));
        steps = w.steps.map(s => s[0] === "Easy" ? ["Easy " + e + " mi", e, "E"] : s);
        mi = e + (w.work || 0);
        if (w.work) steps = [["Easy " + half(e) + " mi", e, "E"], [w.steps[1][0], w.work, w.steps[1][2], w.steps[1][3]]];
        if (w.name === "Fartlek") steps = [["Warm up 1 mi easy", 1, "E"], ["8 × 1 min quick / 1 min easy", 2, "I"], ["Easy to finish", Math.max(1, e - 2), "E"]], mi = Math.max(4, e + 1);
      } else {
        const capW = Math.max(2.5, Math.min(goal === "marathon" ? 9 : 6, miles * (w.k === "M" || w.k === "H" ? .3 : .18)));
        if (w.reps){ while (w.reps > 2 && w.reps * w.m / 1609.34 > capW) w = {...w, reps: w.reps - 1}; }
        else if (w.cont > capW) w = {...w, cont: Math.max(2, Math.floor(capW))};
        const work = w.cont ? w.cont : w.reps * w.m / 1609.34;
        mi = half(1.5 + work + 1);
        steps = [["Warm up 1.5 mi easy + 4 strides", 1.5, "E"],
                 [w.cont ? w.cont + " mi at " + PNAME[w.k] : w.reps + " × " + (w.m >= 1600 ? (w.m === 1609 ? "1 mi" : half(w.m / 1609.34) + " mi") : w.m + " m") + " at " + PNAME[w.k] + (w.rest ? ", " + w.rest + " between" : ""), work, w.k],
                 ["Cool down 1 mi easy", 1, "E"]];
      }
      mi = half(mi);
      days[d].sessions.push({type:"workout", title: w.name + " · " + mi + " mi", mi, k: w.k || "T", base: w.kind === "base", steps,
        why: w.kind === "base" ? "Base weeks build strength and form before the harder work starts." : w.k === "T" ? "Threshold work raises the pace you can hold for a long time." : w.k === "M" || w.k === "H" || w.k === "G" ? "Locks in the rhythm of race pace." : "Short, fast reps build speed and running economy."});
      used += mi;
    });
    // easy runs fill the rest
    const easyDays = runDays.filter(d => !days[d].sessions.some(s => s.type !== "lift"));
    const left = Math.max(0, miles - used);
    easyDays.forEach((d, k) => {
      let e = raceIdx != null ? (d === raceIdx - 1 ? 2 : (d > raceIdx ? 0 : 3)) : Math.max(3, half(left / Math.max(1, easyDays.length)));
      if (!e) return;
      const strides = k === 0 && ph !== "Race week" && !lastFit;
      days[d].sessions.push({type:"easy", title:(raceIdx != null && d === raceIdx - 1 ? "Shakeout · " : "Easy run · ") + e + " mi", mi: e, k:"E",
        steps:[["Easy, you should be able to talk", e, "E"]].concat(strides ? [["Finish with 6 × 20 s strides, full recovery", null, null]] : []),
        why: "Easy miles build your base without adding fatigue. Most runs should feel this easy."});
    });
    // lifts
    const nL = Math.min(4, p.lifts || 0);
    if (nL){
      const names = LIFT_SETS[nL], order = [];
      qDays.forEach(d => order.push(d));
      for (let d = 0; d < 7; d++) if (!order.includes(d) && d !== longDay && d !== raceIdx && (raceIdx == null || d < raceIdx - 1)) order.push(d);
      const picks = order.slice(0, nL).sort((a, b) => a - b);
      picks.forEach((d, k) => {
        let key = names[k];
        if ((key === "lower" || key === "dura") && (d + 1) % 7 === longDay){ const sw = names.findIndex(n => n === "upper" || n === "size"); if (sw > -1){ key = names[sw]; names[sw] = names[k]; } }
        const L = LIFTS[key], taper = ph === "Taper" || ph === "Race week" || isLight;
        days[d].sessions.push({type:"lift", title: L.title + (taper ? " · light" : ""), mi: 0, steps: L.steps.map(s => [taper ? s.replace(/^(.*?)(\d) ×/, (m, a, n) => a + Math.max(2, n - 1) + " ×") : s, null, null]),
          why: days[d].sessions.some(s => s.type === "workout") ? "Lift after the run, same day, so your easy days stay easy." : "Strength keeps you durable and holds on to muscle while running volume climbs."});
      });
    }
    weeks.push({n: i + 1, start: ws, phase, miles: half(days.reduce((a, d) => a + d.sessions.reduce((b, s) => b + (s.mi || 0), 0), 0)), days});
  }
  return {profile: p, P, pred: fit.pred, weeks, start, raceDate, created: today};
}


/* ============ shared tracking logic (app + server) ============ */
const avgW = (weights, end) => { const v = []; for (let i = 0; i < 7; i++){ const x = weights[addDays(end, -i)]; if (x) v.push(x); } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const weekIdx = (plan, date) => Math.floor(daysBetween(plan.start, date) / 7);
function dayOf(plan, date){ const wi = weekIdx(plan, date); const w = plan.weeks[wi]; return w ? w.days[dow(date)] : null; }

function readiness(c){
  if (!c) return null;
  const score = Math.round(Math.min(1, c.sleep_h / 8) * 30 + (c.sleep_q - 1) / 4 * 20 + (5 - c.soreness) / 4 * 20 + (c.energy - 1) / 4 * 20 + (5 - c.stress) / 4 * 10);
  const level = c.sleep_h < 5 || score < 50 ? 2 : score < 70 ? 1 : 0;
  return {score, level, word: ["Ready to train", "Go easier today", "Recovery day"][level], tone: ["long", "work", "race"][level]};
}
const ADJ = {
  1: {workout: "Easier today: do one rep fewer and run the reps at the slow end of the range.", long: "Easier today: cut 2 mi and keep every mile easy.", race: "", easy: "Keep it strictly conversational. Slow is fine.", lift: "Drop one set from each exercise."},
  2: {workout: "Recovery day: swap this for 30–40 min very easy, or rest. Move the workout to a later day this week.", long: "Recovery day: make it half the distance, all easy, or move it.", race: "", easy: "Make it 20–30 min very easy, or rest.", lift: "Skip it, or keep it light and short."}
};
function dayMatches(plan, acts, date){
  const day = dayOf(plan, date); if (!day) return {};
  const as = acts.filter(a => a.date === date), runs = as.filter(a => a.type === "run"), lifts = as.filter(a => a.type === "lift"), m = {}; let ri = 0, li = 0;
  day.sessions.forEach((s, i) => { if (s.type === "lift"){ if (lifts[li]) m[i] = lifts[li++]; } else if (runs[ri]) m[i] = runs[ri++]; });
  return m;
}

/* ---------- runs adjust from how the last ones went ----------
   Workouts: reps (laps, or the work pace typed in) vs target. More than 6 s/mi faster = too easy:
   next workouts of that pace 5 s/mi faster and the next workout gets an extra rep. More than 6 s/mi
   slower = too hard: 5 s/mi slower. Max ±15 s/mi per pace. Easy and long runs: averaging over 20 s/mi
   faster than the easy range = too hard; two in a row adds a note to the next easy runs. An on-target
   long run makes the next long run's last mile steady. */
const PACE_KEYS = ["I", "T", "R", "M", "H", "G"];
function workPace(a, P){
  if (a.work_pace > 0) return {pace: a.work_pace, n: 1};
  let laps = a.laps; if (typeof laps === "string"){ try { laps = JSON.parse(laps); } catch(e){ laps = null; } }
  if (!Array.isArray(laps) || !laps.length) return null;
  const ls = laps.map(l => ({d: l[0] / 1609.34, t: l[1], hr: l[2]})).filter(l => l.d > .05 && l.t > 20);
  const w = ls.filter(l => l.t / l.d < P.E[0] - 25);
  if (!w.length) return null;
  const d = w.reduce((s, l) => s + l.d, 0), t = w.reduce((s, l) => s + l.t, 0), hr = w.filter(l => l.hr).reduce((s, l, _, arr) => s + l.hr / arr.length, 0);
  return {pace: t / d, n: w.length, hr: Math.round(hr) || null};
}
function paceRange(P, k){ return k === "E" || k === "L" ? fmtPace(P[k][0]) + "–" + fmtPace(P[k][1]) : fmtPace(P[k] - 5) + "–" + fmtPace(P[k] + 5); }
function assess(plan, s, a, offs){
  const P = plan.P, pace = a.mi > 0 && a.minutes > 0 ? a.minutes * 60 / a.mi : null;
  if (s.type === "easy" || s.type === "long"){
    if (!pace) return {verdict: "unknown", why: "No distance and time to check against."};
    if (pace < P.E[0] - 20) return {verdict: "hard", pace, why: "Averaged " + fmtPace(pace) + "/mi, faster than your easy range (" + paceRange(P, "E") + "/mi)."};
    return {verdict: "ok", pace, why: "Averaged " + fmtPace(pace) + "/mi, right where " + (s.type === "long" ? "a long run" : "an easy run") + " should be."};
  }
  if (s.type === "workout"){
    if (s.base || !PACE_KEYS.includes(s.k)) return {verdict: "ok", pace, why: "Done. Base-phase sessions are about form, not exact paces."};
    const target = P[s.k] + ((offs || {})[s.k] || 0), w = workPace(a, P);
    if (!w) return {verdict: "unknown", pace, target, why: "Couldn't find the reps. Laps from your watch, or a work pace when you log it, let the plan check them."};
    const diff = w.pace - target;
    if (diff > 6) return {verdict: "hard", pace, work: w.pace, target, why: "Reps averaged " + fmtPace(w.pace) + "/mi, " + Math.round(diff) + " s/mi slower than the " + fmtPace(target) + " target."};
    if (diff < -6) return {verdict: "easy", pace, work: w.pace, target, why: "Reps averaged " + fmtPace(w.pace) + "/mi, " + Math.round(-diff) + " s/mi faster than the " + fmtPace(target) + " target."};
    return {verdict: "ok", pace, work: w.pace, target, why: "Reps averaged " + fmtPace(w.pace) + "/mi, right on the " + fmtPace(target) + " target."};
  }
  if (s.type === "race") return {verdict: "ok", pace, why: pace ? "Race done at " + fmtPace(pace) + "/mi average." : "Race done."};
  return {verdict: "ok", why: "Done."};
}
function feedback(plan, acts, today){
  const offs = {}, out = {assess: {}, offs, notes: {}, extra: {}};
  let pendingExtra = false, easyHot = 0, longOk = false;
  const all = [];
  plan.weeks.forEach(w => w.days.forEach(d => d.sessions.forEach((s, i) => all.push({date: d.date, i, s}))));
  const matchCache = {};
  const matchOf = date => matchCache[date] || (matchCache[date] = dayMatches(plan, acts, date));
  for (const x of all){
    if (x.date > today) break;
    const a = matchOf(x.date)[x.i]; if (!a) continue;
    const as = assess(plan, x.s, a, offs), key = x.date + "-" + x.i; as.offsBefore = {...offs}; out.assess[key] = as;
    if (x.s.type === "workout" && !x.s.base && PACE_KEYS.includes(x.s.k) && x.s.k !== "G"){
      if (as.verdict === "easy"){ offs[x.s.k] = Math.max(-15, (offs[x.s.k] || 0) - 5); pendingExtra = true; }
      else if (as.verdict === "hard"){ offs[x.s.k] = Math.min(15, (offs[x.s.k] || 0) + 5); pendingExtra = false; }
      else if (as.verdict === "ok") pendingExtra = false;
    }
    if (x.s.type === "easy" || x.s.type === "long"){ easyHot = as.verdict === "hard" ? easyHot + 1 : as.verdict === "ok" ? 0 : easyHot; }
    if (x.s.type === "long") longOk = as.verdict === "ok";
  }
  const upcoming = all.filter(x => x.date >= today && !matchOf(x.date)[x.i]);
  if (pendingExtra){ const nx = upcoming.find(x => x.s.type === "workout" && !x.s.base); if (nx){ out.extra[nx.date + "-" + nx.i] = true; out.notes[nx.date + "-" + nx.i] = "Extra rep today: your last workout came in faster than target."; } }
  if (easyHot >= 2) upcoming.filter(x => x.s.type === "easy" && daysBetween(today, x.date) <= 7).forEach(x => { out.notes[x.date + "-" + x.i] = "Your last two easy runs were too fast. Hold it to " + paceRange(plan.P, "E") + "/mi."; });
  if (longOk && plan.profile.goal !== "5k"){ const nl = upcoming.find(x => x.s.type === "long"); if (nl && !/at (marathon|half) pace/.test(JSON.stringify(nl.s.steps))) out.notes[nl.date + "-" + nl.i] = "Last long run was on target: make the final mile steady, around " + fmtPace(plan.P.M) + "/mi."; }
  return out;
}
function withExtraRep(steps){
  let done = false;
  return steps.map(st => { if (done) return st; const m = /^(\d+) × /.exec(st[0]); if (!m) return st; done = true; return [st[0].replace(/^\d+/, String(+m[1] + 1))].concat(st.slice(1)); });
}

/* ---------- calories ----------
   Base from the 7-day average weight (about 13 cal/lb covers an active day before training).
   Cutting (7-day average above the goal weight): deficit starts at 400. After each full week:
   lost more than 1.75 lb -> deficit −150; lost under 0.4 lb -> +150; kept 250–750. Every 8th week is
   a diet break at maintenance. Workout, long-run and race days are at most 250 under.
   Logged training adds its calories (75% of them while cutting). */
function deficitFor(plan, weights, date){
  const p = plan.profile, goal = p.goalWeight, W = avgW(weights, date) || p.weight;
  if (!goal || !W) return {d: 0, why: ""};
  if (W <= goal + .3) return {d: 0, why: "You've reached your goal weight, so targets are at maintenance."};
  const wi = Math.max(0, weekIdx(plan, date));
  if (wi > 0 && (wi + 1) % 8 === 0) return {d: 0, brk: true, why: "Diet break week: maintenance calories to recharge. The deficit returns next week."};
  let d = 400, last = "";
  for (let k = 1; k <= wi; k++){
    if (k % 8 === 0) continue;     // the week after a diet break isn't judged (water comes back)
    const a = avgW(weights, addDays(plan.start, 7 * k - 1)), b = avgW(weights, addDays(plan.start, 7 * (k - 1) - 1));
    if (!a || !b) continue;
    const loss = b - a;
    if (loss > 1.75){ d -= 150; last = "You lost " + loss.toFixed(1) + " lb last week, faster than muscle-safe, so the deficit is smaller."; }
    else if (loss < .4){ d += 150; last = "Weight held steady last week, so the deficit is a little bigger."; }
    else last = "Losing at a muscle-safe pace. Same deficit.";
    d = Math.max(250, Math.min(750, d));
  }
  return {d, why: last};
}
function burnOf(a, W){
  const restPerMin = W * 11 / 1440;
  if (a.cal > 0) return Math.max(0, a.cal - (a.minutes || 0) * restPerMin);
  if (a.type === "run") return (a.mi || 0) * W * .72 || (a.minutes || 0) * 10;
  return (a.minutes || 0) * ({bike: 8, swim: 9, lift: 5, other: 5})[a.type];
}
function plannedBurn(day, W){ return day ? day.sessions.reduce((t, s) => t + (s.type === "lift" ? 50 * 5 : (s.mi || 0) * W * .72), 0) : 0; }
function fuel(plan, weights, acts, date){
  const p = plan.profile, W = avgW(weights, date) || p.weight || 170, day = dayOf(plan, date);
  const df = deficitFor(plan, weights, date), hard = day && day.sessions.some(s => s.type === "long" || s.type === "workout" || s.type === "race");
  const def = hard ? Math.min(df.d, 250) : df.d, cutting = df.d > 0;
  const base = Math.max(W * 10.5, W * 13 - def);
  const dayActs = acts.filter(a => a.date === date);
  const train = dayActs.reduce((t, a) => t + burnOf(a, W), 0) * (cutting ? .75 : 1);
  const cal = Math.round((base + train) / 10) * 10;
  const pro = r5(W * .9), fat = r5(Math.max(55, W * .3)), carb = r5(Math.max(100, (cal - pro * 4 - fat * 9) / 4));
  return {cal, pro, carb, fat, cut: cutting, deficit: def, brk: !!df.brk, why: df.why, base: Math.round(base / 10) * 10, train: Math.round(train / 10) * 10,
    planned: Math.round(plannedBurn(day, W) * (cutting ? .75 : 1) / 10) * 10, logged: dayActs.length > 0};
}

/* ---------- heat (same table as Strong at 180): temp + dew point -> slowdown ---------- */
const HEAT = [[100, 0], [110, .005], [120, .01], [130, .02], [140, .03], [150, .045], [160, .06], [170, .08], [180, .10]];
function heatPct(tf, df){
  if (tf == null || df == null) return 0; const x = tf + df;
  if (x <= HEAT[0][0]) return 0;
  for (let i = 1; i < HEAT.length; i++){ const [a, pa] = HEAT[i - 1], [b, pb] = HEAT[i]; if (x <= b) return pa + (pb - pa) * (x - a) / (b - a); }
  return HEAT[HEAT.length - 1][1];
}
/* best 3-hour window to run, 5 am–8 pm, today or tomorrow (cooler, drier, less rain wins) */
function bestWindow(hours, fromKey, lastDay){
  const H = hours.filter(x => x && x.t >= fromKey && x.t.slice(0, 10) <= lastDay && x.temp_f != null).sort((a, b) => a.t.localeCompare(b.t));
  let best = null;
  for (let i = 0; i + 2 < H.length; i++){
    const w = H.slice(i, i + 3), h0 = +w[0].t.slice(11, 13);
    if (h0 < 5 || h0 > 17 || w[2].t.slice(0, 10) !== w[0].t.slice(0, 10) || +w[2].t.slice(11, 13) !== h0 + 2) continue;
    const t = w.map(x => x.feels_f != null ? x.feels_f : x.temp_f), dw = w.map(x => x.dew_f || 0), pr = w.map(x => x.precip_pct || 0);
    const score = t.reduce((a, b) => a + b, 0) / 3 + Math.max(0, Math.max(...dw) - 60) * .6 + Math.max(...pr) * .12 + (w[0].t.slice(0, 10) === fromKey.slice(0, 10) ? 0 : 2);
    if (!best || score < best.score) best = {score, day: w[0].t.slice(0, 10), h0, lo: Math.round(Math.min(...w.map(x => x.temp_f))), hi: Math.round(Math.max(...w.map(x => x.temp_f)))};
  }
  return best;
}

/* ---------- fuel tips around sessions (guidance only) ---------- */
function sessionMinutes(plan, s){ if (s.type === "lift") return 50; const P = plan.P; const avg = s.type === "workout" ? (P.E[0] + (P[s.k] && !Array.isArray(P[s.k]) ? P[s.k] : P.E[0])) / 2 : s.type === "race" ? P.G : (P.E[0] + P.E[1]) / 2; return Math.round((s.mi || 0) * avg / 60); }
function fuelTip(plan, s){
  const m = sessionMinutes(plan, s);
  const before = s.type === "lift" ? "1–2 h before: a normal meal with protein, or a shake and a banana 45 min before."
    : s.type === "easy" && m < 60 ? "Light snack or nothing if it's early. Water is enough during."
    : s.type === "race" ? "Race morning: 2–3 h before, an easy carb breakfast (bagel, banana, honey) with water. Nothing new."
    : "60–90 min before: an easy carb snack, like toast with honey or a banana.";
  let during = "", gels = 0, grams = 0;
  if (s.type !== "lift" && m >= 75){
    grams = Math.round((m - 45) / 60 * 45 / 5) * 5; gels = Math.max(1, Math.ceil(grams / 25));
    const every = Math.max(25, Math.round((m - 40) / gels / 5) * 5);
    during = "During: about " + grams + " g of carbs (" + gels + " gel" + (gels === 1 ? "" : "s") + "). First one around minute 40, then every " + every + " min, with water.";
  }
  const after = s.type === "lift" ? "After: 30–40 g of protein within 2 hours." : m >= 60 || s.type === "workout" || s.type === "race" ? "After: carbs and 30 g of protein within an hour." : "";
  return {before, during, after, gels, grams, minutes: m};
}
/* goal splits for race day: even pace */
function raceSplits(plan){
  const p = plan.profile, r = RACES[p.goal]; if (!r || !r.mi) return null;
  const goal = p.goalSec || plan.pred[p.goal], pace = goal / r.mi;
  const marks = {"5k": [1, 2, 3, r.mi], "10k": [1, 2, 3, 4, 5, 6, r.mi], "half": [1, 3, 5, 8, 10, r.mi], "marathon": [5, 10, 13.1, 15, 20, r.mi]}[p.goal];
  return {goal, pace, rows: marks.map(mi => ({mi: Math.round(mi * 100) / 100, time: mi * pace}))};
}

root.HP = {heatPct, bestWindow, sessionMinutes, fuelTip, raceSplits, pad, isoLocal, parseD, addDays, daysBetween, dow, mondayOf, DAYS, DAYF, MON, fmtD, r5, half, fmtPace, fmtTime, fmtDigits, parseTime, comma, RACES, LONG_CAP, LONG_GOAL, PEAK, TAPER, riegel, fitnessFrom, LIFTS, LIFT_SETS, pace, PNAME, workoutFor, buildPlan, avgW, weekIdx, dayOf, readiness, ADJ, dayMatches, PACE_KEYS, workPace, paceRange, assess, feedback, withExtraRep, deficitFor, burnOf, plannedBurn, fuel};
})(typeof globalThis !== "undefined" ? globalThis : self);
