// "Not checked off" card (incident activation-none-trained, Nov 22, 2026: members came back daily for check-ins and food,
// but almost none checked off a workout). The old "Missed <day>" card told a member who trained and forgot to tap that the
// workout "didn't get done" and only offered Move/Skip. Now it asks "Did you do it?" with I did it first. Mocks the API.
// Run: node tests/missed_did.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8097);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
let me = null; const puts = [];
const b = await chromium.launch(), ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
p.on("pageerror", e => { console.log("FAIL page error: " + e.message); bad++; });
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
  const u = new URL(r.request().url());
  if (u.pathname === "/api/me") return r.fulfill({json: me});
  if (u.pathname === "/api/done"){ puts.push(r.request().postDataJSON()); return r.fulfill({json: {ok: true}}); }
  return r.fulfill({json: {}});
});
await ctx.addInitScript(() => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){} });
const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dw = d => (new Date(d + "T12:00:00").getDay() + 6) % 7, monday = add(today, -dw(today));
// runs only on the day after tomorrow and the day after that: today and tomorrow are rest days
const runProf = {name: "Casey", goal: "fitness", weekly: 20, longest: 6, prDist: "none", days: [0,1,2,3,4,5,6], longDay: 6, lifts: 0, liftExp: "Some", weight: 170, start: add(monday, -7), built: add(today, -3), pv: 2};
const restProf = {name: "Casey", goal: "fitness", weekly: 15, longest: 6, prDist: "none", days: [dw(add(today, 2)), dw(add(today, 4))], longDay: dw(add(today, 4)), lifts: 0, liftExp: "Some", weight: 170, start: monday, built: today, pv: 2};
const base = (profile, extra) => ({user: {id: "u1", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile, activities: [], done: [], features: {},
  strava: {available: true, connected: false}, garmin: {available: true, connected: false}, ...extra});
const open = async j => { me = j; await p.goto("http://localhost:8097/"); await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(700); };
const shot = async f => { await p.evaluate(() => { const c = document.querySelector(".mcard"); if (c) window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 250); document.querySelectorAll("*").forEach(e => { if (e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY) && c && e.contains(c)) e.scrollTop = c.offsetTop - 250; }); }); await p.waitForTimeout(300); await p.screenshot({path: process.env.SHOTS + "/" + f}); };
try {
  await open(base(runProf));
  const lbl = await p.$eval(".mcard .lbl", e => e.textContent).catch(() => "");
  t(/^Not checked off: yesterday$/i.test(lbl), "past planned day not checked off: card asks about it (" + lbl + ")");
  const txt = await p.$eval(".mcard", e => e.innerText).catch(() => "");
  t(/Did you do it\?/.test(txt) && !/didn't get done/.test(txt), "it asks, doesn't assume it was missed");
  t(/I did it/.test(txt) && /Move it/.test(txt) && /Skip it/.test(txt), "buttons: I did it, Move it, Skip it");
  if (process.env.SHOTS){ await p.waitForTimeout(2500); await shot("missed-did-it.png"); }
  await p.evaluate(() => document.querySelector(".mcard [data-act=mdid]").click()); await p.waitForTimeout(600);
  const y = add(today, -1);
  t(puts.some(x => x.key === y + "-0" && x.done === true), "I did it saves yesterday's session as done (" + JSON.stringify(puts) + ")");
  t(/First workout checked off/.test(await p.innerText("body")), "first ever: the first-workout toast shows");
  const lbl2 = await p.$eval(".mcard .lbl", e => e.textContent).catch(() => "");
  t(lbl2 !== lbl, "the card moves on from yesterday (" + (lbl2 || "no card") + ")");
  if (process.env.SHOTS){ await shot("missed-did-it-after.png"); }
  // already trained before: plain toast
  await open(base(runProf, {done: [add(today, -2) + "-0"]}));
  await p.evaluate(() => document.querySelector(".mcard [data-act=mdid]").click()); await p.waitForTimeout(600);
  t(/Checked off\. Nice work\./.test(await p.innerText("body")), "trained before: plain Checked off toast");
  // yesterday checked off already: no card for it
  await open(base(runProf, {done: [add(today, -1) + "-0", add(today, -2) + "-0", add(today, -3) + "-0"]}));
  t(!(await p.$(".mcard")), "every past day checked off: no card");
  // a synced run on yesterday also counts: no card for yesterday
  await open(base(runProf, {done: [add(today, -2) + "-0", add(today, -3) + "-0"], activities: [{id: "a1", source: "strava", date: add(today, -1), type: "run", name: "Morning Run", mi: 3, minutes: 30}]}));
  t(!(await p.$(".mcard")), "synced run yesterday: no card");
  // ...on every weekday, not just easy-run days (Nov 24: the fixture used type "Run", but the API stores "run", so a synced
  // run only counted when yesterday was an easy day that a cross-training swap could cover; red on Mondays and Thursdays)
  for (let k = 1; k <= 7; k++){
    const fake = add(today, k), at = new Date(fake + "T09:00:00"), fd = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
    const fmon = fd(fake, -dw(fake)), prof = {...runProf, start: fd(fmon, -7), built: fd(fake, -3)};
    await p.clock.setFixedTime(at);
    await open(base(prof, {done: [fd(fake, -2) + "-0", fd(fake, -3) + "-0"], activities: [{id: "a1", source: "strava", date: fd(fake, -1), type: "run", name: "Morning Run", mi: 6, minutes: 60}]}));
    const l = await p.$eval(".mcard .lbl", e => e.textContent).catch(() => "");
    t(!l, "synced run yesterday, " + DAYS[at.getDay()] + ": no card (" + (l || "none") + ")");
  }
} catch(e){ console.log("FAIL error: " + e.message); bad++; }
await b.close(); srv.close();
console.log(bad ? bad + " FAILED" : "ALL PASS"); process.exit(bad ? 1 : 0);
