// Reminder ask right after the first plan (incident activation-none-trained, Nov 20, 2026: 3 of 13 members with a plan
// have trained; only 2 of 12 plan holders could get a reminder). Before this fix nobody was asked when they built
// their plan; the ask only came on a later open, and a new member's first open showed the whole What's new history
// instead (and kept showing it after a tap outside the sheet), which blocked the ask. Mocks the API in the browser.
// Checks:
//   - building a FIRST plan asks for notifications right away (Allow / Not now)
//   - on an iPhone Safari tab (no web push there) it offers the Home Screen steps instead, and "Show me how" opens them
//   - members asked in the last 3 days (and automated tests that set hy-nask) are not asked again
//   - a new member's first open shows no What's new history, and the notification ask is not blocked by it
//   - an existing member still gets What's new once, and a tap outside the sheet counts as seen
// Run: node tests/first_remind.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const PORT = 8097;
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(PORT);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const URL0 = "http://localhost:" + PORT + "/";
const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
const PROF = {name: "Casey", goal: "half", raceDate: add(today, 84), weekly: 20, longest: 8, prDist: "none", days: [1, 2, 4, 6], longDay: 6, lifts: 0, liftExp: "Some", weight: 170, start: add(today, -3), built: add(today, -3), pv: 1};
const b = await chromium.launch();
// one browser context per case; init = localStorage to set before the app loads, iphone = Safari tab without web push
async function open({profile, init = {}, iphone = false}){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, ...(iphone ? {userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"} : {})});
  await ctx.addInitScript(([init, iphone]) => { try { localStorage.setItem("hp-token", "test"); for (const k in init) if (localStorage.getItem(k) == null) localStorage.setItem(k, init[k]); /* first load only: a reload keeps what the app saved */ } catch(e){}
    if (iphone){ try { delete window.PushManager; } catch(e){} }
    // headless Chromium reports "denied"; a phone that was never asked reports "default"
    else try { Object.defineProperty(Notification, "permission", {get: () => "default"}); } catch(e){} }, [init, iphone]);
  const p = await ctx.newPage(), state = {profile, saved: null};
  await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
  await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
    const u = new URL(r.request().url());
    if (u.pathname === "/api/me") return r.fulfill({json: {user: {id: "u1", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile: state.profile, activities: [], done: [], features: {}, strava: {available: false, connected: false}, push: {key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", devices: 0}, source: "ig"}});
    if (u.pathname === "/api/profile" && r.request().method() === "PUT"){ state.saved = JSON.parse(r.request().postData() || "{}").profile; return r.fulfill({json: {ok: true}}); }
    return r.fulfill({json: {}});
  });
  await p.goto(URL0);
  return {p, ctx, state};
}
const sheet = p => p.evaluate(() => { const s = document.querySelector(".back .sheet"); return s ? (s.classList.contains("nask") ? "nask" : s.classList.contains("wnew") ? "wnew" : s.className) : ""; });
// drive plan setup for real, like a new member (same steps as tests/setup_resume.mjs)
async function buildFirstPlan(p){
  await p.waitForSelector("h2.sec-t >> text=What's your goal?", {timeout: 15000});
  await p.click('label.opt:has(input[value="10k"])');
  await p.fill("#s-date", new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10));
  await p.click('[data-act="next"]'); await p.waitForSelector("#s-weekly");
  await p.fill("#s-weekly", "12"); await p.fill("#s-longest", "5");
  await p.click('[data-act="next"]'); await p.waitForSelector("#s-ft", {timeout: 5000});
  await p.fill("#s-ft", "5"); await p.fill("#s-in", "9"); await p.fill("#s-age", "27"); await p.fill("#s-w", "160");
  await p.click('[data-act="next"]'); await p.waitForSelector("#s-long");
  // no session today, so the plain reminder ask shows (a run today leads with "Day 1 is today": tests/day1_start.mjs)
  const td = (new Date().getDay() + 6) % 7;
  await p.evaluate(pick => document.querySelectorAll('input[name="days"]').forEach(x => { x.checked = pick.includes(+x.value); }), [(td + 1) % 7, (td + 3) % 7, (td + 5) % 7]);
  await p.click('[data-act="next"]');
  await p.waitForSelector("#tabbar", {timeout: 15000});
  await p.waitForTimeout(2600);   // 900 ms build wait + 1200 ms before the ask + the service worker check
}
try {
  const app = fs.readFileSync(path.join(root, "index.html"), "utf8");
  t(/if \(firstPlan && mode === "account"\) firstRemind\(\);/.test(app), "building the first plan calls firstRemind (code not commented out)");
  t(/setTimeout\(askNotif, 1800\)/.test(app), "opening the app still asks once when notifications are off (3-day wait)");

  // 1. first plan on a phone that can get web push: asked right away
  { const {p, ctx, state} = await open({profile: null});
    await buildFirstPlan(p);
    t(!!state.saved, "the first plan was saved");
    const s = await sheet(p), txt = s === "nask" ? await p.textContent(".nask") : "";
    t(s === "nask" && /Want a reminder/.test(txt) && await p.$('.nask [data-act="naskyes"]') && await p.$('.nask [data-act="nasknot"]'),
      "right after the first plan: 'Want a reminder for your workouts?' with Allow and Not now (got: " + (s || "nothing") + ")");
    await p.click('.nask [data-act="nasknot"]');
    t(!(await sheet(p)), "Not now closes it");
    t(await p.evaluate(() => /^2026-/.test(localStorage.getItem("hy-new") || "")), "a new member's What's new is marked as seen (no history pop-up later)");
    await ctx.close(); }

  // 2. iPhone Safari tab: no web push, so offer the Home Screen steps
  { const {p, ctx} = await open({profile: null, iphone: true});
    await buildFirstPlan(p);
    const s = await sheet(p), txt = s === "nask" ? await p.textContent(".nask") : "";
    t(s === "nask" && /Home Screen/.test(txt) && !!(await p.$('.nask [data-act="naskapp"]')), "iPhone Safari: the ask explains reminders need the Home Screen, with Show me how (got: " + (s || "nothing") + ")");
    if (s === "nask"){ await p.click('.nask [data-act="naskapp"]'); await p.waitForTimeout(300); }
    t(!!(await p.$(".sheet.inst")), "Show me how opens the Add to Home Screen steps");
    await ctx.close(); }

  // 3. asked recently (and every automated test that sets hy-nask): not asked again
  { const {p, ctx} = await open({profile: null, init: {"hy-nask": String(Date.now())}});
    await buildFirstPlan(p);
    t(!(await sheet(p)), "a member asked in the last 3 days is not asked again after building a plan");
    await ctx.close(); }

  // 4. a new member's first open with a plan (no What's new seen yet): no history flood, and the ask is not blocked
  { const {p, ctx} = await open({profile: PROF});
    await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(3200);
    const s = await sheet(p);
    t(s === "nask", "first open with a plan: the notification ask shows, not a What's new history (got: " + (s || "nothing") + ")");
    await ctx.close(); }

  // 5. an existing member who last saw an older release: What's new still shows once; a tap outside counts as seen
  { const {p, ctx} = await open({profile: PROF, init: {"hy-new": "2026-11-14", "hy-nask": String(Date.now())}});
    await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(1500);
    t(await sheet(p) === "wnew", "an existing member still sees What's new for releases since their last look");
    await p.evaluate(() => document.querySelector(".back").dispatchEvent(new MouseEvent("click", {bubbles: true}))); await p.waitForTimeout(200);   // a tap on the dimmed area
    t(!(await sheet(p)), "a tap outside closes it");
    await p.reload(); await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(1500);
    t(!(await sheet(p)), "closed by a tap outside, it does not come back on the next open");
    await ctx.close(); }
} catch(e){ t(false, "test crashed: " + (e && e.message || e)); }
await b.close(); srv.close();
console.log(bad ? bad + " first-remind check(s) failed" : "first remind: all checks pass");
process.exit(bad ? 1 : 0);
