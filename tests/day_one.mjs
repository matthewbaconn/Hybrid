// Day one starts clean (incident activation-none-trained, Nov 19, 2026: 3 of 12 members with a plan have trained).
// A plan's week 1 starts on the Monday of the week it is built, so a runner who joined on a Thursday opened Today to
// "Missed Tuesday" on their first day, for a workout from before they signed up. Mocks the API in the browser. Checks:
//   - a plan built today never shows a "Missed" card for earlier days of the week
//   - an older plan (no build date saved) still shows missed days as before
//   - a plan built 3 days ago flags a missed day after it was built, never one before
//   - building a plan saves the day it was built
// Nov 21: the card says "Missed yesterday" (lower case since #107/#113); the day match is case-insensitive now.
// Run: node tests/day_one.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8096);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const app = fs.readFileSync(path.join(root, "index.html"), "utf8");
t(/const prof = \{\.\.\.setup\.p, start: mondayOf\(TODAY\), built: TODAY,/.test(app), "building a plan saves the day it was built");
t(/built: TODAY, pv: HP\.PLAN_V\}; delete prof\.sample; delete prof\.swaps; if \(plan && plan\.profile\.myWorkouts/.test(app), "a new plan still drops the sample/moved days and keeps your own workouts (code not commented out)");
let profile = null;
const b = await chromium.launch(), ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
  const u = new URL(r.request().url());
  if (u.pathname === "/api/me") return r.fulfill({json: {user: {id: "u1", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile, activities: [], done: [], features: {}, strava: {available: false, connected: false}, source: "ig"}});
  return r.fulfill({json: {}});
});
await ctx.addInitScript(() => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){} });
try {
  await p.goto("http://localhost:8096/"); await p.waitForTimeout(800);
  const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
  const dowMon = (new Date(today + "T12:00:00").getDay() + 6) % 7, monday = add(today, -dowMon);
  // a plan that started two Mondays ago with a run six days a week, so the last week always has past planned days
  const base = {name: "Casey", goal: "half", weekly: 20, longest: 8, prDist: "none", days: [0, 1, 2, 3, 4, 5, 6], longDay: 6, lifts: 0, liftExp: "Some", weight: 170, start: add(monday, -7), pv: 1};
  const open = async prof => { profile = prof; await p.goto("http://localhost:8096/"); await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(700);
    return p.$$eval(".mcard .lbl", els => els.map(e => e.textContent)); };
  const missedOld = await open({...base});
  t(missedOld.length === 1 && /^Missed /.test(missedOld[0]), "an older plan with no build date still shows a missed day (" + (missedOld[0] || "none") + ")");
  const missedNew = await open({...base, built: today});
  t(missedNew.length === 0, "a plan built today shows no missed days from before it was built (got: " + (missedNew.join(", ") || "none") + ")");
  // the card names the day ("Missed Tuesday"): it must be a day on or after the build date
  const DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const built3 = add(today, -3), missed3 = await open({...base, built: built3});
  const nm = (missed3[0] || "").replace(/^Missed /, ""), back = [1, 2, 3, 4, 5, 6, 7].map(i => add(today, -i)).find(d => /^yesterday$/i.test(nm) ? d === add(today, -1) : DAYN[new Date(d + "T12:00:00").getDay()] === nm);
  t(missed3.length === 1 && !!back && back >= built3, "a plan built 3 days ago still flags a missed day, but only one after it was built (" + (missed3[0] || "none") + ", built " + built3 + ")");
  if (process.env.SHOTS){ await open({...base, built: today}); await p.screenshot({path: process.env.SHOTS + "/day-one-today.png"}); }
} catch(e){ t(false, "test crashed: " + (e && e.message || e)); }
await b.close(); srv.close();
console.log(bad ? bad + " day-one check(s) failed" : "day one: all checks pass");
process.exit(bad ? 1 : 0);
