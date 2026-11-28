// Plan first, account second (Nov 27, 2026: 559 site visits a week and ~0 sign-ups; the account form came before any
// plan). A signed-out visitor taps "Build my free plan", answers the 4 steps, and only then sees the account form with
// "Your plan is ready". Back returns to the last step with the answers kept. Signing up saves THAT plan to the new
// account (PUT /api/profile) and lands on Today. A plan survives a reload until an account saves it, and an existing
// member's plan is never overwritten by a stale one. API mocked; no real account is made.
//   node tests/plan_first.mjs        (CHROME=/usr/bin/google-chrome if Playwright's browser isn't installed)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8099);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
let lastProfile = null;
const b = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});

async function page(existingProfile){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage(), calls = [];
  await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
  let profile = existingProfile || null;
  await p.route(/hybrid-api\.hybridapp\.workers\.dev|\/api\//, r => { const q = r.request(), u = new URL(q.url()), m = q.method();
    calls.push(m + " " + u.pathname);
    if (u.pathname === "/api/signup") return r.fulfill({json: {token: "tok-test", user: {id: "u1234567890abcdef", email: "v@t.test", name: "Vis", terms_at: "x"}}});
    if (u.pathname === "/api/login") return r.fulfill({json: {token: "tok-test", user: {id: "u1234567890abcdef", email: "v@t.test", name: "Vis"}}});
    if (u.pathname === "/api/me") return r.fulfill({json: {user: {id: "u1234567890abcdef", email: "v@t.test", name: "Vis", terms_at: "x"}, profile, done: [], food: [], checkins: [], weights: [], activities: []}});
    if (u.pathname === "/api/profile" && m === "PUT"){ const j = q.postDataJSON(); profile = j.profile; lastProfile = j.profile; calls.push("PROFILE " + JSON.stringify({goal: j.profile.goal, name: j.profile.name})); return r.fulfill({json: {ok: true}}); }
    return r.fulfill({json: {left: 80}}); });
  await p.goto("http://localhost:8099/index.html"); await p.waitForSelector(".welcome h1");
  return {ctx, p, calls};
}
async function steps(p){
  await p.click('[data-act="next"]');   // welcome -> step 0
  await p.fill("#s-name", "Vis");
  await p.click('label.opt:has(input[value="half"])');
  const race = new Date(Date.now() + 84 * 864e5).toISOString().slice(0, 10);
  await p.fill("#s-date", race); await p.click("#s-goal"); await p.keyboard.type("14500");
  await p.click('[data-act="next"]');
  await p.fill("#s-weekly", "22"); await p.fill("#s-longest", "8"); await p.click('label.opt:has(input[name="prDist"][value="10k"])'); await p.click("#s-pr"); await p.keyboard.type("4830");
  await p.click('[data-act="next"]'); await p.click('label.opt:has(input[name="lifts"][value="3"])'); await p.fill("#s-ft", "5"); await p.fill("#s-in", "10"); await p.fill("#s-age", "30"); await p.fill("#s-w", "182"); await p.fill("#s-gw", "175");
  await p.click('[data-act="next"]');
}
try {
  let {ctx, p, calls} = await page();
  const welcome = await p.innerText(".welcome");
  t(/Build my free plan/.test(welcome) && await p.locator('.welcome [data-act="authsignup"]').count() === 1 && await p.locator('.welcome [data-act="authlogin"]').count() === 1,
    "welcome: 'Build my free plan' first; create-account and log-in still there");
  await steps(p);
  await p.click('[data-act="next"]');   // step 3 -> build
  await p.waitForSelector("#authform", {timeout: 5000});
  t(await p.locator("#a-saveplan").count() === 1 && /Your plan is ready/.test(await p.innerText("#a-saveplan")), "after the 4 steps: the account form says the plan is ready to save");
  t(await p.inputValue("#a-name") === "Vis", "the first name typed in the plan is already in the account form");
  t(!calls.some(c => c.startsWith("PUT /api/profile")), "nothing was saved to the server before an account exists");
  t(await p.evaluate(() => !!JSON.parse(localStorage.getItem("hp-pending") || "null")), "the finished plan is kept in the browser in case they reload");
  await p.click('#authform [data-act="authback"]');
  await p.waitForSelector('.setup [data-act="prev"]', {timeout: 3000});
  t(await p.locator("#authform").count() === 0, "Back from the account form returns to the plan's last step");
  await p.click('[data-act="prev"]'); await p.waitForSelector("#s-w", {timeout: 3000});
  t(await p.inputValue("#s-w") === "182", "...with every answer kept");
  await p.click('[data-act="next"]');
  await p.click('[data-act="next"]'); await p.waitForSelector("#a-saveplan", {timeout: 5000});
  await p.fill("#a-email", "v@t.test"); await p.fill("#a-pass", "testpass123"); await p.check("#a-agree"); await p.click('#authform [type="submit"]');
  await p.waitForSelector(".hub-hero", {timeout: 15000});
  t(calls.some(c => c === 'PROFILE {"goal":"half","name":"Vis"}'), "signing up saves the plan they built (" + calls.filter(c => c.startsWith("PROFILE")).join(",") + ")");
  t(calls.indexOf("POST /api/signup") < calls.findIndex(c => c.startsWith("PUT /api/profile")), "the plan is saved after the account is made");
  t(await p.evaluate(() => localStorage.getItem("hp-pending")) === null, "the kept copy is cleared once it's saved");
  await ctx.close();

  // reload in the middle: the plan waits for the account
  ({ctx, p, calls} = await page());
  await steps(p); await p.click('[data-act="next"]'); await p.waitForSelector("#authform");
  await p.reload(); await p.waitForSelector(".welcome h1");
  await p.click('.welcome [data-act="authsignup"]'); await p.fill("#a-name", "Vis"); await p.fill("#a-email", "v@t.test"); await p.fill("#a-pass", "testpass123"); await p.check("#a-agree"); await p.click('#authform [type="submit"]');
  await p.waitForSelector(".hub-hero", {timeout: 15000});
  t(calls.some(c => c.startsWith('PROFILE {"goal":"half"')), "after a reload, signing up still saves the plan they built");
  await ctx.close();

  // a member who already has a plan logs in on a browser with a stale kept plan: theirs is never replaced
  ({ctx, p, calls} = await page({...lastProfile, name: "Old"}));
  await p.evaluate(() => localStorage.setItem("hp-pending", JSON.stringify({goal: "marathon", name: "Stale"})));
  await p.reload(); await p.waitForSelector(".welcome h1");
  await p.click('.welcome [data-act="authlogin"]'); await p.fill("#a-email", "v@t.test"); await p.fill("#a-pass", "testpass123"); await p.click('#authform [type="submit"]');
  await p.waitForTimeout(2500);
  t(!calls.some(c => c.startsWith("PROFILE")), "an existing member's plan is never overwritten by a kept one");
  t(await p.evaluate(() => localStorage.getItem("hp-pending")) === null, "the stale kept plan is dropped");
  await ctx.close();
} catch(e){ t(false, "test crashed: " + (e && e.message)); }
finally { await b.close(); srv.close(); }
console.log(bad ? bad + " failed" : "all passed"); process.exit(bad ? 1 : 0);
