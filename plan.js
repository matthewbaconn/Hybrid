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
const RACES = { "5k": {name:"5K", mi:3.107}, "10k": {name:"10K", mi:6.214}, "half": {name:"Half marathon", mi:13.109}, "marathon": {name:"Marathon", mi:26.219},
  "50k": {name:"50K trail / ultra", mi:31.07}, "fitness": {name:"General fitness", mi:null},
  // multisport and single-sport goals (built by buildMulti)
  "hyrox": {name:"HYROX", kind:"hyrox", mi:4.97, hours:[4, 8]},
  "tri_sprint": {name:"Sprint triathlon", kind:"tri", swimYd:820, bikeMi:12.4, mi:3.1, hours:[4, 7]},
  "tri_olympic": {name:"Olympic triathlon", kind:"tri", swimYd:1640, bikeMi:24.8, mi:6.2, hours:[5, 9]},
  "tri_half": {name:"Half-distance triathlon (70.3)", short:"70.3", kind:"tri", swimYd:2112, bikeMi:56, mi:13.1, hours:[6, 12]},
  "tri_full": {name:"Full-distance triathlon (140.6)", short:"140.6", kind:"tri", swimYd:4224, bikeMi:112, mi:26.2, hours:[7, 15]},
  "swim": {name:"Swim event", kind:"swim", mi:0, hours:[2.5, 6]},
  "bike": {name:"Cycling event", kind:"bike", mi:0, hours:[3, 10]},
  // everyday fitness: strength + cardio, no race (lose, maintain or gain weight)
  "everyday": {name:"Everyday fitness", kind:"fit", mi:0, hours:[1.5, 6]}
};
const BODY_GOAL = {lose: "lose weight", maintain: "maintain", gain: "gain weight"};
const SWIM_EVENTS = {"1500": ["1500 m / 1 mile swim", 1640], "5000": ["5K swim", 5468], "10000": ["10K swim", 10936]};
const BIKE_EVENTS = {"31": ["50K ride (31 mi)", 31], "62": ["Metric century (62 mi)", 62], "100": ["Century ride (100 mi)", 100]};
function raceName(p){
  const R = RACES[p.goal] || RACES.fitness;
  if (p.raceName) return p.raceName;
  if (p.goal === "swim") return (SWIM_EVENTS[p.swimEvent || "1500"] || SWIM_EVENTS["1500"])[0];
  if (p.goal === "bike") return (BIKE_EVENTS[p.bikeEvent || "62"] || BIKE_EVENTS["62"])[0];
  if (p.goal === "everyday") return "Get fitter" + (BODY_GOAL[p.bodyGoal] && p.bodyGoal !== "maintain" ? " · " + BODY_GOAL[p.bodyGoal] : "");
  return R.name;
}
const isMulti = goal => !!(RACES[goal] && RACES[goal].kind);
const LONG_CAP = {"5k":9, "10k":11, "half":13, "marathon":20, "50k":22, "fitness":10};
const LONG_GOAL = {"5k":7, "10k":9, "half":12, "marathon":20, "50k":22, "fitness":7};   // longest run reached at peak
const PEAK = {"5k":[1.25,18,40], "10k":[1.3,22,45], "half":[1.35,28,50], "marathon":[1.4,35,55], "50k":[1.45,38,60], "fitness":[1.2,15,35]};
const TAPER = {"5k":[.65], "10k":[.65], "half":[.75,.55], "marathon":[.75,.6,.45], "50k":[.75,.6,.45], "fitness":[.7]};
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
  easyA: {title:"Strength · full body A", steps:["Goblet squat 3 × 10","Dumbbell bench press 3 × 10","Dumbbell row 3 × 10 / arm","Glute bridge 3 × 12","Plank 3 × 30 s"]},
  easyB: {title:"Strength · full body B", steps:["Dumbbell Romanian deadlift 3 × 10","Incline push-ups 3 × 10","Lat pulldown or band row 3 × 12","Reverse lunge 3 × 8 / leg","Dead bug 3 × 8 / side"]},
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
    "50k": [{name:"Hill repeats", reps:6, m:400, k:"I", rest:"jog back down"}, {name:"Tempo", cont:5, k:"T"}, {name:"Marathon-pace run", cont:7, k:"M"}, {name:"Threshold 2s", reps:3, m:3218, k:"T", rest:"2 min jog"}],
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
  if (isMulti(p.goal)) return buildMulti(p, today);
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
      days[raceIdx].sessions.push({type:"race", title:"Race day · " + (p.raceName || r.name), mi: r.mi, k:"G",
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
      const steps = goal === "50k" && ph !== "Taper" && !isLight ? [["Easy on trails or hills if you can, walk the steep climbs", L, "L"], ["Practise eating every 30–40 min (what you'll use on race day)", null, null]]
        : mpFinish ? [["Easy " + half(L - 4) + " mi", L - 4, "L"], ["Last 4 mi at marathon pace", 4, "M"]]
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


/* ============ multisport + single-sport plans (HYROX, triathlon, swim, bike) ============
   Same weekly shape as running plans. Each session has `min` (planned minutes); run sessions keep
   `mi` and a pace key so paces, feedback and heat work as usual. Weekly hours ramp like running miles
   (every 4th week lighter), then taper. Effort is described in plain words. */
const SWIM_PACE = {new: 165, ok: 130, strong: 105};   // seconds per 100 yd including short rests
const TAPER_W = {everyday: [], hyrox: [.6], tri_sprint: [.6], tri_olympic: [.65], tri_half: [.75, .55], tri_full: [.75, .6, .45], swim: [.6], bike: [.65]};
const LONG_RIDE = {tri_sprint: 100, tri_olympic: 150, tri_half: 225, tri_full: 330};   // peak long ride, minutes
const LONG_RUN_CAP = {hyrox: 9, tri_sprint: 6, tri_olympic: 9, tri_half: 13, tri_full: 18};
const hm = m => { m = Math.round(m / 5) * 5; return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min"; };
function buildMulti(p, today){
  const goal = p.goal, R = RACES[goal], kind = R.kind, fit = fitnessFrom(p), P = {...fit.pace};
  P.G = P.T;
  const easyPace = (P.E[0] + P.E[1]) / 2, runMin = mi => Math.round(mi * easyPace / 60);
  let start = p.start || mondayOf(today), N, raceDate = null;
  if (p.raceDate && kind !== "fit"){ raceDate = p.raceDate; N = Math.floor(daysBetween(start, raceDate) / 7) + 1; if (N > 24){ start = addDays(mondayOf(raceDate), -23 * 7); N = 24; } }
  else N = kind === "fit" ? 52 : 12;   // everyday plans run a year in 12-week blocks
  const TW = TAPER_W[goal] || [.65], tw = Math.min(TW.length, Math.max(0, N - 2)), B = Math.max(1, N - tw);
  const swimEv = goal === "swim" ? (p.swimEvent || "1500") : null;
  const fitH = kind === "fit" ? ({new: 1.5, some: 2.5, regular: 4})[p.fitLevel] || 2.5 : null;
  const [hLo, hHi] = swimEv ? ({"1500": [2, 4], "5000": [3, 6], "10000": [4, 8]}[swimEv] || R.hours) : R.hours, h0 = Math.max(hLo * .7, Math.min(hHi, fitH || p.hours || (p.weekly ? p.weekly * easyPace / 3600 + 1 : hLo)));
  let hPeak = Math.min(hHi, Math.max(hLo, h0 * 1.5)); hPeak = Math.max(h0, Math.min(hPeak, h0 * Math.pow(1.1, Math.max(1, B - 1))));
  const days = p.days.slice().sort((a, b) => a - b), longDay = p.longDay;
  const gap = (a, b) => Math.min(Math.abs(a - b), 7 - Math.abs(a - b));
  const swimPace = SWIM_PACE[p.swimLevel || "ok"], yd = min => Math.max(400, Math.round(min * 60 / swimPace * 100 / 50) * 50);
  const swimEventYd = goal === "swim" ? (SWIM_EVENTS[p.swimEvent || "1500"] || SWIM_EVENTS["1500"])[1] : R.swimYd || 0;
  const bikeEventMi = goal === "bike" ? (BIKE_EVENTS[p.bikeEvent || "62"] || BIKE_EVENTS["62"])[1] : R.bikeMi || 0;
  const weeks = []; let prevLong = Math.max(3, p.longest || 3), prevRide = Math.max(45, (p.longRide || 15) * 4);
  const S = (type, title, min, steps, why, extra) => ({type, title, min: Math.max(15, Math.round(min / 5) * 5), mi: 0, steps: steps.map(x => Array.isArray(x) ? x : [x, null, null]), why, ...(extra || {})});
  for (let i = 0; i < N; i++){
    const ws = addDays(start, i * 7);
    let phase, H;
    if (kind === "fit"){
      const ci = i % 12, cyc = Math.floor(i / 12);
      phase = ci < 4 ? "Base" : ci < 9 ? "Build" : "Peak";
      H = Math.min(hHi, (h0 + (hPeak - h0) * ci / 11) * Math.min(1.3, 1 + .1 * cyc));
      if (ci % 4 === 3){ H *= .8; phase += " · lighter"; }
    } else if (i < B){
      phase = i < B * .4 ? "Base" : i < B * .85 ? "Build" : "Peak";
      H = h0 + (hPeak - h0) * (B === 1 ? 1 : i / (B - 1));
      if (i % 4 === 3 && i < B - 1){ H *= .8; phase += " · lighter"; }
    } else { phase = i === N - 1 && raceDate ? "Race week" : "Taper"; H = hPeak * TW[Math.min(TW.length - 1, i - B)]; }
    const ph = phase.split(" ·")[0], light = /lighter/.test(phase) || ph === "Taper" || ph === "Race week", frac = B === 1 ? 1 : Math.min(1, i / Math.max(1, B - 1));
    const wk = Array.from({length: 7}, (_, d) => ({date: addDays(ws, d), sessions: []}));
    const raceIdx = raceDate && raceDate >= ws && raceDate <= addDays(ws, 6) ? dow(raceDate) : null;
    const mins = H * 60, list = [];
    const runEasy = (mi, title, why) => ({type:"easy", title:(title || "Easy run") + " · " + mi + " mi", mi, k:"E", min: runMin(mi), steps:[["Easy, you should be able to talk", mi, "E"]], why: why || "Easy running builds your engine without adding much fatigue."});
    const runQual = () => {
      const t = ph === "Base" ? null : Math.max(2, Math.min(5, Math.round(mins / 60 * .4)));
      if (!t) return {type:"workout", title:"Strides run · 4 mi", mi:4, k:"E", base:true, min: runMin(4), steps:[["Easy 3.5 mi", 3.5, "E"], ["6 × 20 s strides, walk back", null, null]], why:"Short strides keep your legs quick before the harder weeks."};
      const mi = half(2.5 + t);
      return {type:"workout", title:(ph === "Peak" ? "Race-effort run" : "Tempo run") + " · " + mi + " mi", mi, k:"T", min: Math.round((2.5 * easyPace + t * P.T) / 60),
        steps:[["Warm up 1.5 mi easy", 1.5, "E"], [t + " mi at threshold (comfortably hard)", t, "T"], ["Cool down 1 mi easy", 1, "E"]], why:"Threshold running raises the pace you can hold for a long time."};
    };
    const longRunMi = cap => { let L = Math.min(cap, prevLong + 1.5, Math.max(3, Math.round(prevLong + (cap - prevLong) * frac * .25 + 1))); if (light) L = Math.max(3, Math.round(L * (ph === "Taper" || ph === "Race week" ? .6 : .8))); L = half(L); if (!light) prevLong = Math.max(prevLong, L); return L; };
    if (raceIdx != null){
      const legs = kind === "tri" ? ["Swim " + (R.swimYd >= 1760 ? half(R.swimYd / 1760) + " mi" : Math.round(R.swimYd / 1.0936) + " m") + ": start easy, find feet to follow, breathe every 2–3 strokes", "Bike " + R.bikeMi + " mi: steady, never hard on the hills. Eat and drink on the bike.", "Run " + R.mi + " mi: first mile easy, then settle into your rhythm"]
        : kind === "hyrox" ? ["8 × 1 km runs, each followed by a station: SkiErg, sled push, sled pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls", "Run the first 1 km slower than you want to. Steady beats fast-then-fading."]
        : kind === "swim" ? ["Warm up 10 min easy in the water if you can", raceName(p) + ": start easy, sight every 6–8 strokes in open water"]
        : ["Ride " + bikeEventMi + " mi: easy first hour, steady after", "Eat 60–90 g of carbs an hour and drink to thirst"];
      const estMin = kind === "tri" ? (R.swimYd / 100 * swimPace + R.bikeMi / 16 * 3600 + R.mi * (P.M + 30)) / 60 : kind === "hyrox" ? 90 : kind === "swim" ? swimEventYd / 100 * swimPace / 60 : bikeEventMi / 15 * 60;
      list.push({s: {type:"race", title:"Race day · " + raceName(p), mi: kind === "tri" || kind === "hyrox" ? R.mi : 0, min: Math.round(estMin), multi: true, steps: legs.map(x => [x, null, null]), why:"Everything in the plan builds to this. Trust the taper."}, fixed: raceIdx});
      [[2, kind === "swim" ? S("swim", "Pre-race swim · 20 min", 20, ["Easy 20 min with a few 25 yd pickups"], "Stay loose.") : kind === "bike" ? S("bike", "Pre-race spin · 30 min", 30, ["Easy spin with 3 × 1 min at race effort"], "Stay loose.") : runEasy(3, "Shakeout")],
       [4, kind === "tri" ? S("swim", "Easy swim · 25 min", 25, ["Easy 25 min, a few race-pace 50s"], "Keeps the feel for the water.") : kind === "hyrox" ? S("hyrox", "Light station practice · 30 min", 30, ["2 rounds: 500 m run + 10 wall balls + 20 m sandbag lunges, all easy"], "Rehearse transitions without fatigue.") : null]]
        .forEach(([back, ss]) => { if (ss && raceIdx - back >= 0) list.push({s: ss, fixed: raceIdx - back}); });
    } else if (kind === "tri"){
      const swimB = mins * (goal === "tri_full" ? .15 : .2), bikeB = mins * (goal === "tri_full" ? .5 : .45), runB = mins - swimB - bikeB;
      const longRide = Math.min(LONG_RIDE[goal] * (light ? .7 : 1), Math.max(45, bikeB * .58), prevRide + 30); if (!light) prevRide = Math.max(prevRide, longRide);
      const peakish = ph === "Peak" || ph === "Build";
      list.push({s: S("bike", "Long ride · " + hm(longRide), longRide, ["Steady, conversational effort (zone 2)", peakish && longRide >= 90 ? "Middle " + Math.round(longRide * .3) + " min at race effort" : "Keep the cadence smooth, around 85–90 rpm", longRide >= 75 ? "Eat 40–60 g of carbs an hour and drink every 15 min" : "Bring a bottle"], "The long ride builds the endurance the whole race sits on.", {long: true, bmi: Math.round(longRide / 60 * 15)}), long: true});
      if (peakish && i % 2 === 0) list.push({s: runEasy(half(Math.max(1.5, Math.min(4, runB * .15 * 60 / easyPace))), "Brick run", "Running straight off the bike teaches your legs the switch. Start right after the ride."), with: "long"});
      list.push({s: S("bike", ph === "Base" ? "Endurance ride with spin-ups · " + hm(Math.max(40, bikeB * .3)) : "Bike intervals · " + hm(Math.max(45, bikeB * .3)), Math.max(40, bikeB * .3),
        ph === "Base" ? ["Easy riding", "6 × 30 s fast cadence, 2 min easy between"] : ph === "Peak" ? ["Warm up 15 min", "3 × 12 min at race effort, 4 min easy between", "Cool down 10 min"] : ["Warm up 15 min", "4 × 8 min hard (effort 7–8 of 10), 4 min easy between", "Cool down 10 min"],
        "Harder efforts on the bike raise the power you can hold for hours."), hard: ph !== "Base"});
      const nSwim = days.length >= 6 || goal === "tri_full" || goal === "tri_half" ? 3 : 2;
      for (let k = 0; k < nSwim; k++){
        const m = swimB / nSwim * (k === 0 && swimEventYd >= 1600 ? 1.25 : k === 0 ? 1.1 : .9), y = k === 0 && peakish ? Math.max(yd(m), Math.round(swimEventYd * (ph === "Peak" ? 1 : .75) / 50) * 50 + 500) : yd(m);
        const set = k === 0 && peakish ? ["Warm up 300 easy", "Continuous " + Math.max(500, Math.round(Math.min(swimEventYd * (ph === "Peak" ? 1 : .8), y - 500) / 50) * 50) + " yd at steady race effort, sight every 8 strokes", "Cool down 200"]
          : ph === "Base" ? ["Warm up 200 easy", "8 × 50 drill/swim by 25, 15 s rest", Math.max(4, Math.round((y - 600) / 100)) + " × 100 steady, 20 s rest", "Cool down 200"]
          : ["Warm up 300 easy", Math.max(4, Math.round((y - 700) / 100)) + " × 100 strong (effort 7 of 10), 15 s rest", "200 easy pull", "Cool down 200"];
        list.push({s: S("swim", (k === 0 && peakish ? "Long swim" : ph === "Base" ? "Technique swim" : "Swim set") + " · " + y + " yd", y / 100 * swimPace / 60, set, k === 0 && peakish ? "Practising race distance takes the fear out of race morning." : "Frequent short swims build feel for the water faster than rare long ones.", {yd: y})});
      }
      const lr = longRunMi(LONG_RUN_CAP[goal]);
      list.push({s: {type:"long", title:"Long run · " + lr + " mi", mi: lr, k:"L", min: runMin(lr), steps:[["Easy, conversational the whole way", lr, "L"]], why:"Run durability for the last leg, when everything is tired."}, long2: true});
      list.push({s: runQual(), hard: ph !== "Base"});
      const usedRun = list.filter(x => x.s.mi).reduce((t, x) => t + x.s.min, 0);
      if (runB - usedRun > 25 && days.length >= 5) list.push({s: runEasy(half(Math.max(3, Math.min(6, (runB - usedRun) * 60 / easyPace))))});
    } else if (kind === "hyrox"){
      const rounds = ph === "Base" ? 4 : ph === "Peak" ? 8 : 6;
      list.push({s: S("hyrox", "HYROX intervals · " + rounds + " rounds", ph === "Base" ? 45 : ph === "Peak" ? 75 : 60,
        [rounds + " rounds: 1 km run at race effort, then one station", "Rotate stations: SkiErg 500 m · sled push 2 × 25 m · sled pull 2 × 25 m · 15 burpee broad jumps · row 500 m · farmers carry 100 m · sandbag lunges 50 m · 30 wall balls", "No sled? Push a weighted prowler, or do 20 hard kettlebell swings instead"],
        "Running on tired legs after a station is the skill HYROX tests. This is the most race-specific session."), hard: true});
      list.push({s: {type:"workout", title:(ph === "Base" ? "6 × 800 m" : "8 × 1 km") + " at race effort", mi: half(ph === "Base" ? 5 : 7.5), k:"T", min: ph === "Base" ? 45 : 60,
        steps:[["Warm up 1.5 mi easy", 1.5, "E"], [ph === "Base" ? "6 × 800 m at threshold, 90 s rest" : "8 × 1 km at threshold, 60 s rest", ph === "Base" ? 3 : 5, "T"], ["Cool down 1 mi easy", 1, "E"]], why:"Eight 1 km runs make up half the race. Rehearse the rhythm."}, hard: true});
      const lr = longRunMi(LONG_RUN_CAP.hyrox);
      list.push({s: {type:"long", title:"Long run · " + lr + " mi", mi: lr, k:"L", min: runMin(lr), steps:[["Easy, conversational the whole way", lr, "L"]], why:"Aerobic base lets you recover between stations."}, long: true});
      list.push({s: S("lift", "HYROX strength" + (light ? " · light" : ""), 55, ["Front squat " + (light ? "3" : "4") + " × 6", "Deadlift " + (light ? "3" : "4") + " × 5", "Walking lunges with a sandbag 3 × 20 m", "Push press 3 × 8", "Wall balls 3 × 20"], "Strong legs and grip make the sleds and lunges feel smaller.")});
      if (days.length >= 5) list.push({s: runEasy(half(Math.max(3, Math.min(5, mins / 60 * .6))))});
      if (days.length >= 6 && !light) list.push({s: S("hyrox", "Station skills · 40 min", 40, ["3 rounds, moderate: SkiErg 250 m · 10 burpee broad jumps · row 250 m · 20 wall balls · farmers carry 50 m", "Focus on smooth technique, not speed"], "Practice makes each station cheaper on race day.")});
    } else if (kind === "swim"){
      const n = Math.min(4, Math.max(3, days.length - 1)), each = mins * .85 / n;
      for (let k = 0; k < n; k++){
        const cap = Math.max(1500, swimEventYd * (k === 0 ? 1.3 : .9)), m = each * (k === 0 ? 1.3 : 1), y = Math.min(yd(m), Math.round(cap / 50) * 50), longSet = k === 0 && ph !== "Base", thr = k === 1 && ph !== "Base";
        const set = longSet ? ["Warm up 300 easy", "Continuous " + Math.max(800, Math.round(Math.min(swimEventYd * (ph === "Peak" ? .9 : .6), y - 500) / 50) * 50) + " yd steady, practise sighting", "Cool down 200"]
          : thr ? ["Warm up 400", Math.max(5, Math.round((y - 800) / 100)) + " × 100 at threshold (fast but repeatable), 10–15 s rest", "Cool down 300"]
          : ["Warm up 300", "8 × 50 drill/swim by 25", Math.max(3, Math.round((y - 900) / 200)) + " × 200 steady, 20 s rest", "Cool down 200"];
        list.push({s: S("swim", (longSet ? "Long swim" : thr ? "Threshold swim" : "Technique swim") + " · " + y + " yd", y / 100 * swimPace / 60, set, longSet ? "Builds the endurance to swim the whole distance steady." : "Short repeats with rest build speed and good form.", {yd: y}), long: k === 0, hard: thr});
      }
      list.push({s: S("lift", "Dryland strength · 35 min", 35, ["Pull-ups or lat pulldown 3 × 8", "Push-ups 3 × 12", "Band pull-aparts 3 × 15", "Goblet squat 3 × 10", "Dead bug 3 × 10 / side"], "Strong lats and core hold your stroke together when tired.")});
    } else if (kind === "fit"){
      const lvl = p.fitLevel || "some", cardio = p.cardio || "walk", bg = p.bodyGoal || "maintain", newbie = lvl === "new" || p.liftExp === "New";
      const nL = Math.max(1, Math.min(days.length - 1, 4, Math.max(p.lifts === 0 ? 1 : 2, p.lifts || 0) + (bg === "gain" && days.length >= 5 ? 1 : 0)));
      const LK = newbie ? ["easyA", "easyB", "easyA", "easyB"] : nL >= 4 ? ["upper", "lower", "upper", "lower"] : nL === 3 ? ["full", "upper", "lower"] : ["full", "lower"];
      const liftMin = newbie ? 40 : 50;
      for (let k = 0; k < nL; k++){ const L = LIFTS[LK[k]]; list.push({s: S("lift", L.title + (light ? " · light" : ""), liftMin, light ? L.steps.map(x => x.replace(/^(.*?)(\d) ×/, (m, a, n) => a + Math.max(2, n - 1) + " ×")) : L.steps,
        bg === "gain" ? "Lifting is what turns extra food into muscle instead of fat. Add a little weight or a rep each week." : bg === "lose" ? "Lifting keeps your muscle while you lose fat, so the weight that comes off is the right kind." : "Strength keeps you capable, protects your joints and raises the calories you burn at rest."), hard: !newbie && k === 0}); }
      const nC = Math.max(1, days.length - nL) + (bg === "lose" && (days.length >= 5 || days.length - nL < 2) && !light ? 1 : 0), cMins = Math.max(nC * 20, mins - nL * liftMin);
      const mods = cardio === "mix" ? ["walk", "bike", "run"] : [cardio];
      const circuit = bg !== "gain" && nC >= 2 && ph !== "Base" && !light;
      for (let k = 0; k < nC; k++){
        const isLong = k === 0, mode = mods[k % mods.length];
        if (circuit && k === nC - 1){
          list.push({s: S("cardio", "Circuit · 25 min", 25, ["Warm up: 5 min brisk walk or easy cardio", (ph === "Peak" ? "5" : "4") + " rounds, 40 s on and 20 s off: bodyweight squats · push-ups (on your knees is fine) · mountain climbers · reverse lunges · plank", "Cool down: 5 min easy walk"], "Short circuits build fitness fast and need no equipment."), hard: true});
          continue;
        }
        let m = Math.round(cMins / nC * (isLong && nC > 1 ? 1.35 : nC > 1 ? .85 : 1));
        m = Math.max(20, Math.min(isLong ? 120 : 60, m));
        let ss;
        if (mode === "walk") ss = S("walk", (isLong ? "Long walk" : "Brisk walk") + " · " + hm(m), m, [isLong ? "Comfortable pace. Bring a friend, a podcast or a hilly route." : "Walk briskly: talking takes a little effort", m >= 40 && !isLong ? "Add hills or stairs for a few minutes if you have them" : "Easy last 5 minutes"], "Walking burns calories and builds your heart without beating up your joints.", isLong ? {long: true} : {});
        else if (mode === "bike") ss = S("bike", (isLong ? "Long ride" : "Easy ride") + " · " + hm(m), m, ["Easy to steady: you can talk in sentences", isLong ? "Outdoors or an indoor bike both count" : "Last 10 minutes a little stronger if you feel good"], "Cycling builds fitness with very little stress on your knees.", isLong ? {long: true} : {});
        else if (lvl === "regular"){ const mi = half(Math.max(2, Math.min(isLong ? 8 : 5, m * 60 / easyPace))); ss = {...runEasy(mi, isLong ? "Long easy run" : "Easy run", "Easy running builds your engine. Keep it conversational."), ...(isLong ? {long: true} : {})}; }
        else { const wk_ = Math.min(8, 1 + Math.floor(i / 2)), run = Math.min(5, Math.max(1, Math.round(wk_ * .6))), walk = Math.max(1, 3 - Math.floor(wk_ / 3)), rounds = Math.max(4, Math.round((m - 10) / (run + walk)));
          ss = {type: "easy", title: "Walk-run · " + hm(m), mi: 0, k: "E", min: m, steps: [["Warm up: 5 min brisk walk", null, null], [rounds + " × (run " + run + " min easy, walk " + walk + " min)", null, null], ["Cool down: 5 min walk", null, null]], why: "Short runs with walking breaks build up your running safely. The runs get longer every couple of weeks.", ...(isLong ? {long: true} : {})}; }
        list.push({s: ss, ...(isLong && nC > 1 ? {long: true} : {})});
      }
    } else {
      const peakRide = Math.min(330, bikeEventMi * .8 / 15 * 60), longRide = Math.max(45, Math.min(peakRide * (light ? .7 : 1), prevRide + 30, Math.max(60, mins * .4))); if (!light) prevRide = Math.max(prevRide, longRide);
      list.push({s: S("bike", "Long ride · " + hm(longRide), longRide, ["Steady, conversational (zone 2)", longRide >= 120 && ph !== "Base" ? "Last hour a little stronger, still controlled" : "Smooth cadence, 85–90 rpm", longRide >= 75 ? "Eat 40–60 g of carbs an hour, drink every 15 min" : "Bring a bottle"], "Time in the saddle is what gets you through a long event.", {long: true, bmi: Math.round(longRide / 60 * 15)}), long: true});
      list.push({s: S("bike", ph === "Base" ? "Cadence ride · 50 min" : "Bike intervals · 1 h", ph === "Base" ? 50 : 60, ph === "Base" ? ["Easy riding", "8 × 1 min high cadence (100+ rpm), 2 min easy"] : ["Warm up 15 min", (ph === "Peak" ? "3 × 12" : "5 × 6") + " min hard (effort 7–8 of 10), equal easy between", "Cool down 10 min"], "Harder efforts raise the power you can hold."), hard: ph !== "Base"});
      const tempo = Math.max(45, mins * .2);
      list.push({s: S("bike", "Tempo ride · " + hm(tempo), tempo, ["Warm up 10 min", Math.round(Math.max(20, tempo - 20)) + " min at a steady, focused effort (6 of 10)", "Cool down 10 min"], "Tempo is what most of a long ride feels like late on.")});
      if (days.length >= 5) list.push({s: S("bike", "Recovery spin · 40 min", 40, ["Very easy, light gears"], "Easy spinning helps you recover.")});
      list.push({s: S("lift", "Strength for cyclists · 40 min", 40, ["Back squat 3 × 6", "Single-leg RDL 3 × 8 / leg", "Step-ups 3 × 8 / leg", "Plank 3 × 45 s", "Side plank 3 × 30 s / side"], "Strength keeps knees and back happy on long rides.")});
    }
    // extra lifting days the person asked for (multisport: at most 2, HYROX 3)
    const wantL = Math.min(kind === "hyrox" ? 3 : 2, p.lifts || 0), haveL = list.filter(x => x.s.type === "lift").length, LK = ["full", "upper", "lower"];
    for (let k = haveL; k < wantL && raceIdx == null && kind !== "fit"; k++){ const L = LIFTS[LK[k % 3]]; list.push({s: S("lift", L.title + (light ? " · light" : ""), 45, L.steps, "Strength keeps you durable while endurance volume climbs.")}); }
    // place: race week fixed → long on long day (+ brick) → second long next to it → hard days spread out → the rest on the emptiest days (max 2 a day)
    const put = (d, s) => wk[d].sessions.push(s), free = days.filter(d => d !== raceIdx);
    list.filter(x => x.fixed != null).forEach(x => put(x.fixed, x.s));
    if (raceIdx == null){
      const L1 = list.find(x => x.long), L2 = list.find(x => x.long2), brick = list.find(x => x.with === "long");
      if (L1){ put(longDay, L1.s); if (brick) put(longDay, brick.s); }
      if (L2){ const d2 = free.find(d => d !== longDay && gap(d, longDay) === 1) ?? free.filter(d => d !== longDay).sort((a, b) => gap(b, longDay) - gap(a, longDay))[0]; put(d2 != null ? d2 : longDay, L2.s); }
      const hardDays = [longDay];
      list.filter(x => x.hard && !x.long && !x.long2).forEach(x => {
        const d = free.filter(d => d !== longDay && wk[d].sessions.length < 2).sort((a, b) => (Math.min(...hardDays.map(h => gap(b, h))) - Math.min(...hardDays.map(h => gap(a, h)))) || (wk[a].sessions.length - wk[b].sessions.length))[0];
        if (d != null){ put(d, x.s); hardDays.push(d); }
      });
      list.filter(x => !x.hard && !x.long && !x.long2 && x.with !== "long").forEach(x => {
        const d = free.filter(d => wk[d].sessions.length < 2 && !(x.s.type === "lift" && d === longDay) && !wk[d].sessions.some(s => s.type === x.s.type))
          .sort((a, b) => (wk[a].sessions.length - wk[b].sessions.length) || (gap(b, longDay) - gap(a, longDay)))[0];
        if (d != null) put(d, x.s);
      });
    }
    const totMin = wk.reduce((a, d) => a + d.sessions.reduce((b, s) => b + (s.min || 0), 0), 0);
    weeks.push({n: i + 1, start: ws, phase: kind === "fit" ? phase.replace("Base", "Foundation").replace("Peak", "Push") : phase, miles: half(wk.reduce((a, d) => a + d.sessions.reduce((b, s) => b + (s.mi || 0), 0), 0)), hours: Math.round(totMin / 6) / 10, days: wk});
  }
  return {profile: p, P, pred: fit.pred, weeks, start, raceDate, created: today, multi: kind};
}

/* ============ shared tracking logic (app + server) ============ */
const avgW = (weights, end) => { const v = []; for (let i = 0; i < 7; i++){ const x = weights[addDays(end, -i)]; if (x) v.push(x); } return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const weekIdx = (plan, date) => Math.floor(daysBetween(plan.start, date) / 7);
function dayOf(plan, date){ const wi = weekIdx(plan, date); const w = plan.weeks[wi]; return w ? w.days[dow(date)] : null; }

/* watch data (sleep, resting HR, HRV) vs the last 14 days: a clearly low HRV or high resting HR
   lowers readiness a little, the way a Garmin or Whoop recovery score would */
function devSignals(dev, date){
  const d = dev && dev[date]; if (!d) return null;
  const prev = Object.keys(dev).filter(k => k < date && k >= addDays(date, -14)).map(k => dev[k]);
  const avg = k => { const v = prev.map(x => x[k]).filter(x => x > 0); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const hrvA = avg("hrv"), rhrA = avg("rhr"), notes = []; let pen = 0;
  if (d.hrv && hrvA){ const pc = (d.hrv - hrvA) / hrvA; if (pc <= -.12){ pen += 8; notes.push("HRV " + Math.round(-pc * 100) + "% below your normal"); } else if (pc >= .08) notes.push("HRV above your normal"); }
  if (d.rhr && rhrA){ const df = d.rhr - rhrA; if (df >= 5){ pen += 6; notes.push("resting HR " + Math.round(df) + " bpm above normal"); } else if (df <= -3) notes.push("resting HR below normal"); }
  if (d.sleep_score != null && d.sleep_score < 60){ pen += 5; notes.push("sleep score " + d.sleep_score); }
  return {sleep_h: d.sleep_h || null, sleep_score: d.sleep_score != null ? d.sleep_score : null, rhr: d.rhr || null, hrv: d.hrv || null, steps: d.steps || null, active_cal: d.active_cal || null, hrvA, rhrA, pen, notes};
}
function readiness(c, sig){
  // no check-in yet: a first read from the watch alone (sleep, sleep score, HRV, resting HR); the check-in refines it
  if (!c){
    if (!sig || !(sig.sleep_h > 0 || sig.sleep_score != null)) return null;
    const sh = sig.sleep_h || null, sc = sig.sleep_score;
    const q = sc != null ? Math.max(0, Math.min(1, (sc - 40) / 50)) : sh ? Math.max(0, Math.min(1, (sh - 5) / 3)) : .5;
    const score = Math.max(0, Math.round((sh ? Math.min(1, sh / 8) : q) * 30 + q * 20 + 20 + 10 + 7) - (sig.pen || 0));
    const level = (sh && sh < 5) || score < 50 ? 2 : score < 70 ? 1 : 0;
    return {score, level, word: ["Ready to train", "Go easier today", "Recovery day"][level], tone: ["long", "work", "race"][level], watch: sig.notes.length ? sig.notes : null, watchOnly: true};
  }
  const score = Math.max(0, (sig && sig.pen ? -sig.pen : 0) + Math.round(Math.min(1, c.sleep_h / 8) * 30 + (c.sleep_q - 1) / 4 * 20 + (5 - c.soreness) / 4 * 20 + (c.energy - 1) / 4 * 20 + (5 - c.stress) / 4 * 10));
  const level = c.sleep_h < 5 || score < 50 ? 2 : score < 70 ? 1 : 0;
  return {score, level, word: ["Ready to train", "Go easier today", "Recovery day"][level], tone: ["long", "work", "race"][level], watch: sig && sig.notes.length ? sig.notes : null};
}
const ADJ = {
  1: {walk: "Easier today: a shorter, relaxed walk is plenty.", cardio: "Easier today: 2–3 rounds at a steady effort, or swap it for a walk.", swim: "Easier today: swim the main set at a steady effort and skip the last third.", bike: "Easier today: keep the whole ride easy and cut 20–30 min.", hyrox: "Easier today: half the rounds, at a steady effort.", workout: "Easier today: do one rep fewer and run the reps at the slow end of the range.", long: "Easier today: cut 2 mi and keep every mile easy.", race: "", easy: "Keep it strictly conversational. Slow is fine.", lift: "Drop one set from each exercise."},
  2: {walk: "Recovery day: a gentle 15–20 min walk, or rest.", cardio: "Recovery day: skip the circuit. An easy walk instead.", swim: "Recovery day: an easy 20 min swim, or rest.", bike: "Recovery day: 30–40 min very easy spin, or rest.", hyrox: "Recovery day: skip the stations. An easy 20–30 min walk or spin instead.", workout: "Recovery day: swap this for 30–40 min very easy, or rest. Move the workout to a later day this week.", long: "Recovery day: make it half the distance, all easy, or move it.", race: "", easy: "Make it 20–30 min very easy, or rest.", lift: "Skip it, or keep it light and short."}
};
function dayMatches(plan, acts, date){
  const day = dayOf(plan, date); if (!day) return {};
  const as = acts.filter(a => a.date === date), pools = {run: as.filter(a => a.type === "run"), lift: as.filter(a => a.type === "lift"), bike: as.filter(a => a.type === "bike"), swim: as.filter(a => a.type === "swim"), other: as.filter(a => a.type === "other" || a.type === "lift")}, used = new Set(), m = {};
  const take = k => { const a = (pools[k] || []).find(x => !used.has(x)); if (a) used.add(a); return a; };
  day.sessions.forEach((s, i) => {
    const k = s.type === "lift" ? "lift" : s.type === "bike" ? "bike" : s.type === "swim" ? "swim" : s.type === "hyrox" || s.type === "walk" || s.type === "cardio" ? "other" : "run";
    const a = take(k) || (s.type === "race" && s.multi ? as.find(x => !used.has(x)) : null);
    if (a){ used.add(a); m[i] = a; }
  });
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
  if (!goal || !W || p.bodyGoal === "gain" || p.bodyGoal === "maintain") return {d: 0, why: ""};
  if (W <= goal + .3) return {d: 0, why: "You've reached your goal weight, so targets are at maintenance."};
  const wi = Math.max(0, weekIdx(plan, date));
  if (wi > 0 && (wi + 1) % 8 === 0) return {d: 0, brk: true, why: "Diet break week: maintenance calories to recharge. The deficit returns next week."};
  let d = 400, last = "";
  for (let k = 1; k <= wi; k++){
    if (k % 8 === 0) continue;     // the week after a diet break isn't judged (water comes back)
    const a = avgW(weights, addDays(plan.start, 7 * k - 1)), b = avgW(weights, addDays(plan.start, 7 * (k - 1) - 1));
    if (!a || !b) continue;
    const loss = b - a;
    if (loss > Math.min(1.75, W * .01)){ d -= 150; last = "You lost " + loss.toFixed(1) + " lb last week, faster than is safe for muscle, so the deficit is smaller."; }
    else if (loss < .4){ d += 150; last = "Weight held steady last week, so the deficit is a little bigger."; }
    else last = "Losing at a muscle-safe pace. Same deficit.";
    d = Math.max(250, Math.min(750, d));
  }
  return {d, why: last};
}
/* gaining: start +300 a day. After each full week: gained more than ~0.75 lb (or 0.5% of body weight) -> −100;
   under 0.15 lb -> +100; kept 150–500. Stops at the goal weight if one is set. */
function surplusFor(plan, weights, date){
  const p = plan.profile, W = avgW(weights, date) || p.weight;
  if (p.bodyGoal !== "gain" || !W) return {s: 0, why: ""};
  if (p.goalWeight && W >= p.goalWeight - .3) return {s: 0, why: "You've reached your goal weight, so targets are at maintenance."};
  const wi = Math.max(0, weekIdx(plan, date)); let s = 300, last = "";
  for (let k = 1; k <= wi; k++){
    const a = avgW(weights, addDays(plan.start, 7 * k - 1)), b = avgW(weights, addDays(plan.start, 7 * (k - 1) - 1));
    if (!a || !b) continue;
    const gain = a - b;
    if (gain > Math.max(.75, W * .005)){ s -= 100; last = "You gained " + gain.toFixed(1) + " lb last week, faster than muscle can grow, so the surplus is smaller."; }
    else if (gain < .15){ s += 100; last = "Weight held steady last week, so the surplus is a little bigger."; }
    else last = "Gaining at a lean pace. Same surplus.";
    s = Math.max(150, Math.min(500, s));
  }
  return {s, why: last};
}
/* resting burn (Mifflin-St Jeor) from height, weight, age and sex; null without height and age */
function bmrOf(p, W){
  if (!(p.heightIn > 0 && p.age > 0 && W > 0)) return null;
  return 10 * W / 2.2046 + 6.25 * p.heightIn * 2.54 - 5 * p.age + (p.sex === "m" ? 5 : p.sex === "f" ? -161 : -78);
}
const DAILY = {sit: [1.2, "mostly sitting"], some: [1.35, "on your feet some of the day"], feet: [1.5, "on your feet most of the day"]};
function burnOf(a, W){
  const restPerMin = W * 11 / 1440;
  if (a.cal > 0) return Math.max(0, a.cal - (a.minutes || 0) * restPerMin);
  if (a.type === "run") return (a.mi || 0) * W * .72 || (a.minutes || 0) * 10;
  return (a.minutes || 0) * ({bike: 8, swim: 9, lift: 5, other: 5})[a.type];
}
function plannedBurn(day, W){ return day ? day.sessions.reduce((t, s) => t + (s.type === "lift" ? (s.min || 50) * 5 : s.type === "bike" ? s.min * 8 : s.type === "swim" ? s.min * 9 : s.type === "hyrox" ? s.min * 10 : s.type === "walk" ? s.min * 4.5 : s.type === "cardio" ? s.min * 9 : s.type === "easy" && !s.mi && s.min ? s.min * 8 : s.type === "race" && s.multi ? s.min * 9 : (s.mi || 0) * W * .72), 0) : 0; }
function fuel(plan, weights, acts, date){
  const p = plan.profile, W = avgW(weights, date) || p.weight || 170, day = dayOf(plan, date);
  const df = deficitFor(plan, weights, date), sf = surplusFor(plan, weights, date), hard = day && day.sessions.some(s => s.type === "long" || s.type === "workout" || s.type === "race" || s.type === "hyrox" || s.long);
  const def = hard ? Math.min(df.d, 250) : df.d, cutting = df.d > 0, sur = sf.s, gaining = sur > 0;
  // maintenance: resting burn x daily activity when height and age are known, otherwise ~13 cal per lb
  const bmr = bmrOf(p, W), maint = bmr ? bmr * (DAILY[p.daily] || DAILY.some)[0] : W * 13;
  // safety floor: never under resting burn (or ~10.5 cal/lb), and a cutting target never under 1,500 (or maintenance, if that's lower)
  const base = Math.max(bmr ? bmr : W * 10.5, maint - def + sur, def > 0 ? Math.min(1500, maint) : 0);
  const dayActs = acts.filter(a => a.date === date);
  const train = dayActs.reduce((t, a) => t + burnOf(a, W), 0) * (cutting ? .75 : 1);
  const cal = Math.round((base + train) / 10) * 10;
  const pro = r5(W * (gaining ? 1 : .9)), fat = r5(Math.max(55, W * .3)), carb = r5(Math.max(100, (cal - pro * 4 - fat * 9) / 4));
  return {cal, pro, carb, fat, cut: cutting, deficit: def, gain: gaining, surplus: sur, brk: !!df.brk, why: gaining || p.bodyGoal === "gain" ? sf.why : df.why, base: Math.round(base / 10) * 10, train: Math.round(train / 10) * 10,
    bmr: bmr ? Math.round(bmr / 10) * 10 : null, maint: Math.round(maint / 10) * 10, daily: bmr ? (DAILY[p.daily] || DAILY.some)[1] : null,
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
function sessionMinutes(plan, s){ if (s.min) return s.min; if (s.type === "lift") return 50; const P = plan.P; const avg = s.type === "workout" ? (P.E[0] + (P[s.k] && !Array.isArray(P[s.k]) ? P[s.k] : P.E[0])) / 2 : s.type === "race" ? P.G : (P.E[0] + P.E[1]) / 2; return Math.round((s.mi || 0) * avg / 60); }
function fuelTip(plan, s){
  const m = sessionMinutes(plan, s);
  if (s.type === "walk") return {before: "No special food needed. Water if it's hot.", during: "", after: "", gels: 0, grams: 0, minutes: m};
  const before = s.type === "swim" ? "Early swim: a banana or toast is plenty. Later in the day: a normal meal 2 h before." : s.type === "lift" || s.type === "hyrox" ? "1–2 h before: a normal meal with protein, or a shake and a banana 45 min before."
    : s.type === "easy" && m < 60 ? "Light snack or nothing if it's early. Water is enough during."
    : s.type === "race" ? "Race morning: 2–3 h before, an easy carb breakfast (bagel, banana, honey) with water. Nothing new."
    : "60–90 min before: an easy carb snack, like toast with honey or a banana.";
  let during = "", gels = 0, grams = 0;
  if (s.type !== "lift" && s.type !== "swim" && m >= 75){
    grams = Math.round((m - 45) / 60 * 45 / 5) * 5; gels = Math.max(1, Math.ceil(grams / 25));
    const every = Math.max(25, Math.round((m - 40) / gels / 5) * 5);
    during = "During: about " + grams + " g of carbs (" + gels + " gel" + (gels === 1 ? "" : "s") + "). First one around minute 40, then every " + every + " min, with water.";
  }
  const after = s.type === "swim" && m >= 45 ? "After: carbs and 30 g of protein within an hour." : s.type === "lift" ? "After: 30–40 g of protein within 2 hours." : m >= 60 || s.type === "workout" || s.type === "race" ? "After: carbs and 30 g of protein within an hour." : "";
  return {before, during, after, gels, grams, minutes: m};
}
/* goal splits for race day: even pace */
function raceSplits(plan){
  const p = plan.profile, r = RACES[p.goal]; if (!r || !r.mi || r.kind) return null;
  const goal = p.goalSec || plan.pred[p.goal], pace = goal / r.mi;
  const marks = {"5k": [1, 2, 3, r.mi], "10k": [1, 2, 3, 4, 5, 6, r.mi], "half": [1, 3, 5, 8, 10, r.mi], "marathon": [5, 10, 13.1, 15, 20, r.mi]}[p.goal];
  return {goal, pace, rows: marks.map(mi => ({mi: Math.round(mi * 100) / 100, time: mi * pace}))};
}

/* ---------- Garmin watch workouts (Training API V2) ----------
   Turns one planned session into a Garmin workout: warm-up/cool-down, rep blocks with recoveries,
   and pace targets (as speed in m/s). Runs, rides, swims and cardio; lifts stay in the app. */
const MI_M = 1609.34;
function garminWorkout(plan, s, offs, extra, date){
  if (!s || s.type === "lift" || s.type === "walk" || (s.type === "race" && s.multi)) return null;
  const P = plan.P, off = offs || {};
  const steps0 = extra ? withExtraRep(s.steps || []) : (s.steps || []);
  let order = 0;
  const speed = sec => Math.round(MI_M / sec * 1000) / 1000;
  const paceTarget = (k, plus) => {
    if (!k || P[k] == null) return {targetType: "OPEN"};
    if (Array.isArray(P[k])) return {targetType: "PACE", targetValueLow: speed(Math.max(P[k][0], P[k][1]) + 15), targetValueHigh: speed(Math.min(P[k][0], P[k][1]))};
    const c = P[k] + (off[k] || 0) + (plus || 0);
    return {targetType: "PACE", targetValueLow: speed(c + 5), targetValueHigh: speed(c - 5)};
  };
  const step = (o) => ({type: "WorkoutStep", stepOrder: ++order, intensity: o.intensity || "ACTIVE", description: String(o.description || "").slice(0, 512),
    durationType: o.durationType || "OPEN", durationValue: o.durationValue == null ? null : o.durationValue, durationValueType: o.durationValueType || null,
    targetType: o.targetType || "OPEN", targetValue: null, targetValueLow: o.targetValueLow == null ? null : o.targetValueLow, targetValueHigh: o.targetValueHigh == null ? null : o.targetValueHigh, targetValueType: null});
  const repeat = (n, inner) => { const r = {type: "WorkoutRepeatStep", stepOrder: ++order, repeatType: "REPEAT_UNTIL_STEPS_CMPLT", repeatValue: n, skipLastRestStep: true, steps: []}; r.steps = inner(); return r; };
  const dur = (txt) => { const m = /(\d+(?:\.\d+)?)\s*(min|s|sec)\b/.exec(txt); return m ? {durationType: "TIME", durationValue: Math.round(+m[1] * (m[2] === "min" ? 60 : 1))} : null; };
  const out = [];
  if (s.mi > 0 && s.type !== "race" || (s.type === "race" && s.mi > 0)){
    steps0.forEach((st, idx) => {
      const [label, mi, k, plus] = st, L = String(label), low = L.toLowerCase();
      const intensity = /^warm/.test(low) ? "WARMUP" : /^cool/.test(low) ? "COOLDOWN" : (k === "E" || k === "L") ? "ACTIVE" : "INTERVAL";
      // "6 × 800 m at interval pace, 400 m jog between" / "3 × 1 mi …" / "8 × 1 min quick / 1 min easy" / "8 × 15 s hill sprints"
      const rm = /^(?:finish with )?(\d+) × (\d+(?:\.\d+)?)\s*(m|mi|min|s)\b/i.exec(L);
      if (rm){
        const n = +rm[1], v = +rm[2], u = rm[3].toLowerCase();
        const work = u === "m" ? {durationType: "DISTANCE", durationValue: v, durationValueType: "METER"} : u === "mi" ? {durationType: "DISTANCE", durationValue: Math.round(v * MI_M), durationValueType: "METER"} : {durationType: "TIME", durationValue: Math.round(v * (u === "min" ? 60 : 1))};
        const restTxt = (/,\s*(.+?) between/.exec(L) || /\/\s*(.+)$/.exec(L) || [])[1] || "";
        const restM = /(\d+)\s*m\b/.exec(restTxt), restT = dur(restTxt);
        const rest = restM ? {durationType: "DISTANCE", durationValue: +restM[1], durationValueType: "METER"} : restT || {durationType: "OPEN"};
        const tgt = /stride|sprint/.test(low) || !k ? {targetType: "OPEN"} : paceTarget(k, plus);
        out.push(repeat(n, () => [step({intensity: "INTERVAL", description: L, ...work, ...tgt}), step({intensity: "RECOVERY", description: restTxt ? restTxt : (/walk/.test(low) ? "Walk back" : "Recover, then press lap"), ...rest})]));
        return;
      }
      if (mi > 0) out.push(step({intensity, description: L, durationType: "DISTANCE", durationValue: Math.round(mi * MI_M), durationValueType: "METER", ...paceTarget(k, plus)}));
      else out.push(step({intensity, description: L, durationType: "OPEN"}));
    });
    return {workoutName: String(s.title).slice(0, 80), description: ("HYBRD · " + (s.why || "")).slice(0, 1024), sport: "RUNNING", workoutProvider: "HYBRD", workoutSourceId: "HYBRD",
      isSessionTransitionEnabled: false, poolLength: null, poolLengthUnit: null, segments: [{segmentOrder: 1, sport: "RUNNING", poolLength: null, poolLengthUnit: null, steps: out}]};
  }
  // time-based sessions (rides, swims, cardio, walk-runs): one step with the plan's instructions
  const sport = s.type === "bike" ? "CYCLING" : s.type === "swim" ? "LAP_SWIMMING" : s.type === "easy" ? "RUNNING" : "CARDIO_TRAINING";
  const text = (s.steps || []).map(x => Array.isArray(x) ? x[0] : x).join(" · ");
  if (!s.min) return null;
  const main = sport === "LAP_SWIMMING"
    ? (s.yd ? step({intensity: "ACTIVE", description: text, durationType: "DISTANCE", durationValue: Math.round(s.yd * 0.9144), durationValueType: "METER", targetType: null})
            : step({intensity: "ACTIVE", description: text, durationType: "TIME", durationValue: Math.min(59, s.min) * 60, targetType: null}))
    : step({intensity: "ACTIVE", description: text, durationType: "TIME", durationValue: s.min * 60});
  return {workoutName: String(s.title).slice(0, 80), description: ("HYBRD · " + (s.why || "")).slice(0, 1024), sport, workoutProvider: "HYBRD", workoutSourceId: "HYBRD",
    isSessionTransitionEnabled: false, poolLength: null, poolLengthUnit: null, segments: [{segmentOrder: 1, sport, poolLength: null, poolLengthUnit: null, steps: [main]}]};
}

root.HP = {garminWorkout, bmrOf, BODY_GOAL, heatPct, bestWindow, sessionMinutes, fuelTip, raceSplits, pad, isoLocal, parseD, addDays, daysBetween, dow, mondayOf, DAYS, DAYF, MON, fmtD, r5, half, fmtPace, fmtTime, fmtDigits, parseTime, comma, RACES, SWIM_EVENTS, BIKE_EVENTS, raceName, isMulti, hm, LONG_CAP, LONG_GOAL, PEAK, TAPER, riegel, fitnessFrom, LIFTS, LIFT_SETS, pace, PNAME, workoutFor, buildPlan, avgW, weekIdx, dayOf, readiness, devSignals, ADJ, dayMatches, PACE_KEYS, workPace, paceRange, assess, feedback, withExtraRep, deficitFor, burnOf, plannedBurn, fuel};
})(typeof globalThis !== "undefined" ? globalThis : self);
