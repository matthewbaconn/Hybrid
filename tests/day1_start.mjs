// Day-1 nudge (incident activation-none-trained, Nov 24, 2026: 4 of 15 members with a plan have trained; 7 of 14 plan
// holders logged nothing in their first 48 h). Day 1 was a line of text, the reminder sheet covered it 1.2 s later, and
// starting the run took two taps. Mocks the API in the browser (no live data). Checks:
//   - never trained, plan built today, a run today: Today's card says "Day 1: <session>, about <n> min" with ONE
//     "Start Day 1 now" button, and the I did it button stays
//   - one tap on it opens the phone coach (Start with my phone) for today's session
//   - a plan built earlier, never trained: "Your first workout is today: ..." and "Start it now" (no "Day 1")
//   - after a check-off or a synced workout the button is gone and "See the workout" is back
//   - a lift-only day: the button opens today's session screen
//   - the first-plan sheet (plan built through setup) on a session day: "Day 1 is today", Start Day 1 now (closes the sheet, opens the coach),
//     Turn on reminders, Not now; on a rest day the sheet is unchanged ("Want a reminder for your workouts?")
// Run: node tests/day1_start.mjs  (serves this folder itself). SHOTS=<dir> saves phone screenshots.
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const PORT = 8101;
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(PORT);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
const dw = d => (new Date(d + "T12:00:00").getDay() + 6) % 7, monday = add(today, -dw(today));
const runToday = {name: "Casey", goal: "fitness", weekly: 15, longest: 6, prDist: "none", days: [dw(today), dw(add(today, 3))], longDay: dw(add(today, 3)), lifts: 0, liftExp: "Some", weight: 170, start: monday, built: today, pv: 2};
const restToday = {...runToday, days: [dw(add(today, 2)), dw(add(today, 4))], longDay: dw(add(today, 4))};
const liftToday = {...runToday, days: [dw(add(today, 2)), dw(add(today, 4))], longDay: dw(add(today, 4)), lifts: 1, liftDays: [dw(today)]};
const me = (profile, extra) => ({user: {id: "u1", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile, activities: [], done: [], features: {},
  strava: {available: true, connected: false}, garmin: {available: true, connected: false},
  push: {key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", devices: 0}, ...extra});
const b = await chromium.launch();
async function open(j, {asked = true, wait = true} = {}){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
  p.on("pageerror", e => { console.log("FAIL page error: " + e.message); bad++; });
  await ctx.addInitScript(asked => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); if (asked) localStorage.setItem("hy-nask", String(Date.now())); } catch(e){}
    try { Object.defineProperty(Notification, "permission", {get: () => "default"}); } catch(e){} }, asked);
  await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
  await p.route(/hybrid-api\.hybridapp\.workers\.dev/, r => { const u = new URL(r.request().url()).pathname;
    return r.fulfill({json: u === "/api/me" ? j : u === "/api/founding" ? {left: 80, max: 100, members: 20} : {}}); });   // founding needs a count, or Today re-renders on every answer
  await p.goto("http://localhost:" + PORT + "/"); if (!wait) return {p, ctx};
  await p.waitForSelector("#tabbar", {timeout: 15000});
  await p.waitForFunction(() => !document.querySelector("#splash:not(.out)"), null, {timeout: 8000}).catch(() => {}); await p.waitForTimeout(900);
  return {p, ctx};
}
const txt = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
try {
  // 1. plan built today, run today, never trained
  { const {p, ctx} = await open(me(runToday));
    const hint = await txt(p, ".hub-hero .hfirst"), btn = await txt(p, ".hub-hero .hstart");
    t(/Your plan is ready\. Day 1: .+, about \d+ min\./.test(hint), "built today, run today: hint names Day 1 and about how long (" + hint.slice(0, 70) + ")");
    t(btn.trim() === "Start Day 1 now" && (await p.$$(".hub-hero .hstart")).length === 1, "one 'Start Day 1 now' button on Today (got: " + (btn.trim() || "none") + ")");
    t(!!(await p.$(".hub-hero .hcheck")) && /Already did it\? Tap I did it\./.test(hint), "I did it stays, with 'Already did it? Tap I did it.'");
    t(!(await p.$(".hub-hero .hgo .hsee")) && !!(await p.$(".hub-hero .hfirst button.hsee")), "the Start button leads the card; 'See the workout' moves into the tip (still a button, for the keyboard)");
    if (process.env.SHOTS){ await p.$eval(".hub-hero", e => e.scrollIntoView({block: "center"})); await p.waitForTimeout(200); await p.screenshot({path: process.env.SHOTS + "/day1-today.png"}); }
    await p.click(".hub-hero .hstart"); await p.waitForTimeout(400);
    t(!!(await p.$("#player")), "one tap opens the phone coach for today's session");
    if (process.env.SHOTS) await p.screenshot({path: process.env.SHOTS + "/day1-coach.png"});
    await ctx.close(); }
  // 2. plan built 3 days ago, never trained
  { const {p, ctx} = await open(me({...runToday, built: add(today, -3)}));
    const hint = await txt(p, ".hub-hero .hfirst"), btn = (await txt(p, ".hub-hero .hstart")).trim();
    t(/Your first workout is today: /.test(hint) && !/Day 1/.test(hint) && btn === "Start it now", "built earlier, never trained: 'Your first workout is today' and 'Start it now' (" + btn + ")");
    await ctx.close(); }
  // 3. trained before: no button
  { const {p, ctx} = await open(me(runToday, {done: [add(today, -1) + "-0"]}));
    t(!(await p.$(".hub-hero .hstart")) && !!(await p.$(".hub-hero .hgo .hsee")), "checked off a workout before: no Start button, 'See the workout' is back in its place");
    await ctx.close(); }
  { const {p, ctx} = await open(me(runToday, {activities: [{id: "a1", source: "strava", date: add(today, -1), type: "run", name: "Morning Run", mi: 3, minutes: 30}]}));
    t(!(await p.$(".hub-hero .hstart")), "synced a workout before: no Start button");
    await ctx.close(); }
  // 4. a lift-only day
  { const {p, ctx} = await open(me(liftToday));
    if (await p.$(".hub-hero.t-lift")){
      t((await txt(p, ".hub-hero .hstart")).trim() === "Start Day 1 now", "lift day: Start Day 1 now shows");
      await p.click(".hub-hero .hstart"); await p.waitForTimeout(600);
      t(!(await p.$("#player")) && /Today's session/.test(await p.evaluate(() => document.body.innerText)), "lift day: the button opens today's session screen, not the phone coach");
    } else t(false, "lift-day profile did not put a lift on Today");
    await ctx.close(); }
  // 5. the first-plan sheet, driven through plan setup like a new member (same steps as tests/first_remind.mjs)
  async function buildFirstPlan(p, withToday){
    await p.waitForSelector("h2.sec-t >> text=What's your goal?", {timeout: 15000});
    await p.click('label.opt:has(input[value="10k"])');
    await p.fill("#s-date", new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10));
    await p.click('[data-act="next"]'); await p.waitForSelector("#s-weekly");
    await p.fill("#s-weekly", "12"); await p.fill("#s-longest", "5");
    await p.click('[data-act="next"]'); await p.waitForSelector("#s-ft", {timeout: 5000});
    await p.fill("#s-ft", "5"); await p.fill("#s-in", "9"); await p.fill("#s-age", "27"); await p.fill("#s-w", "160");
    await p.click('[data-act="next"]'); await p.waitForSelector("#s-long");
    const td = dw(today), pick = withToday ? [td, (td + 2) % 7, (td + 4) % 7] : [(td + 1) % 7, (td + 3) % 7, (td + 5) % 7];
    await p.evaluate(pick => document.querySelectorAll('input[name="days"]').forEach(x => { x.checked = pick.includes(+x.value); }), pick);
    await p.click('[data-act="next"]');
    await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(2600);
  }
  { const {p, ctx} = await open(me(null), {asked: false, wait: false});
    await buildFirstPlan(p, true);
    const sh = await txt(p, ".sheet.nask");
    t(/Day 1 is today/.test(sh) && /about \d+ min\. Start it now, or turn on reminders/.test(sh), "first plan with a run today: the sheet says 'Day 1 is today' with the session (" + sh.replace(/\s+/g, " ").slice(0, 90) + ")");
    const labels = await p.$$eval(".sheet.nask button", bs => bs.map(x => x.textContent.trim()));
    t(labels.join("|") === "Start Day 1 now|Turn on reminders|Not now", "sheet buttons: Start Day 1 now, Turn on reminders, Not now (" + labels.join(", ") + ")");
    if (process.env.SHOTS) await p.screenshot({path: process.env.SHOTS + "/day1-sheet.png"});
    if (labels.length) await p.click('.sheet.nask [data-act="d1start"]'); await p.waitForTimeout(400);
    t(!(await p.$(".back .sheet.nask")) && !!(await p.$("#player")), "Start Day 1 now closes the sheet and opens the phone coach");
    await ctx.close(); }
  { const {p, ctx} = await open(me(null), {asked: false, wait: false});
    await buildFirstPlan(p, false);
    const sh = await txt(p, ".sheet.nask");
    t(/Want a reminder for your workouts\?/.test(sh) && !(await p.$('.sheet.nask [data-act="d1start"]')), "first plan with no session today: the sheet is unchanged (" + sh.replace(/\s+/g, " ").slice(0, 50) + ")");
    await ctx.close(); }
} catch(e){ t(false, "test crashed: " + (e && e.message || e)); }
await b.close(); srv.close();
console.log(bad ? bad + " day-1 check(s) failed" : "day 1 start: all checks pass");
process.exit(bad ? 1 : 0);
