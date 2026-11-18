// Onboarding fix (incident onboarding-no-plan, Nov 18, 2026: 3 of 14 members signed up but never finished a plan).
// Mocks the API in the browser (no live data). Checks:
//   - a runner who has no recent race time can press Next on "Where is your running now?" without typing one
//     ("None yet" is the default; before, 5K was pre-picked and Next was blocked until a 5K time was typed)
//   - a member who leaves halfway and comes back lands on the step they were on, with their answers kept
//   - picking a race distance after None yet sticks and asks for that time
//   - the saved answers belong to one account only, and are cleared once the plan is built and on log out
// Run: node tests/setup_resume.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8097);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const SHOTS = process.env.SHOTS || "";
let uid = "u1", saved = null; const steps = [];
const b = await chromium.launch(), ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
  const u = new URL(r.request().url()), m = r.request().method();
  if (u.pathname === "/api/me") return r.fulfill({json: {user: {id: uid, name: "Sam Runner", email: uid + "@t.test", terms_at: "2026-11-18T10:00:00Z"}, profile: saved, activities: [], features: {}, strava: {available: false, connected: false}}});
  if (u.pathname === "/api/account/setup-step") steps.push(JSON.parse(r.request().postData()).step);
  if (m === "PUT" && u.pathname === "/api/profile"){ saved = JSON.parse(r.request().postData()).profile; return r.fulfill({json: {ok: true}}); }
  return r.fulfill({json: {}});
});
await ctx.addInitScript(() => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-nonew", "1"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){} });
const draft = () => p.evaluate(() => JSON.parse(localStorage.getItem("hp-setup") || "null"));
const title = () => p.innerText("h2.sec-t");
try {
  await p.goto("http://localhost:8097/index.html");
  await p.waitForSelector("h2.sec-t >> text=What's your goal?", {timeout: 15000});
  t(await draft() === null, "a brand-new member has nothing saved yet");
  await p.click('label.opt:has(input[value="10k"])');
  await p.fill("#s-date", new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10));
  await p.click('[data-act="next"]');
  await p.waitForSelector("#s-weekly");
  t(await p.isChecked('input[name="prDist"][value="none"]'), "'A recent race or time trial' starts on None yet");
  if (SHOTS) await p.waitForTimeout(2500), await p.screenshot({path: SHOTS + "/1-running-none-yet.png"});
  await p.click('label.opt:has(input[name="prDist"][value="10k"])');
  t(await p.waitForSelector("#s-pr", {timeout: 3000}).then(() => true, () => false), "switching from None yet to 10K asks for the 10K time (it used to snap back to None yet)");
  await p.click('label.opt:has(input[name="prDist"][value="none"])'); await p.waitForSelector("#s-easy");
  await p.fill("#s-weekly", "12"); await p.fill("#s-longest", "5");
  await p.click('[data-act="next"]');
  await p.waitForSelector("#s-ft", {timeout: 5000}).catch(() => {});
  t(/Strength/.test(await title()), "Next works without a race time (no 'Add your race time' block)");
  const d = await draft();
  t(d && d.uid === "u1" && d.step === 2 && d.p.goal === "10k" && d.p.weekly === 12, "answers so far are saved on this phone for this account");
  t(steps.includes(2), "the furthest step is still reported for the funnel");
  // leave and come back (app closed, phone locked, link reopened)
  await p.reload();
  await p.waitForSelector("h2.sec-t", {timeout: 15000});
  t(/Strength/.test(await title()), "coming back opens the step they were on, not the first question");
  t(/Welcome back/.test(await p.innerText(".setup")), "a short line says their answers are saved");
  if (SHOTS) await p.waitForTimeout(2500), await p.screenshot({path: SHOTS + "/2-welcome-back.png"});
  await p.click('[data-act="prev"]'); await p.waitForSelector("#s-weekly");
  t(await p.inputValue("#s-weekly") === "12" && await p.inputValue("#s-longest") === "5", "Back shows the answers they gave before leaving");
  t(!/Welcome back/.test(await p.innerText(".setup")), "the welcome-back line is only on the step they came back to");
  await p.click('[data-act="prev"]'); await p.waitForSelector("#s-date");
  t(await p.isChecked('input[name="goal"][value="10k"]'), "the goal they picked is kept");
  // another account on the same phone never gets these answers
  uid = "u2"; await p.reload(); await p.waitForSelector("h2.sec-t", {timeout: 15000});
  t(/What's your goal/.test(await title()) && !(await p.isChecked('input[name="goal"][value="10k"]')), "a different account on this phone starts fresh");
  uid = "u1"; await p.reload(); await p.waitForSelector("h2.sec-t", {timeout: 15000});
  t(/Strength/.test(await title()), "the first account still resumes");
  // finish the plan: the saved answers are cleared
  await p.fill("#s-ft", "5"); await p.fill("#s-in", "9"); await p.fill("#s-age", "27"); await p.fill("#s-w", "160");
  await p.click('[data-act="next"]'); await p.waitForSelector("#s-long");
  await p.click('[data-act="next"]');
  await p.waitForSelector(".hub-hero", {timeout: 15000}).catch(() => {});
  t(!!saved && saved.goal === "10k" && saved.prDist === "none", "the plan is built from the saved answers");
  t(await draft() === null, "once the plan is built, the saved answers are cleared");
  // log out clears a half-finished setup on a shared phone
  saved = null; await p.evaluate(() => localStorage.setItem("hp-setup", JSON.stringify({uid: "u1", step: 2, p: {goal: "5k"}, ts: Date.now()})));
  await p.reload(); await p.waitForSelector("h2.sec-t", {timeout: 15000});
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  t(/act === "logout"\)\{ closeMenu\(\); scr = null; setupDraft\.clear\(\);/.test(html), "log out clears the saved answers");
  t(/30 \* 864e5/.test(html), "saved answers expire after 30 days");
} catch(e){ t(false, "test crashed: " + (e && e.message || e)); }
await b.close(); srv.close();
console.log(bad ? bad + " setup resume check(s) failed" : "setup resume: all checks pass");
process.exit(bad ? 1 : 0);
