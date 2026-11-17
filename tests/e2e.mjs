// Real-browser test of every screen of Hybrid. Runs against the live site and live API by default.
//   SITE=https://app.hybrdrunning.com/ node tests/e2e.mjs
// Uses a throwaway account (deleted at the end) and the real AI, weather and database.
import { chromium } from "playwright";
import fs from "fs";
const SITE = process.env.SITE || "https://app.hybrdrunning.com/";
const SHOTS = process.env.SHOTS || "e2e-shots";
const FAST = !!process.env.LOCAL;          // local runs: no internet weather/AI waits
fs.mkdirSync(SHOTS, {recursive: true});
const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const results = [], problems = [];
let step = "";
const ok = (name, detail) => { results.push("✅ " + name + (detail ? " — " + detail : "")); console.log("ok   " + name + (detail ? " — " + detail : "")); };
const fail = (name, detail) => { problems.push(name + ": " + detail); results.push("❌ " + name + " — " + detail); console.log("FAIL " + name + " — " + detail); };
// One failed check must not break the ones after it (Nov 14: three nightly runs each had ONE real failure that
// cascaded into 4-14, because the page was left on a stuck screen). After any failure the app is reloaded to its
// home screen (and signed back in if needed). A check that continues from a failed one is reported as "not run",
// never as a second failure and never as a pass.
const failedChecks = new Set(), notRun = [];
let recoveries = 0;
const skip = (name, why) => { notRun.push(name); results.push("⏭ " + name + " — " + why); console.log("skip " + name + " — " + why); };
async function recover(name){
  if (!results.some(r => r.startsWith("✅ Build a plan"))) return;          // before the app exists there is nothing to restore
  try {
    await page.goto(SITE, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForSelector("#tabbar, .welcome h1", {timeout: 20000});
    if (!(await page.isVisible("#tabbar"))){                                         // the failure left us signed out: sign back in
      await page.click('[data-act="authlogin"]'); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
      await page.waitForSelector("#tabbar", {state: "visible", timeout: 20000});
    }
    await page.waitForTimeout(500); recoveries++;
    console.log("     recovered: app reloaded to its home screen after \"" + name + "\" failed");
  } catch(e){ console.log("     could NOT recover after \"" + name + "\": " + String(e && e.message || e).split("\n")[0].slice(0, 160)); }
}
// opts.needs: checks this one continues from (not run if any failed). opts.needsOne: not run only if ALL of them failed.
async function check(name, fn, opts){
  step = name;
  const dead = opts && opts.needs && [].concat(opts.needs).find(n => failedChecks.has(n));
  const allDead = opts && opts.needsOne && opts.needsOne.every(n => failedChecks.has(n)) && opts.needsOne[0];
  if (dead || allDead){ failedChecks.add(name); return skip(name, "not run: it continues from \"" + (dead || allDead) + "\", which failed"); }
  try {
    if (process.env.E2E_BREAK === name){ await page.click('[data-scr="weather"]').catch(() => {}); throw new Error("induced failure (E2E_BREAK), page left on another screen"); }   // test of the test: see tests/README
    const d = await fn(); ok(name, d);
  } catch(e){ if (e && e.outside){ notRun.push(name); results.push("⏭ " + name + " — " + e.message); console.log("skip " + name + " — " + e.message); return; }
    fail(name, String(e && e.message || e).split("\n")[0].slice(0, 300)); failedChecks.add(name); await recover(name); }
}
const ensure = async (sel, sc) => { if (!(await page.$(sel))) await open(sc); };   // open a screen only if the check isn't already on it

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: iPhone, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
await ctx.addInitScript(() => { try { localStorage.setItem("hy-nask", String(Date.now())); localStorage.setItem("hy-nonew", "1"); } catch(e){} });   // skip the "turn on notifications?" pop-up
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", e => consoleErrors.push("[" + step + "] " + e.message));
// Outside services we don't run (open-meteo weather/geocoding). A slow or unreachable one is the sandbox's/network's
// problem, not the app's (Nov 15 nightly: open-meteo timed out -> 2 false failures on a commit that passed an hour before).
const OUTSIDE = /open-meteo\.com/;
const outsideTrouble = [];
if (process.env.E2E_BLOCK_OUTSIDE) await page.route(OUTSIDE, r => r.abort("timedout"));   // test of the test: weather service "down" must give a not-run, never a failure
const outsideInFlight = new Set();
page.on("request", r => { if (OUTSIDE.test(r.url())) outsideInFlight.add(r.url()); });
page.on("requestfinished", r => outsideInFlight.delete(r.url()));
page.on("requestfailed", r => { outsideInFlight.delete(r.url()); if (OUTSIDE.test(r.url())) outsideTrouble.push(new URL(r.url()).host + " " + ((r.failure() && r.failure().errorText) || "failed")); });
page.on("console", m => {
  if (m.type() !== "error") return;
  const t = m.text(), u = (m.location() && m.location().url) || "";
  if (/fonts\.g|favicon|ERR_NAME/.test(t) || (step === "Delete account" && /401/.test(t))) return;
  if (/net::ERR_/.test(t) && OUTSIDE.test(u)) return;                                       // outside service down/slow: not an app error
  consoleErrors.push("[" + step + "] " + t + (u && /Failed to load resource/.test(t) ? " (" + u.split("?")[0] + ")" : ""));   // name the URL so the next failure is diagnosable
});
const shot = (n, screen) => page.screenshot({path: SHOTS + "/" + n + ".png", fullPage: !screen});   // screen = just what the phone shows (for things pinned to the bottom)
const tab = async t => { await page.click('#tabbar [data-tab="' + (t === "recovery" ? "training" : t) + '"]'); await page.waitForTimeout(400); if (t === "recovery"){ await page.click('.segsw [data-tab2="recovery"]'); await page.waitForTimeout(400); } };
const open = async sc => { await page.click('[data-scr="' + sc + '"]'); await page.waitForSelector(".scrbar", {timeout: 5000}); await page.waitForTimeout(250); };
const back = async () => { await page.click('[data-act="back"]'); await page.waitForTimeout(250); };
const settings = async () => { await page.click('[data-act="menu"]'); await page.waitForSelector(".scrbar >> text=Settings", {timeout: 5000}); };
const noOverflow = async () => { const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 392) throw new Error("page is " + w + " px wide at 390 (sideways scroll)"); };
const email = "e2e-" + Date.now() + "@example.com", pass = "nightly-check-" + Math.random().toString(36).slice(2, 8);

await check("Site loads", async () => { await page.goto(SITE, {waitUntil: "networkidle"}); await page.waitForSelector(".welcome h1", {timeout: 15000}); await noOverflow(); await shot("01-welcome"); return await page.title(); });
await check("Get app guide (iPhone)", async () => { await page.click('[data-act="getapp"]'); await page.waitForSelector(".sheet.inst"); const t = await page.innerText(".sheet.inst"); await page.click('.sheet [data-act="close"]'); if (!/Add to Home Screen/.test(t)) throw new Error("guide text missing"); });
await check("Sample runner", async () => {
  await page.click('[data-act="sample"]'); await page.waitForSelector(".hub-hero"); for (const t of ["plan", "activities", "recovery", "training", "today"]){ await tab(t); await noOverflow(); }
  await settings(); await page.click('[data-act="authsignup"]'); await page.waitForSelector("#authform");
});
await check("Sign-up needs the 18+ / terms box", async () => { await page.fill("#a-name", "Nightly"); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
  await page.waitForSelector("#authform .err:not(:empty)", {timeout: 5000}); const t = await page.innerText("#authform .err"); if (!/18/.test(t)) throw new Error(t);
  await page.click('[data-act="doc"][data-k="health"]'); await page.waitForSelector(".sheet.legal"); const h = await page.innerText(".sheet.legal"); await page.click('.sheet [data-act="close"]');
  if (!/not a dietitian/.test(h) || !/866-662-1235/.test(h)) throw new Error("health notice text"); return "blocked until checked · notice opens";
});
await check("Sign up", async () => { await page.fill("#a-name", "Nightly"); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.check("#a-agree"); await page.click('#authform [type="submit"]'); await page.waitForSelector("h2.sec-t >> text=What's your goal?", {timeout: 15000}); });
await check("Build a plan (4 steps)", async () => {
  await page.click('label.opt:has(input[value="half"])');
  const race = new Date(Date.now() + 84 * 864e5).toISOString().slice(0, 10);
  await page.fill("#s-date", race); await page.click("#s-goal"); await page.keyboard.type("14500");
  if (await page.inputValue("#s-goal") !== "1:45:00") throw new Error("goal time didn't format: " + await page.inputValue("#s-goal"));
  await page.click('[data-act="next"]');
  await page.fill("#s-weekly", "22"); await page.fill("#s-longest", "8"); await page.click('label.opt:has(input[name="prDist"][value="10k"])'); await page.click("#s-pr"); await page.keyboard.type("4830");
  await page.click('[data-act="next"]'); await page.click('label.opt:has(input[name="lifts"][value="3"])'); await page.fill("#s-ft", "5"); await page.fill("#s-in", "10"); await page.fill("#s-age", "30"); await page.fill("#s-w", "182"); await page.fill("#s-gw", "175");
  await page.click('[data-act="next"]'); await page.click('[data-act="next"]');
  await page.waitForSelector(".hub-hero", {timeout: 15000}); await noOverflow(); await shot("02-today");
  const t = await page.innerText(".hub-hero h3");
  if (await page.locator('.hub-hero[data-scr="session"]').count()){ await open("session"); await page.waitForSelector(".hero .sess-t"); await noOverflow(); await shot("02b-session"); await back(); }
  return t;
});
await check("First workout: one tap on Today checks it off (then undone)", async () => {
  await tab("today"); const btn = page.locator(".hub-hero .hcheck").first();
  if (!(await btn.count())){ if (await page.locator(".hfirst").count()) throw new Error("first-workout tip shown without a check-off button"); return "rest day today: no button (correct)"; }
  if (!(await page.locator(".hub-hero .hfirst").count())) throw new Error("new member: first-workout tip missing");
  await shot("02c-first-workout"); await btn.click(); await page.waitForSelector(".hub-hero .hdone", {timeout: 5000});
  const msg = await page.innerText(".toast"); if (!/First workout checked off/.test(msg)) throw new Error("toast: " + msg);
  if (await page.locator(".hub-hero .hfirst").count()) throw new Error("tip still shown after the check-off"); await shot("02d-first-done");
  await open("session"); await page.click('.hero [data-act="done"] >> nth=0'); await back();   // undo: later checks expect today's workout open
  await page.waitForSelector(".hub-hero .hcheck", {timeout: 5000}); return "tip + one tap + toast, undone";
}, {needs: "Build a plan (4 steps)"});
await check("Move a day (calendar picker, preview, saved, put back)", async () => {
  await tab("plan"); await page.waitForSelector(".day-h");
  const btn = page.locator(".day-h .mvb").last(); if (!(await btn.count())) throw new Error("no Move button on the plan");
  const from = await btn.getAttribute("data-date"), label = async d => (await page.locator("#d-" + d + " .day-b").innerText()).split("\n")[0];
  const before = await label(from);
  await btn.click(); await page.waitForSelector(".sheet.mvs .mvcal"); await noOverflow(); await shot("02c-move-sheet");
  const to = await page.evaluate(() => { const c = [...document.querySelectorAll('.sheet.mvs .mvd[data-act="mvsel"]')].find(x => document.getElementById("d-" + x.dataset.d)); return c ? c.dataset.d : null; });
  if (!to){ await page.evaluate(() => { const b = document.querySelector(".back"); if (b) b.remove(); }); return "skipped: no open day left this week (last day of the week)"; }
  await page.click('.sheet.mvs .mvd[data-d="' + to + '"]'); await page.waitForSelector(".sheet.mvs .mvpv");
  const pv = await page.innerText(".sheet.mvs .mvpv"); if (!/After the move/i.test(pv)) throw new Error("no preview: " + pv);
  await shot("02c2-move-preview");
  await page.locator('.sheet.mvs .mvpv ~ [data-act="mvpick"]').first().click(); await page.waitForTimeout(700);
  await tab("plan"); const toBefore = (await page.locator("#d-" + to).count()) ? await label(to) : null;
  if (toBefore !== before) throw new Error("day didn't move: " + from + " → " + to + " shows " + toBefore);
  await page.waitForTimeout(600); await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar:not([hidden])", {timeout: 15000}); await page.waitForTimeout(300); await tab("plan");
  if (await page.locator("#d-" + to).count() && await label(to) !== before) throw new Error("move wasn't saved to the account");
  await shot("02d-moved");
  const back = page.locator('#d-' + to + ' .mvb'); if (await back.count()){ await back.click(); await page.waitForSelector(".sheet.mvs"); const pb = page.locator('.sheet.mvs [data-act="mvpick"]:has-text("Put it back")'); if (await pb.count()){ await pb.click(); await page.waitForTimeout(800); } else await page.click('.sheet.mvs [data-act="close"]'); }
  if (await label(from) !== before) throw new Error("put back didn't restore");
  await tab("today"); return from + " → " + to + " · " + pv.replace(/\n/g, " ").slice(0, 90);
});
await check("Change a workout (similar option, saved, back to planned)", async () => {
  await tab("plan"); await page.waitForSelector(".day-h");
  const btn = page.locator('[data-act="chgopen"]').first(); if (!(await btn.count())) throw new Error("no Change workout button");
  const key = await btn.getAttribute("data-key"), d = key.slice(0, 10), title = async () => (await page.locator("#d-" + d + " .sess-t").nth(+key.slice(11)).innerText()).trim();
  const before = await title();
  await btn.click(); await page.waitForSelector(".sheet.chg"); await noOverflow(); await shot("02e-change-sheet");
  const opt = page.locator('.sheet.chg [data-act="chgpick"]').first(); if (!(await opt.count())) throw new Error("no similar options for " + before);
  const pick = (await opt.locator("b").innerText()).trim(); await opt.click(); await page.waitForTimeout(800);
  if (await title() !== pick) throw new Error("title is " + await title() + ", expected " + pick);
  await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar:not([hidden])", {timeout: 15000}); await page.waitForTimeout(300); await tab("plan");
  if (await title() !== pick) throw new Error("change wasn't saved to the account");
  if (!/Planned:/.test(await page.innerText("#d-" + d))) throw new Error("no 'Planned:' note");
  await page.click('[data-act="chgopen"][data-key="' + key + '"]'); await page.waitForSelector(".sheet.chg");
  if (!(await page.locator('#chg-res [data-act="chgpick"]').count())) throw new Error("no similar options shown first");
  await page.fill("#chg-q", "bike"); await page.waitForTimeout(200);
  const hits = await page.locator('#chg-res [data-act="chgpick"]').count(); if (!hits) throw new Error("search 'bike' found nothing");
  await page.click('.sheet.chg [data-act="chgtab"][data-k="own"]'); await page.fill("#co-title", "Club track night"); await page.fill("#co-mi", "5"); await page.fill("#co-steps", "Warm up 2 mi\n6 × 400 m hard, 200 m jog\nCool down 1 mi");
  await page.click('[data-act="chgown"]'); await page.waitForTimeout(800); if (await title() !== "Club track night") throw new Error("own workout not set: " + await title());
  await page.click('[data-act="chgopen"][data-key="' + key + '"]'); await page.waitForSelector(".sheet.chg"); await page.click('[data-act="chgreset"]'); await page.waitForTimeout(800);
  if (await title() !== before) throw new Error("reset didn't restore: " + await title());
  await tab("today"); return before + " → " + pick + " → own → back · search 'bike': " + hits;
});
await check("Swap one exercise from its dropdown (saved, then put back)", async () => {
  await tab("plan"); await page.waitForSelector(".day-h");
  for (let k = 0; k < 3 && !(await page.locator("select[data-exsw]").count()); k++){ await page.click('[data-act="wk"][data-dir="1"]'); await page.waitForTimeout(300); }
  const sel = page.locator("select[data-exsw]").first(); if (!(await sel.count())) throw new Error("no swap dropdown on any strength exercise");
  const key = await sel.getAttribute("data-exsw"), i = await sel.getAttribute("data-i");
  const li = () => page.locator('select[data-exsw="' + key + '"][data-i="' + i + '"]').locator("xpath=ancestor::li[1]");
  const before = (await li().innerText()).split("\n")[0];
  const pick = await sel.evaluate(s => [...s.options].find(o => o.value && o.value !== "__other" && !o.disabled).value);
  await sel.selectOption(pick); await page.waitForTimeout(800); await shot("02h-exercise-swap");
  const after = await li().innerText(); if (!after.startsWith(pick) || !/instead of/.test(after)) throw new Error("swap not shown: " + after.replace(/\n/g, " | "));
  await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar:not([hidden])", {timeout: 15000}); await page.waitForTimeout(300); await tab("plan");
  for (let k = 0; k < 3 && !(await page.locator('select[data-exsw="' + key + '"]').count()); k++){ await page.click('[data-act="wk"][data-dir="1"]'); await page.waitForTimeout(300); }
  if (!(await li().innerText()).startsWith(pick)) throw new Error("swap wasn't saved");
  const planned = await page.locator('select[data-exsw="' + key + '"][data-i="' + i + '"]').evaluate(s => [...s.options].find(o => / \(planned\)$/.test(o.text)).value);
  await page.locator('select[data-exsw="' + key + '"][data-i="' + i + '"]').selectOption(planned); await page.waitForTimeout(800);
  if (!(await li().innerText()).startsWith(before.replace(/\s+\d+\s*[×x].*$/, "")) || /instead of/.test(await li().innerText())) throw new Error("put back didn't restore");
  await tab("today"); return before + " → " + pick + " → back";
});
await check("Missed workout moves forward, custom workouts follow their day (plan logic)", async () => {
  const r = await page.evaluate(() => { const p = {goal: "half", raceDate: "2027-02-07", goalSec: 6300, weekly: 22, longest: 8, days: [0, 2, 4, 6], longDay: 6, lifts: 2, start: "2026-11-09", prDist: "10k", prSec: 2910};
    const pl = HP.buildPlan(p, "2026-11-14"), sun = pl.weeks[0].days[6], mon = pl.weeks[1].days[0], wed = pl.weeks[0].days[2];
    const x = HP.buildPlan({...p, swaps: [[sun.date, mon.date]]}, "2026-11-14"), alt = HP.alternatives(pl, wed.sessions[0])[0];
    const y = HP.buildPlan({...p, custom: {[wed.sessions[0].o]: alt}, swaps: [[wed.date, pl.weeks[0].days[4].date]]}, "2026-11-14");
    const bad = HP.buildPlan({...p, custom: {[wed.sessions[0].o]: {type: "easy", title: "", steps: []}}}, "2026-11-14");
    return {cross: x.weeks[1].days[0].sessions[0].title === sun.sessions[0].title && x.weeks[0].miles + x.weeks[1].miles === pl.weeks[0].miles + pl.weeks[1].miles,
      follows: y.weeks[0].days[4].sessions[0].title === alt.title, ignored: bad.weeks[0].days[2].sessions[0].title === wed.sessions[0].title,
      ex: HP.exAlts("Back squat").list.includes("Goblet squat"), lib: HP.library(pl).length > 30}; });
  if (Object.values(r).some(v => !v)) throw new Error(JSON.stringify(r)); return JSON.stringify(r);
});
await check("Log weights and reps, see strength progress", async () => {
  await tab("plan"); await page.waitForSelector(".day-h");
  const lo = page.locator('[data-act="lopen"]').first(); if (!(await lo.count())) return "no strength session on or before today this week (skipped)";
  await lo.click(); await page.waitForSelector(".liftlog #lr-0"); await noOverflow(); await shot("02f-liftlog");
  const ex = (await page.locator(".liftlog .lrow b").first().innerText()).trim();
  await page.fill("#lw-0", "100"); await page.fill("#lr-0", "8"); await page.click('[data-act="lsave"]'); await page.waitForTimeout(800);
  await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar:not([hidden])", {timeout: 15000}); await page.waitForTimeout(300);
  await tab("training"); await page.waitForSelector("text=Strength progress", {timeout: 5000});
  const t = await page.locator(".pc:has-text('Strength progress')").innerText(); await shot("02g-strength");
  if (!t.includes(ex) || !/100 lb × 8/.test(t)) throw new Error("progress card: " + t.replace(/\n/g, " ").slice(0, 160));
  await tab("today"); return ex + " 100 lb × 8 saved and shown";
});
await check("Move check flags hard back-to-back days (plan logic)", async () => {
  const r = await page.evaluate(() => { const p = {goal: "half", raceDate: "2027-02-07", goalSec: 6300, weekly: 22, longest: 8, days: [0, 1, 3, 4, 5], longDay: 5, lifts: 3, start: "2026-11-09", prDist: "10k", prSec: 2910, age: 30, weight: 182};
    const pl = HP.buildPlan(p, "2026-11-14"), w = pl.weeks[1].days, wk = pl.weeks[1].miles, sw = HP.buildPlan({...p, swaps: [[w[1].date, w[2].date]]}, "2026-11-14");
    return {legs: HP.swapCheck(pl, w[2].date, w[4].date), same: sw.weeks[1].miles === wk, moved: sw.weeks[1].days[2].sessions.some(s => s.type === "workout"), bad: HP.buildPlan({...p, swaps: [[w[1].date, pl.weeks[3].days[1].date]]}, "2026-11-14").weeks[1].days[1].sessions.some(s => s.type === "workout")}; });
  if (!r.same || !r.moved || !r.bad || !r.legs.some(x => /Leg day the day before your long run/.test(x))) throw new Error(JSON.stringify(r));
  return "week miles unchanged · swaps over a week apart ignored · leg-day warning";
});
await check("Morning check-in + AI coach note", async () => {
  if (!(await page.locator('[data-act="cisave"]').count())){ await tab("recovery"); await page.click('[data-act="gotoday"]'); await page.waitForSelector('[data-act="cisave"]', {timeout: 5000}); }   // after noon the check-in is hidden unless opened
  for (const [k, v] of [["sleep_h", "6"], ["sleep_q", "3"], ["soreness", "3"], ["energy", "3"], ["stress", "3"]]) await page.click('[data-act="ciset"][data-k="' + k + '"][data-v="' + v + '"]');
  await page.click('[data-act="cisave"]'); await page.waitForSelector(".ci-row", {timeout: 30000});
  const score = await page.innerText(".ci-row > b");
  if (FAST) return "readiness " + score;
  await page.waitForSelector(".ci-done .coach", {timeout: 30000});
  return "readiness " + score + " · " + (await page.innerText(".ci-done .coach b"));
});
await check("Watch connected: readiness and sleep replace the morning survey", async () => {
  // Pretend a watch sent last night's numbers and today's survey was never filled in (only the app's view changes).
  const today = await page.evaluate(() => HP.isoLocal(new Date()));
  let coachOn = false;   // first the app without the coach (the survey is one tap away), then with it (type how you feel instead)
  const fake = async route => { const r = await route.fetch(); const j = await r.json(); j.features = {ask: coachOn};
    j.checkins = (j.checkins || []).filter(c => c.date !== today);
    j.health = [1, 2, 3, 4, 5].map(i => ({date: HPaddDays(today, -i), sleep_h: 7.4, sleep_score: 80, hrv: 60, rhr: 50, source: "garmin"})).concat([{date: today, sleep_h: 7.2, sleep_score: 82, hrv: 61, rhr: 49, source: "garmin"}]);
    await route.fulfill({response: r, json: j}); };
  const HPaddDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  await page.route("**/api/me", fake);
  try {
    await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar"); await tab("today");
    await page.waitForSelector(".ci-done.wr");
    const t = (await page.textContent(".ci-done.wr")).replace(/\s+/g, " ");
    if (!/From your watch/.test(t) || !/7\.2 h sleep/.test(t) || !/sleep score 82/.test(t) || !/HRV 61 ms/.test(t) || !/resting HR 49/.test(t)) throw new Error("watch card wrong: " + t.slice(0, 200));
    if (await page.$(".card.ci .ciq")) throw new Error("the morning survey still shows with a watch connected");
    await noOverflow();
    await page.click('.ci-done.wr [data-act="ciopen"]'); await page.waitForSelector(".card.ci .ciq");     // the survey is still one tap away
    await page.click('.card.ci [data-act="ciclose"]'); await page.waitForSelector(".ci-done.wr");           // and one tap closes it again (it used to stay until the app was restarted)
    if (await page.$(".card.ci .ciq")) throw new Error("the survey stayed open after Not now");
    // opened but not answered, then the app goes to the background: the watch's numbers are back when it returns
    await page.click('.ci-done.wr [data-act="ciopen"]'); await page.waitForSelector(".card.ci .ciq");
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"}); document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "visible"}); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForSelector(".ci-done.wr", {timeout: 5000});
    if (await page.$(".card.ci .ciq")) throw new Error("the survey came back after leaving the app");
    // with the coach on (Matthew, Nov 16: "I only want the option to type how u feel if you have a watch connected"): no survey, one tap opens the coach
    coachOn = true; await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar"); await tab("today"); await page.waitForSelector(".ci-done.wr");
    if (await page.$('.ci-done.wr [data-act="ciopen"]')) throw new Error("the survey link still shows on the watch card when the coach is on");
    await page.click('.ci-done.wr [data-act="askfeel"]'); await page.waitForSelector(".sheet.asks #ask-q");
    const ph = await page.getAttribute("#ask-q", "placeholder"); if (!/how do you feel/i.test(ph || "")) throw new Error("the coach did not open asking how you feel: " + ph);
    await page.click('.sheet.asks [data-act="askclose"]'); await page.waitForSelector(".sheet.asks", {state: "detached"});
  } finally {
    await page.unroute("**/api/me", fake); await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar");
  }
}, {needs: "Morning check-in + AI coach note"});
await check("Accessibility: zoom allowed, no button inside a button on Today, day headers readable on Plan", async () => {
  await tab("today"); await page.waitForSelector(".hub-hero");
  const vp = await page.getAttribute('meta[name="viewport"]', "content");
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/.test(vp)) throw new Error("the page still switches zoom off: " + vp);
  const nested = await page.evaluate(() => [...document.querySelectorAll('#app [role="button"], #app button, body [role="button"], body button')].filter(el => el.querySelector('button, [role="button"], a[href]')).map(el => el.className).slice(0, 5));
  if (nested.length) throw new Error("a button holds another button: " + nested.join(" | "));
  if (await page.locator(".hub-hero .hcheck").count() && !(await page.locator(".hub-hero button.hsee").count())) throw new Error("the workout card lost its way to open the session by keyboard");
  await tab("plan"); await page.waitForSelector(".day-h");
  const low = await page.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(v => { v = v / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
    const probe = document.createElement("canvas").getContext("2d");
    const rgb = c => { probe.fillStyle = "#000"; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return "rgb(" + d[0] + "," + d[1] + "," + d[2] + ")"; };
    return [...document.querySelectorAll(".day-h .mvb, .day-h b")].map(b => { const fg = lum(rgb(getComputedStyle(b).color)), bg = lum(rgb(getComputedStyle(b.closest(".day-h")).backgroundColor)); return Math.round((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) * 100) / 100; }).filter(x => x < 4.5);
  });
  if (low.length) throw new Error("a day title or Move button is hard to read in " + low.length + " place(s): " + low.join(", ") + ":1");
  await tab("today");
}, {needs: "Build a plan (4 steps)"});
await check("A crafted #move link can't switch a signed-in member into another account", async () => {
  const mine = await page.evaluate(() => localStorage.getItem("hp-token"));
  if (!/^[a-f0-9]{64}$/.test(mine || "")) throw new Error("no login to protect");
  await page.goto(SITE + "#move=" + "ab".repeat(32)); await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar");
  const after = await page.evaluate(() => localStorage.getItem("hp-token"));
  if (after !== mine) throw new Error("the link replaced the member's login");
  if (/move=/.test(page.url())) throw new Error("the token stayed in the address bar");
}, {needs: "Sign up"});
if (!FAST) await check("Weather + best time to run", async () => {
  await open("weather");
  try {
    const before = outsideTrouble.length;
    await page.fill("#wx-city", "Vero Beach"); await page.click('[data-act="wxcity"]');
    try { await page.waitForSelector(".wx-t", {timeout: 20000}); }
    catch(e){   // excused only when the outside weather service itself failed or is still hanging; a broken screen still fails
      const why = outsideTrouble.slice(before).concat([...outsideInFlight].map(u => new URL(u).host + " still waiting after 20s"));
      if (why.length) throw Object.assign(new Error("not run: weather service didn't answer (" + why.join(", ") + ")"), {outside: true});
      throw e;
    }
    const best = await page.$(".wx-best"); return (await page.innerText(".wx-t")) + " in " + (await page.innerText(".wx-c span")) + (best ? " · " + (await best.innerText()).replace(/\n/g, " ") : "");
  } finally { if (await page.$('[data-act="back"]')) await back(); }   // the weather service being slow mustn't fail every check after this one
});
await check("Today shows the weather and the best time to run", async () => {
  // A made-up forecast stands in for the weather service: 64° and clear now, coolest tomorrow 6 to 9 AM.
  const today = await page.evaluate(() => HP.isoLocal(new Date())), tomorrow = await page.evaluate(d => HP.addDays(d, 1), today);
  const time = [], temp = [];
  for (const d of [today, tomorrow]) for (let h = 0; h < 24; h++){ time.push(d + "T" + String(h).padStart(2, "0") + ":00"); temp.push(d === tomorrow && h >= 6 && h <= 8 ? 55 : 75); }
  const geo = route => route.fulfill({json: {results: [{latitude: 27.64, longitude: -80.4, name: "Testville", admin1: "Florida"}]}});
  const fc = route => route.fulfill({json: {current: {temperature_2m: 64, apparent_temperature: 64, dew_point_2m: 50, weather_code: 0}, daily: {temperature_2m_min: [55], temperature_2m_max: [75]},
    hourly: {time, temperature_2m: temp, apparent_temperature: temp, dew_point_2m: time.map(() => 50), precipitation_probability: time.map(() => 0), weather_code: time.map(() => 0)}}});
  await page.route("**/geocoding-api.open-meteo.com/**", geo); await page.route("**/api.open-meteo.com/**", fc);
  try {
    await tab("today"); await page.waitForSelector(".wxs");
    if (await page.locator('.tl[data-scr="weather"]').count()) throw new Error("the old Weather tile is still on Today too");
    await page.click(".wxs"); await page.waitForSelector(".scrbar");
    if (!(await page.$("#wx-city"))) await page.click('[data-act="wxchange"]');
    await page.fill("#wx-city", "Testville"); await page.click('[data-act="wxcity"]'); await page.waitForSelector(".wx-t", {timeout: 10000});
    await back(); await tab("today"); await page.waitForSelector(".wxs .wxs-t");
    const t = (await page.innerText(".wxs")).replace(/\s+/g, " ");
    if (!/64°/.test(t) || !/Clear/.test(t) || !/Best time to run: tomorrow 6–9 AM/.test(t)) throw new Error("weather line wrong: " + t);
    await noOverflow(); await shot("03-today-weather");
    await page.reload({waitUntil: "networkidle"}); await page.waitForSelector(".wxs .wxs-t", {timeout: 8000});   // a saved forecast shows straight away after reopening
    return t;
  } finally { await page.unroute("**/geocoding-api.open-meteo.com/**", geo); await page.unroute("**/api.open-meteo.com/**", fc); if (await page.$('[data-act="back"]')) await back(); }
}, {needs: "Build a plan (4 steps)"});
await check("Ask bar: shows only when the server says so; ask, confirm a move, put it back", async () => {
  await tab("today"); await page.waitForSelector(".hub-hero");
  // released Nov 17: the bar shows exactly when /api/me says features.ask (coach set up, feature not held in preview)
  const [meResp] = await Promise.all([page.waitForResponse(r => /\/api\/me$/.test(r.url()) && r.request().method() === "GET" && r.ok(), {timeout: 20000}).catch(() => null), page.reload({waitUntil: "networkidle"})]);
  await page.waitForSelector("#tabbar:not([hidden])", {timeout: 15000}); await tab("today"); await page.waitForSelector(".hub-hero");
  const meJson = meResp ? await meResp.json().catch(() => null) : null, says = meJson ? !!(meJson.features && meJson.features.ask) : null;
  const shown = await page.locator("#askbar").isVisible();
  if (says !== null && shown !== says) throw new Error("the server says the ask bar is " + (says ? "on" : "off") + " for this account but the app " + (shown ? "shows" : "hides") + " it");
  // Switch the preview on for this account in the app's view only, with a stand-in coach (no AI call, nothing leaves the test).
  await tab("plan"); await page.waitForSelector(".day-h .mvb");
  const from = await page.evaluate(() => { const today = HP.isoLocal(new Date()); return [...document.querySelectorAll(".day-h .mvb")].map(b => b.dataset.date).filter(d => d > today)[0] || null; });
  if (!from) throw new Error("no future day to move in the test plan");
  const to = await page.evaluate(d => HP.addDays(d, 1), from), asked = [];
  const me = async route => { const r = await route.fetch(); const j = await r.json(); j.features = {ask: true}; await route.fulfill({response: r, json: j}); };
  const coach = async route => { const b = route.request().postDataJSON(); asked.push(b);
    await route.fulfill({json: {answer: "Done thinking: moving it a day keeps your long run fresh.", actions: [{type: "move", from, to}, {type: "open", screen: "fuel"}]}}); };
  await page.route("**/api/me", me); await page.route("**/api/ask", coach);
  try {
    await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar"); await tab("today");
    await page.waitForSelector("#askbar:visible");
    const gap = await page.evaluate(() => { const a = document.querySelector("#askbar").getBoundingClientRect(), t = document.querySelector("#tabbar .tb-today").getBoundingClientRect(); return Math.round(t.top - a.bottom); });
    if (gap < 2) throw new Error("the ask bar overlaps the Today button (gap " + gap + "px)");
    await noOverflow(); await shot("03-ask-bar", true);
    await page.click("#askbar"); await page.waitForSelector(".sheet.asks #ask-q");
    if (!(await page.locator('.ask-chips button:has-text("How is my readiness score worked out?")').count())) throw new Error("the 'how did you work this out' starter questions are missing");
    await page.fill("#ask-q", "Can you move that workout a day later?"); await page.press("#ask-q", "Enter");
    await page.waitForSelector(".ask-acts .btn");
    if (asked[0].q !== "Can you move that workout a day later?") throw new Error("the question sent was: " + JSON.stringify(asked[0]));
    const labels = await page.locator(".ask-acts .btn").allInnerTexts();
    if (labels.length !== 2 || !/^Move /.test(labels[0]) || !/^Open Fuel and food$/.test(labels[1])) throw new Error("action buttons: " + labels.join(" | "));
    await shot("03-ask-sheet", true);
    await page.click(".ask-acts .btn >> nth=0"); await page.waitForSelector(".toast");
    const t1 = await page.innerText(".toast"); if (!/swapped|moved/i.test(t1)) throw new Error("after the move button: " + t1);
    if (await page.$(".sheet.asks")) throw new Error("the coach sheet stayed open after the move");
    // ask again: the thread is still there, and the same move now puts the days back
    await page.click("#askbar"); await page.waitForSelector(".sheet.asks .ask-m.u");
    if (!/✓/.test(await page.innerText(".ask-acts"))) throw new Error("the finished change is not marked as done");
    await page.fill("#ask-q", "Put it back please"); await page.press("#ask-q", "Enter");
    await page.waitForFunction(() => document.querySelectorAll(".ask-acts").length === 2);
    if (!asked[1].history || asked[1].history.length < 2) throw new Error("the follow-up went without the earlier messages");
    await page.click(".ask-acts >> nth=1 >> .btn >> nth=0"); await page.waitForFunction(() => /Put back/.test((document.querySelector(".toast") || {}).textContent || ""));
    // a screen button opens that screen
    await page.click("#askbar"); await page.waitForSelector(".sheet.asks"); await page.click('.ask-acts >> nth=1 >> .btn >> text=Open Fuel and food'); await page.waitForSelector(".scrbar");
    if (await page.locator("#askbar").isVisible()) throw new Error("the ask bar shows on top of a detail screen");
    await back();
    return labels[0];
  } finally {
    await page.unroute("**/api/me", me); await page.unroute("**/api/ask", coach); await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar");
  }
}, {needs: "Build a plan (4 steps)"});
await check("Ask bar stress: hostile replies, bad buttons, a burst of taps, 14 random moves, a dead network, a tiny screen", async () => {
  // The coach is a stand-in that this check controls, so it can send things a real reply never should.
  let reply = {answer: "ok", actions: []}, calls = 0, dead = false, step = "start";
  const me = async route => { const r = await route.fetch(); const j = await r.json(); j.features = {ask: true}; await route.fulfill({response: r, json: j}); };
  const coach = async route => { calls++; if (dead) return route.abort(); await route.fulfill({json: typeof reply === "function" ? reply(route.request().postDataJSON()) : reply}); };
  // send a question and wait for its answer (counting bubbles would stall once the conversation reaches its 40-message limit)
  const say = async q => { const c = calls; await page.fill("#ask-q", q); await page.press("#ask-q", "Enter"); for (let i = 0; i < 100 && calls === c; i++) await page.waitForTimeout(50);
    await page.waitForFunction(() => !document.querySelector(".ask-m.busy") && document.querySelector("#ask-q") && !document.querySelector('.ask-f button[disabled]')); };
  const openSheet = async () => { if (!(await page.$(".sheet.asks"))){ await page.click("#askbar"); await page.waitForSelector(".sheet.asks #ask-q"); } };
  const closeSheet = async () => { if (await page.$(".sheet.asks")){ await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector(".sheet.asks")); } };
  const planText = async () => { await closeSheet(); await tab("plan"); await page.waitForSelector(".day-h"); const t = await page.evaluate(() => [...document.querySelectorAll(".card.day")].slice(0, 21).map(d => d.id + ":" + [...d.querySelectorAll(".sess-t, h3, .s-title")].map(x => x.textContent.trim()).join("+")).join("|")); await tab("today"); return t; };
  await page.route("**/api/me", me); await page.route("**/api/ask", coach);
  try {
    await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#askbar:visible");
    const before = await planText();
    await openSheet();
    step = "part 1";
    // 1. markup and script in a reply are shown as text, never run
    reply = {answer: '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</scr' + 'ipt><b>bold</b> ' + "x".repeat(320) + " " + "Long answer. ".repeat(400), actions: []};
    await say("show me markup");
    const inj = await page.evaluate(() => ({pwn: window.__pwn || 0, tags: document.querySelectorAll(".ask-log img, .ask-log script, .ask-log b").length, text: document.querySelector(".ask-m.a").textContent.slice(0, 20)}));
    if (inj.pwn || inj.tags || !inj.text.startsWith("<img")) throw new Error("markup from a reply was not shown as plain text: " + JSON.stringify(inj));
    await noOverflow();
    if (!(await page.locator("#ask-q").isVisible()) || !(await page.locator('.ask-f button[type="submit"]').isVisible())) throw new Error("a very long answer pushed the message box off the screen");
    step = "part 2";
    // 2. buttons the app should never offer
    const today = await page.evaluate(() => HP.isoLocal(new Date()));
    reply = {answer: "Bad buttons.", actions: [{type: "open", screen: "members"}, {type: "move", from: "2020-01-01", to: "2020-01-02"}]}; await say("bad buttons 1");
    reply = {answer: "More bad buttons.", actions: [{type: "delete_account"}, {type: "change", date: "1999-01-01"}, {type: "open", screen: "set-account"}, {type: "open", screen: "fuel"}]}; await say("bad buttons 2");
    reply = {answer: "Junk.", actions: [null, 7, "move", {type: "move", from: {a: 1}, to: ["x"]}]}; await say("bad buttons 3");
    reply = {answer: "Not a list.", actions: {type: "open", screen: "fuel"}}; await say("bad buttons 4");
    const offered = await page.locator(".ask-acts .btn").allInnerTexts();
    if (offered.length) throw new Error("a button was offered for something that is not allowed: " + offered.join(" | "));
    step = "part 3";
    // 3. five taps on Send in a row: one question goes out
    reply = {answer: "Once.", actions: []}; const c0 = calls;
    await page.fill("#ask-q", "tap tap tap"); for (let i = 0; i < 5; i++) await page.press("#ask-q", "Enter").catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".ask-m.busy")); await page.waitForTimeout(300);
    if (calls - c0 !== 1) throw new Error("5 quick taps sent " + (calls - c0) + " questions");
    step = "part 4";
    // 4. 14 random moves: any button that is offered must work, and putting it back must work, every time
    let tried = 0, done = 0;
    for (let k = 0; k < 14; k++){
      const from = await page.evaluate(([d, n]) => HP.addDays(d, n), [today, 1 + (k * 5) % 9]), to = await page.evaluate(([d, n]) => HP.addDays(d, n), [from, [1, -1, 2, 3, -2, 6, 7][k % 7]]);
      step = "part 4, move " + k + " (" + from + " to " + to + ")"; reply = {answer: "Move " + k + ".", actions: [{type: "move", from, to}]};
      await openSheet();
      await say("move " + k); tried++;
      const btn = page.locator(".ask-acts").last().locator(".btn");
      if (!(await btn.count())) continue;                                   // not allowed on this plan: correctly not offered
      step += " tap the move"; await btn.first().click(); await page.waitForFunction(() => !document.querySelector(".sheet.asks"));
      const t1 = (await page.innerText(".toast")).trim(); if (/can't move|Too many/i.test(t1)) throw new Error("an offered move (" + from + " to " + to + ") was refused when tapped: " + t1);
      step += ", reopen"; await openSheet(); step += ", ask to undo"; await say("undo " + k);
      const undo = page.locator(".ask-acts").last().locator(".btn"); if (!(await undo.count())) throw new Error("no way offered to put " + from + " and " + to + " back");
      step += ", tap undo"; await undo.first().click(); await page.waitForFunction(() => /Put back/.test((document.querySelector(".toast") || {}).textContent || "")); done++;
    }
    if (done < 3) throw new Error("only " + done + " of " + tried + " random moves were possible: the check proved too little");
    const after = await planText();
    if (after !== before) throw new Error("after " + done + " moves each put back, the plan is not the same as before");
    step = "part 5";
    // 5. the network dies mid-question: a plain message, and the typed words are kept
    await openSheet();
    dead = true; await page.fill("#ask-q", "are you still there"); await page.press("#ask-q", "Enter"); await page.waitForSelector(".sheet.asks .err");
    if ((await page.inputValue("#ask-q")) !== "are you still there") throw new Error("the typed question was lost when the network failed");
    dead = false;
    step = "part 6";
    // 6. a long conversation stays bounded, and Escape closes the sheet without losing it
    reply = {answer: "Short.", actions: []}; for (let i = 0; i < 12; i++) await say("more " + i);
    const bubbles = await page.locator(".ask-m:not(.busy)").count(); if (bubbles > 40) throw new Error("the conversation grew to " + bubbles + " messages (40 is the limit)");
    await closeSheet(); await openSheet(); await page.waitForSelector(".sheet.asks .ask-m");
    step = "part 7";
    // 7. a 320px phone: nothing runs off the side, the box and Send are on screen
    const vp = page.viewportSize(); await page.setViewportSize({width: 320, height: 568});
    try { await noOverflow(); const box = await page.locator('.ask-f button[type="submit"]').boundingBox(); if (!box || box.x + box.width > 321 || box.y + box.height > 569) throw new Error("Send is off the screen on a small phone: " + JSON.stringify(box)); }
    finally { await page.setViewportSize(vp); }
    return done + " of " + tried + " random moves made and put back; plan unchanged";
  } catch(e){ if (process.env.ASK_DEBUG){ await page.screenshot({path: process.env.ASK_DEBUG}).catch(() => {}); console.log("ASK_DEBUG step=" + step + " | " + await page.evaluate(() => { const b = document.querySelector(".back"), t = document.querySelector(".toast"), a = document.querySelector("#askbar"); return (b ? "sheet " + b.firstElementChild.className : "no sheet") + ", askbar " + (a && !a.hidden ? "shown" : "hidden") + ", toast: " + (t ? t.textContent : "none") + ", " + (document.querySelector(".scrbar") ? "detail screen" : "tab") + ", bubbles " + document.querySelectorAll(".ask-m").length + ", last acts: " + ([...document.querySelectorAll(".ask-acts")].pop() || {textContent: "-"}).textContent.slice(0, 160); }).catch(x => "eval failed " + x.message)); }
    e.message = step + ": " + e.message; throw e;
  } finally {
    await page.unroute("**/api/me", me); await page.unroute("**/api/ask", coach); await page.keyboard.press("Escape").catch(() => {}); await page.reload({waitUntil: "networkidle"}); await page.waitForSelector("#tabbar");
  }
}, {needs: "Build a plan (4 steps)"});
await check("Weigh-in", async () => { await open("weight"); await page.fill("#w-lb", "182.4"); await page.click('[data-act="wsave"]'); await page.waitForSelector(".wrow"); const t = (await page.innerText(".wrow")).replace(/\n/g, " "); await back(); return t; });
await check("Log a workout (with rep pace)", async () => {
  await open("workouts"); await page.click('[data-act="atoggle"]'); await page.selectOption("#a-type", "run"); await page.fill("#a-mi", "5"); await page.fill("#a-min", "44"); await page.click("#a-wp"); await page.keyboard.type("750"); await page.fill("#a-hr", "152");
  await page.click('[data-act="asave"]'); await page.waitForSelector(".fl li.act", {timeout: 15000});
  return (await page.innerText(".fl li.act .fi")).replace(/\n/g, " · ");
});
if (!FAST) await check("AI review after workout", async () => { await page.waitForSelector(".view .coach", {timeout: 40000}); const t = (await page.locator(".view .coach").first().innerText()).split("\n")[0]; return t; }, {needs: "Log a workout (with rep pace)"});
await check("Fuel card counts training", async () => { if (await page.$('[data-act="back"]')) await back(); await open("fuel"); const t = await page.innerText(".left + .macs + p"); if (!/training/.test(t)) throw new Error(t); return t; }, {needs: "Log a workout (with rep pace)"});
if (!FAST) await check("Food by text (AI)", async () => {
  await ensure("#food-text", "fuel"); await page.fill("#food-text", "2 scrambled eggs and a slice of toast"); await page.click('[data-act="fadd"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".card:has(.fdate) .fl li .fi b")].length >= 1, null, {timeout: 40000});
  return (await page.locator(".card:has(.fdate) .fl li .fi b").allInnerTexts()).join(", ");
});
if (!FAST) await check("Food by photo (AI reads a label)", async () => {
  await ensure("#food-text", "fuel"); const before = await page.locator(".card:has(.fdate) .fl li").count();
  await page.setInputFiles("#food-photo", "tests/label.jpg"); await page.waitForSelector(".thumb img", {timeout: 10000}); await page.click('[data-act="fadd"]');
  await page.waitForFunction(n => document.querySelectorAll(".card:has(.fdate) .fl li").length > n, before, {timeout: 45000});
  return (await page.locator(".card:has(.fdate) .fl li .fi b").allInnerTexts()).slice(-1)[0];
});
await check("Food by hand, for yesterday", async () => {
  await ensure("#food-text", "fuel"); await page.click('[data-act="fday"][data-dir="-1"]'); await page.click('[data-act="fmanual"]').catch(() => {});
  await page.fill("#m-name", "Pasta"); await page.fill("#m-cal", "700"); await page.fill("#m-protein", "25"); await page.click('[data-act="fsave"]');
  await page.waitForSelector(".card:has(.fdate) .fl li >> text=Pasta", {timeout: 15000}); const d = await page.innerText(".fdate"); await page.click('[data-act="fday"][data-dir="1"]'); return d.replace(/\n/g, " ");
});
await check("Eaten shows on fuel card", async () => { await ensure("#food-text", "fuel"); const t = await page.innerText(".left .sub"); if (/^0 eaten/.test(t) && !FAST) throw new Error(t); await shot("03-fuel"); await back(); return t; }, FAST ? undefined : {needsOne: ["Food by text (AI)", "Food by photo (AI reads a label)"]});
await check("Plan tab", async () => {
  await tab("plan"); await noOverflow(); const n = await page.locator(".day").count(); if (n !== 7) throw new Error(n + " day cards");
  await page.click('[data-act="wk"][data-dir="1"]'); await page.waitForTimeout(200); const tips = await page.locator(".fueltip").count(); await shot("04-plan"); return n + " days · " + tips + " fuel tips next week";
});
await check("Recovery tab", async () => { await tab("recovery"); await noOverflow(); await page.waitForSelector(".rings"); await shot("05-recovery"); return (await page.innerText(".verdict b")); });
await check("Progress tab", async () => { await tab("training"); await noOverflow(); await page.waitForSelector(".prog-top"); if ((await page.locator(".pc").count()) < 6) throw new Error("progress cards missing"); await page.click('[data-act="pwk"][data-i="10"]'); await page.waitForTimeout(150); await shot("06-progress"); const cards = [];
  for (const k of ["races", "paces", "miles", "body", "setup"]){ await open("t-" + k); await noOverflow(); cards.push(...await page.locator(".card-h .lbl").allInnerTexts()); await back(); } for (const need of ["Race predictions", "Your training paces", "Weekly miles", "Calories · last 7 days", "Calorie check · 14 days"]) if (!cards.some(c => c.toLowerCase() === need.toLowerCase())) throw new Error("missing " + need); return cards.length + " cards"; });
await check("Activities tab (feed + detail)", async () => {
  await tab("activities"); await noOverflow(); await page.waitForSelector(".actc", {timeout: 5000}); const n = await page.locator(".actc").count(); await shot("06b-activities");
  await page.click(".actc >> nth=0"); await page.waitForSelector(".adet-h", {timeout: 5000}); const t = await page.innerText(".adet-h h1"); await noOverflow(); await shot("06c-activity");
  await page.click('[data-act="actback"]'); await page.waitForSelector(".afilt");
  return n + " activit" + (n === 1 ? "y" : "ies") + " · opened " + t;
}, {needs: "Log a workout (with rep pace)"});
await check("Today overview", async () => {
  await tab("today"); const order = await page.$$eval("#app .view > *", els => els.map(e => e.classList.contains("ci-done") ? "readiness" : e.dataset.scr || e.className));
  const ci = order.indexOf("readiness"), fu = order.indexOf("fuel"), wo = order.findIndex(x => /\bsession\b/.test(x));
  if (ci < 0 || fu < 0 || (wo >= 0 && !(ci < wo && wo < fu))) throw new Error(order.join(" > "));   // today's workout comes before food (Nov 15)
  for (const sc of ["workouts", "weight"]) if (!(await page.locator('.tl[data-scr="' + sc + '"]').count())) throw new Error("missing " + sc + " tile");
  if (!(await page.locator('.hello .wxs[data-scr="weather"]').count())) throw new Error("the weather line under the greeting is missing");   // Nov 16
  await noOverflow(); await shot("08-today-overview"); return "greeting + weather → check-in → workout → fuel → tiles";
});
await check("Settings: Watch", async () => {
  await settings(); await shot("07-settings"); await open("set-watch"); const t = await page.innerText(".apps");
  const strava = await page.locator('[data-act="stconnect"]').count(); await back(); await back();
  if (!/Apple Health/.test(t) || !/Strava/.test(t) || !/Garmin/.test(t)) throw new Error(t.slice(0, 120)); if (!strava) throw new Error("Connect Strava button missing"); return "Strava + sleep/heart rate shown";
});
await check("Meal prep, barcode and crews screens", async () => {
  await tab("today"); await open("fuel"); if (!(await page.locator("#food-barcode").count())) throw new Error("no barcode button");
  await open("meals"); const m = await page.innerText("#app"); await back(); await back();
  if (!/Make (my|a meal prep) plan|Make a new plan/.test(m)) throw new Error(m.slice(0, 120));
  await tab("activities"); await open("crews"); const c = await page.innerText("#app"); await back();
  if (!/nickname/i.test(c) || !/never|Nothing else/i.test(c)) throw new Error(c.slice(0, 120)); await noOverflow(); return "meal prep form, barcode button, private crews";
});
await check("More tab and FAQ", async () => {
  await tab("more"); await noOverflow(); const t = await page.innerText("#app"); if (!/Find a race/.test(t) || !/Change goal/.test(t)) throw new Error(t.slice(0, 160));
  await open("faq"); const n = await page.locator(".faq details").count(); await back(); await tab("today"); if (n < 5) throw new Error("FAQ has " + n + " questions"); return n + " FAQ questions";
});
await check("Your invite link (link + joined count, no names)", async () => {
  await tab("more"); await open("invites"); await page.waitForSelector(".invbig", {timeout: 10000}); const t = await page.innerText("#app");
  if (!/\?ref=[a-f0-9]{8}/.test(t) || !/Joined through your link/.test(t)) throw new Error(t.slice(0, 160)); const n = await page.innerText(".invbig"); await back(); await tab("today"); return n + " joined";
});
await check("Edit profile", async () => {
  await settings(); await open("set-acct"); await open("set-profile"); await page.fill("#pf-name", "Nightly Two"); await page.fill("#pf-gw", "174"); await page.click('[data-act="pfsave"]');
  await page.waitForSelector(".scrbar >> text=Account and profile", {timeout: 10000}); await back(); await page.waitForSelector(".me-card >> text=Nightly Two", {timeout: 10000}); await back(); await tab("today"); const h = await page.innerText(".hello h1"); if (!/Nightly Two/.test(h)) throw new Error(h); return h;
});
await check("Heart rate zones", async () => {
  await settings(); await open("set-train"); await open("set-hr"); await page.click('[data-act="hrm"][data-m="lthr"]'); await page.fill("#hr-base", "172"); await page.click('[data-act="hrsave"]');
  await page.waitForSelector(".scrbar >> text=Coaching and training", {timeout: 10000}); const t = await page.innerText('[data-scr="set-hr"]'); await back(); await back();
  if (!/172/.test(t)) throw new Error(t); return t.replace(/\n/g, " ");
});
await check("Report a problem", async () => {
  await settings(); await open("set-help"); await open("set-report"); await page.fill("#rp-text", "Nightly test report. Please ignore.");
  await page.click('[data-act="rpsend"]'); await page.waitForSelector(".view >> text=Thanks, got it", {timeout: 15000}); await back(); await back(); await back(); return "sent";
});
await check("Settings: notifications", async () => {
  await settings(); await open("set-notif"); await page.waitForSelector(".nset", {timeout: 5000}); const t = await page.innerText(".nset"); await back(); await back();
  if (/being set up/i.test(t)) throw new Error("server has no notification key");
  return "notifications: " + (/Turn on notifications/.test(t) ? "offered" : /blocked/.test(t) ? "offered (this test browser blocks them)" : t.replace(/\n/g, " ").slice(0, 80));
});
await check("Glitch scan: every screen fits the phone, tab bar never covered", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({status: 200, contentType: "image/png", body: png}));   // real map layers, no outside wait
  const bad = [];
  const settle = () => page.waitForFunction(() => !document.documentElement.dataset.nav, null, {timeout: 3000}).catch(() => {});   // screen-change animation finished
  const covered = async () => { const n = await probeBar(); if (!n) return 0; await page.waitForTimeout(700); return probeBar(); };   // only a real overlap, not a frame of the screen-change animation
  const probeBar = async () => { await settle(); return page.evaluate(() => { const bar = document.querySelector("#tabbar"); if (!bar || bar.hidden) return 0; const r = bar.getBoundingClientRect();
    return [0.15, 0.35, 0.65, 0.85].reduce((n, fx) => n + [12, 30].filter(dy => { const e = document.elementFromPoint(r.left + r.width * fx, r.top + dy); return e && !e.closest("#tabbar") && !e.closest(".toast"); }).length, 0); }); };
  for (const t of ["today", "plan", "activities", "training", "recovery", "more"]){
    await tab(t); const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 350){ await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(120); const n = await covered(); if (n){ bad.push(t + " tab bar covered at " + y + "px"); break; } }
    const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 392) bad.push(t + " is " + w + "px wide");
  }
  await tab("today");
  const screens = ["fuel", "workouts", "weather", "weight", "settings", "set-acct", "set-train", "set-help", "set-watch", "set-notif", "set-hr", "set-run", "set-profile", "set-about", "t-races", "t-paces", "t-miles", "t-body", "t-setup", "faq", "fuelplan", "meals", "crews"];
  for (const s of screens){
    await page.evaluate(s => { const x = document.createElement("button"); x.dataset.act = "go"; x.dataset.scr = s; x.hidden = true; document.body.appendChild(x); x.click(); x.remove(); }, s);
    await page.waitForTimeout(250);
    const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 392) bad.push(s + " is " + w + "px wide");
    if (await covered()) bad.push(s + " covers the tab bar");
    while (await page.locator('[data-act="back"]').count()){ await page.click('[data-act="back"]'); await page.waitForTimeout(150); }
  }
  await page.unroute(/tile\.openstreetmap\.org/); await tab("today");
  if (bad.length) throw new Error(bad.join("; ")); return "6 tabs scrolled top to bottom, " + screens.length + " screens";
});
await check("Log out and back in (data kept)", async () => {
  await open("fuel"); const before = await page.locator(".card:has(.fdate) .fl li").count(); await back();
  await settings(); await page.click('[data-act="logout"]'); await page.waitForSelector(".welcome h1", {timeout: 10000});
  await page.click('[data-act="authlogin"]'); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
  await page.waitForSelector(".hub-hero", {timeout: 15000}); await page.waitForTimeout(800);
  await open("fuel"); const after = await page.locator(".card:has(.fdate) .fl li").count(); await back(); await open("weight"); const w = failedChecks.has("Weigh-in") ? "not checked (Weigh-in failed)" : await page.innerText(".wrow b"); await back();
  if (after !== before) throw new Error("food items " + before + " → " + after); return after + " food items, weight " + w;
});
await check("Delete account", async () => {
  await settings(); await open("set-acct"); await open("set-account"); await page.click('[data-act="delacct"]'); await page.click('[data-act="delacct"]');
  await page.waitForSelector(".welcome h1", {timeout: 10000});
  await page.click('[data-act="authlogin"]'); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
  await page.waitForSelector("#authform .err:not(:empty)", {timeout: 10000}); return await page.innerText("#authform .err");
});
if (consoleErrors.length) fail("No JavaScript errors", consoleErrors.slice(0, 5).join(" | ")); else ok("No JavaScript errors");
await browser.close();
const summary = "## Hybrid browser test\n\n" + results.map(r => "- " + r).join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log("\n" + (problems.length ? problems.length + " problem(s)" : "All browser checks passed.") + (notRun.length ? " · " + notRun.length + " not run (they continue from a failed check)" : "") + (recoveries ? " · recovered " + recoveries + " time(s)" : ""));
if (problems.length){ for (const p of problems) console.log("::error::" + p); process.exit(1); }
