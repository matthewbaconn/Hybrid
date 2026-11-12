// Real-browser test of every screen of Hybrid. Runs against the live site and live API by default.
//   SITE=https://matthewbaconn.github.io/Hybrid/ node tests/e2e.mjs
// Uses a throwaway account (deleted at the end) and the real AI, weather and database.
import { chromium } from "playwright";
import fs from "fs";
const SITE = process.env.SITE || "https://matthewbaconn.github.io/Hybrid/";
const SHOTS = process.env.SHOTS || "e2e-shots";
const FAST = !!process.env.LOCAL;          // local runs: no internet weather/AI waits
fs.mkdirSync(SHOTS, {recursive: true});
const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const results = [], problems = [];
let step = "";
const ok = (name, detail) => { results.push("✅ " + name + (detail ? " — " + detail : "")); console.log("ok   " + name + (detail ? " — " + detail : "")); };
const fail = (name, detail) => { problems.push(name + ": " + detail); results.push("❌ " + name + " — " + detail); console.log("FAIL " + name + " — " + detail); };
async function check(name, fn){ step = name; try { const d = await fn(); ok(name, d); } catch(e){ fail(name, String(e && e.message || e).split("\n")[0].slice(0, 300)); } }

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: iPhone, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", e => consoleErrors.push("[" + step + "] " + e.message));
page.on("console", m => { if (m.type() === "error" && !/fonts\.g|favicon|ERR_NAME|net::ERR_FAILED.*open-meteo/.test(m.text()) && !(step === "Delete account" && /401/.test(m.text()))) consoleErrors.push("[" + step + "] " + m.text()); });
const shot = n => page.screenshot({path: SHOTS + "/" + n + ".png", fullPage: true});
const tab = async t => { await page.click('#tabbar [data-tab="' + t + '"]'); await page.waitForTimeout(400); };
const noOverflow = async () => { const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 392) throw new Error("page is " + w + " px wide at 390 (sideways scroll)"); };
const email = "e2e-" + Date.now() + "@example.com", pass = "nightly-check-" + Math.random().toString(36).slice(2, 8);

await check("Site loads", async () => { await page.goto(SITE, {waitUntil: "networkidle"}); await page.waitForSelector(".welcome h1", {timeout: 15000}); await noOverflow(); await shot("01-welcome"); return await page.title(); });
await check("Get app guide (iPhone)", async () => { await page.click('[data-act="getapp"]'); await page.waitForSelector(".sheet.inst"); const t = await page.innerText(".sheet.inst"); await page.click('.sheet [data-act="close"]'); if (!/Add to Home Screen/.test(t)) throw new Error("guide text missing"); });
await check("Sample runner", async () => {
  await page.click('[data-act="sample"]'); await page.waitForSelector(".hero"); for (const t of ["plan", "recovery", "training", "today"]){ await tab(t); await noOverflow(); }
  await page.click('[data-act="menu"]'); await page.waitForSelector(".sheet"); await page.click('.sheet [data-act="authsignup"]'); await page.waitForSelector("#authform");
});
await check("Sign up", async () => { await page.fill("#a-name", "Nightly"); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]'); await page.waitForSelector("h2.sec-t >> text=What are you training for?", {timeout: 15000}); });
await check("Build a plan (4 steps)", async () => {
  await page.click('label.opt:has(input[value="half"])');
  const race = new Date(Date.now() + 84 * 864e5).toISOString().slice(0, 10);
  await page.fill("#s-date", race); await page.click("#s-goal"); await page.keyboard.type("14500");
  if (await page.inputValue("#s-goal") !== "1:45:00") throw new Error("goal time didn't format: " + await page.inputValue("#s-goal"));
  await page.click('[data-act="next"]');
  await page.fill("#s-weekly", "22"); await page.fill("#s-longest", "8"); await page.click('label.opt:has(input[name="prDist"][value="10k"])'); await page.click("#s-pr"); await page.keyboard.type("4830");
  await page.click('[data-act="next"]'); await page.click('label.opt:has(input[name="lifts"][value="3"])'); await page.fill("#s-w", "182"); await page.fill("#s-gw", "175");
  await page.click('[data-act="next"]'); await page.click('[data-act="next"]');
  await page.waitForSelector(".hero", {timeout: 15000}); await noOverflow(); await shot("02-today");
  return await page.innerText(".hero .sess-t").catch(() => "rest day");
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
if (!FAST) await check("Weather + best time to run", async () => {
  await page.fill("#wx-city", "Vero Beach"); await page.click('[data-act="wxcity"]');
  await page.waitForSelector(".wx-t", {timeout: 20000});
  const best = await page.$(".wx-best"); return (await page.innerText(".wx-t")) + " in " + (await page.innerText(".wx-c span")) + (best ? " · " + (await best.innerText()).replace(/\n/g, " ") : "");
});
await check("Weigh-in", async () => { await page.fill("#w-lb", "182.4"); await page.click('[data-act="wsave"]'); await page.waitForSelector(".wrow"); return (await page.innerText(".wrow")).replace(/\n/g, " "); });
await check("Log a workout (with rep pace)", async () => {
  await page.click('[data-act="atoggle"]'); await page.selectOption("#a-type", "run"); await page.fill("#a-mi", "5"); await page.fill("#a-min", "44"); await page.click("#a-wp"); await page.keyboard.type("750"); await page.fill("#a-hr", "152");
  await page.click('[data-act="asave"]'); await page.waitForSelector(".fl li.act", {timeout: 15000});
  return (await page.innerText(".fl li.act .fi")).replace(/\n/g, " · ");
});
await check("Fuel card counts training", async () => { const t = await page.innerText(".left + .macs + p"); if (!/training/.test(t)) throw new Error(t); return t; });
if (!FAST) await check("AI review after workout", async () => { await page.waitForSelector(".coach >> nth=1", {timeout: 40000}); return (await page.locator(".coach").nth(1).innerText()).split("\n")[0]; });
if (!FAST) await check("Food by text (AI)", async () => {
  await page.fill("#food-text", "2 scrambled eggs and a slice of toast"); await page.click('[data-act="fadd"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".card:has(.fdate) .fl li .fi b")].length >= 1, null, {timeout: 40000});
  return (await page.locator(".card:has(.fdate) .fl li .fi b").allInnerTexts()).join(", ");
});
if (!FAST) await check("Food by photo (AI reads a label)", async () => {
  const before = await page.locator(".card:has(.fdate) .fl li").count();
  await page.setInputFiles("#food-photo", "tests/label.jpg"); await page.waitForSelector(".thumb img", {timeout: 10000}); await page.click('[data-act="fadd"]');
  await page.waitForFunction(n => document.querySelectorAll(".card:has(.fdate) .fl li").length > n, before, {timeout: 45000});
  return (await page.locator(".card:has(.fdate) .fl li .fi b").allInnerTexts()).slice(-1)[0];
});
await check("Food by hand, for yesterday", async () => {
  await page.click('[data-act="fday"][data-dir="-1"]'); await page.click('[data-act="fmanual"]').catch(() => {});
  await page.fill("#m-name", "Pasta"); await page.fill("#m-cal", "700"); await page.fill("#m-protein", "25"); await page.click('[data-act="fsave"]');
  await page.waitForSelector(".card:has(.fdate) .fl li >> text=Pasta", {timeout: 15000}); const d = await page.innerText(".fdate"); await page.click('[data-act="fday"][data-dir="1"]'); return d.replace(/\n/g, " ");
});
await check("Eaten shows on fuel card", async () => { const t = await page.innerText(".left .sub"); if (/^0 eaten/.test(t) && !FAST) throw new Error(t); await shot("03-today-logged"); return t; });
await check("Plan tab", async () => {
  await tab("plan"); await noOverflow(); const n = await page.locator(".day").count(); if (n !== 7) throw new Error(n + " day cards");
  await page.click('[data-act="wk"][data-dir="1"]'); await page.waitForTimeout(200); const tips = await page.locator(".fueltip").count(); await shot("04-plan"); return n + " days · " + tips + " fuel tips next week";
});
await check("Recovery tab", async () => { await tab("recovery"); await noOverflow(); await page.waitForSelector(".rings"); await shot("05-recovery"); return (await page.innerText(".verdict b")); });
await check("Training tab", async () => { await tab("training"); await noOverflow(); const cards = await page.locator(".card-h .lbl").allInnerTexts(); await shot("06-training"); for (const need of ["Race predictions", "Your training paces", "Weekly miles", "Calories · last 7 days", "Calorie check · 14 days"]) if (!cards.some(c => c.toLowerCase() === need.toLowerCase())) throw new Error("missing " + need); return cards.length + " cards"; });
await check("Activities tab (feed + detail)", async () => {
  await tab("activities"); await noOverflow(); await page.waitForSelector(".actc", {timeout: 5000}); const n = await page.locator(".actc").count(); await shot("06b-activities");
  await page.click(".actc >> nth=0"); await page.waitForSelector(".adet-h", {timeout: 5000}); const t = await page.innerText(".adet-h h1"); await noOverflow(); await shot("06c-activity");
  await page.click('[data-act="actback"]'); await page.waitForSelector(".afilt");
  return n + " activit" + (n === 1 ? "y" : "ies") + " · opened " + t;
});
await check("Fuel + food at the top after check-in", async () => {
  await tab("today"); const order = await page.$$eval("#app .view > section, #app .view > article", els => els.map(e => e.classList.contains("ci-done") ? "readiness" : (e.querySelector(".card-h .lbl") || {}).textContent || ""));
  const ci = order.findIndex(x => /readiness/i.test(x)), fu = order.findIndex(x => /fuel today/i.test(x));
  if (ci < 0 || fu !== ci + 1) throw new Error(order.join(" > ")); if (!(await page.locator(".card:has(.left) .food-in").count())) throw new Error("food log not inside the fuel card");
  return "readiness → fuel + food log";
});
await check("Settings: Garmin + Apple Health", async () => {
  await page.click('[data-act="menu"]'); await page.waitForSelector(".sheet .hlink", {timeout: 5000}); const t = await page.innerText(".sheet .hlink"); await page.click('.sheet [data-act="close"]');
  if (!/Apple Health/.test(t) || !/Strava/.test(t)) throw new Error(t.slice(0, 120)); return "shown";
});
await check("Report a problem", async () => {
  await page.click('[data-act="menu"]'); await page.click('.sheet [data-act="rpopen"]'); await page.fill("#rp-text", "Nightly test report. Please ignore.");
  await page.click('[data-act="rpsend"]'); await page.waitForSelector(".sheet >> text=Thanks, got it", {timeout: 15000}); await page.click('.sheet [data-act="close"]'); return "sent";
});
await check("Settings: notifications + Strava", async () => {
  await tab("today"); await page.click('[data-act="menu"]'); await page.waitForSelector(".sheet .nset", {timeout: 5000}); const t = await page.innerText(".sheet .nset"); await shot("07-settings"); await page.click('.sheet [data-act="close"]');
  const strava = await page.locator('[data-act="stconnect"]').count(); if (!strava) throw new Error("Connect Strava button missing");
  if (/being set up/i.test(t)) throw new Error("server has no notification key");
  return "notifications: " + (/Turn on notifications/.test(t) ? "offered" : /blocked/.test(t) ? "offered (this test browser blocks them)" : t.replace(/\n/g, " ").slice(0, 80)) + " · Strava button shown";
});
await check("Log out and back in (data kept)", async () => {
  const before = await page.locator(".card:has(.fdate) .fl li").count();
  await page.click('[data-act="menu"]'); await page.click('.sheet [data-act="logout"]'); await page.waitForSelector(".welcome h1", {timeout: 10000});
  await page.click('[data-act="authlogin"]'); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
  await page.waitForSelector(".hero", {timeout: 15000}); await page.waitForTimeout(800);
  const after = await page.locator(".card:has(.fdate) .fl li").count(), w = await page.innerText(".wrow b");
  if (after !== before) throw new Error("food items " + before + " → " + after); return after + " food items, weight " + w;
});
await check("Delete account", async () => {
  await page.click('[data-act="menu"]'); await page.click('.sheet [data-act="delacct"]'); await page.click('.sheet [data-act="delacct"]');
  await page.waitForSelector(".welcome h1", {timeout: 10000});
  await page.click('[data-act="authlogin"]'); await page.fill("#a-email", email); await page.fill("#a-pass", pass); await page.click('#authform [type="submit"]');
  await page.waitForSelector("#authform .err:not(:empty)", {timeout: 10000}); return await page.innerText("#authform .err");
});
if (consoleErrors.length) fail("No JavaScript errors", consoleErrors.slice(0, 5).join(" | ")); else ok("No JavaScript errors");
await browser.close();
const summary = "## Hybrid browser test\n\n" + results.map(r => "- " + r).join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log("\n" + (problems.length ? problems.length + " problem(s)" : "All browser checks passed."));
if (problems.length){ for (const p of problems) console.log("::error::" + p); process.exit(1); }
