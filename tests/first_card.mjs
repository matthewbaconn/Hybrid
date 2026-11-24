// First workout on a rest day (incident activation-none-trained, Nov 21, 2026: 3 of 14 members with a plan have trained).
// A member who never checked off or synced a workout and opened Today on a rest day saw only "Rest day": nothing said when
// the first workout is or how it counts. Mocks the API in the browser (no live data). Checks:
//   - never trained + rest day today: "Your first workout" card names the next session and the day, with "See it in your plan"
//   - no watch linked: the card offers "Link your watch" (opens Devices and apps); with Strava linked it doesn't
//   - the bottom "Tomorrow" card isn't repeated when the first workout is tomorrow
//   - a member who has trained (a check-off or a synced workout) never sees the card
//   - a day with a session keeps the old first-workout hint, now with "Link your watch"
//   - "See it in your plan" opens the Plan tab on that day
// Run: node tests/first_card.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8099);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
let me = null;
const b = await chromium.launch(), ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
p.on("pageerror", e => { console.log("FAIL page error: " + e.message); bad++; });
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
  const u = new URL(r.request().url());
  if (u.pathname === "/api/me") return r.fulfill({json: me});
  return r.fulfill({json: {}});
});
await ctx.addInitScript(() => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){} });
const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
const dw = d => (new Date(d + "T12:00:00").getDay() + 6) % 7, monday = add(today, -dw(today));
// runs only on the day after tomorrow and the day after that: today and tomorrow are rest days
const restProf = {name: "Casey", goal: "fitness", weekly: 15, longest: 6, prDist: "none", days: [dw(add(today, 2)), dw(add(today, 4))], longDay: dw(add(today, 4)), lifts: 0, liftExp: "Some", weight: 170, start: monday, built: today, pv: 2};
const base = (profile, extra) => ({user: {id: "u1", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile, activities: [], done: [], features: {},
  strava: {available: true, connected: false}, garmin: {available: true, connected: false}, ...extra});
const open = async j => { me = j; await p.goto("http://localhost:8099/"); await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(700); };
try {
  await open(base(restProf));
  const card = await p.$(".fwc");
  t(!!card, "never trained, rest day: the first-workout card shows");
  const txt = card ? await card.innerText() : "";
  const day2 = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][dw(add(today, 2))];
  t(new RegExp(day2).test(txt) && /mi/.test(txt), "it names the next session and its day (" + txt.replace(/\s+/g, " ").slice(0, 80) + ")");
  t(/Link your watch/.test(txt), "no watch linked: it offers Link your watch");
  await p.evaluate(() => document.querySelector(".fwc [data-act=fwsee]").click()); await p.waitForTimeout(900);
  t(await p.$eval("#tabbar [data-tab=plan]", e => e.getAttribute("aria-current") === "page"), "See it in your plan opens the Plan tab");
  t(!!(await p.$("#d-" + add(today, 2))), "and that day is on screen");
  await open(base(restProf));
  await p.evaluate(() => document.querySelector(".fwc [data-scr=set-watch]").click()); await p.waitForTimeout(700);
  t(/Devices and apps/.test(await p.innerText("body")), "Link your watch opens Devices and apps");
  await open(base(restProf, {strava: {available: true, connected: true, name: "Casey", last_sync: new Date().toISOString()}}));
  t(!/Link your watch/.test(await p.$eval(".fwc", e => e.innerText).catch(() => "")), "Strava linked: no Link your watch button");
  // first workout tomorrow: the bottom Tomorrow card is not repeated
  await open(base({...restProf, days: [dw(add(today, 1)), dw(add(today, 4))]}));
  const lbls = await p.$$eval(".card-h .lbl", els => els.map(e => e.textContent));
  t(lbls.includes("Your first workout") && !lbls.includes("Tomorrow"), "first workout tomorrow: shown once, not twice (" + lbls.filter(x => /first|Tomorrow/.test(x)).join(", ") + ")");
  // trained already: no card
  await open(base(restProf, {done: [add(today, -1) + "-0"]}));
  t(!(await p.$(".fwc")), "checked off a workout before: no card");
  await open(base(restProf, {activities: [{id: "a1", source: "strava", date: add(today, -1), type: "run", name: "Morning Run", mi: 3, minutes: 30}]}));
  t(!(await p.$(".fwc")), "synced a workout before: no card");
  // a session day: the hint (growth move 11 copy: "Day 1 is today" on the day the plan is built), with the watch link
  await open(base({...restProf, days: [dw(today), dw(add(today, 3))], longDay: dw(add(today, 3))}));
  t(!(await p.$(".fwc")), "a day with a session: no rest-day card");
  const hint = await p.$eval(".hfirst", e => e.innerText).catch(() => "");
  t(/Your plan is ready\. Day 1: /.test(hint) && /I did it/.test(hint) && /Link your watch/.test(hint), "plan built today, a day with a session: hint opens with Day 1 is today, says tap I did it, keeps Link your watch (" + hint.slice(0, 60) + ")");
  t(/Start with my phone/.test(hint), "run day: hint points to Start with my phone (no watch needed)");
  await open(base({...restProf, built: add(today, -3), days: [dw(today), dw(add(today, 3))], longDay: dw(add(today, 3))}));
  const hint2 = await p.$eval(".hfirst", e => e.innerText).catch(() => "");
  t(/Your first workout is today: /.test(hint2) && !/Day 1/.test(hint2), "plan built 3 days ago, never trained: hint says the first workout is today, not Day 1 (" + hint2.slice(0, 60) + ")");
} catch(e){ console.log("FAIL error: " + e.message); bad++; }
await b.close(); srv.close();
console.log(bad ? bad + " FAILED" : "ALL PASS"); process.exit(bad ? 1 : 0);
