// Email links keep the login (incident activation-none-trained, Nov 27, 2026). Every member who joined before the
// Nov 21 move has their login saved only at app.hybrdrunning.com, but with the switch on every email's button opens
// app.milesetapp.com, where they landed signed out. All 9 plan holders who never trained joined before the move; 8 got
// the first-workout email and none opened the app after it. Email links now carry ?m=1, and a signed-out tab that
// opens such a link on the new address steps once to the old one, which hands the login straight back (#move=).
// Serves this folder at both addresses inside the browser (no live site, API mocked). Checks:
//   - old-address login + email link on the new address -> signed in on the new address at #today, no token or ?m=1 left in the bar
//   - a login already on the new address is kept (no hop, never swapped for the old one)
//   - an ordinary visit (no ?m=1) never leaves the new address
//   - signed out on both addresses -> one hop and back, then the sign-in screen (no loop)
//   - the Worker's member emails mark their app links with ?m=1
// Run: node tests/mail_link_login.mjs
import {chromium} from "playwright";
import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const NEWA = "https://app.milesetapp.com", OLDA = "https://app.hybrdrunning.com";
const OLD_T = "a".repeat(64), NEW_T = "b".repeat(64);
const b = await chromium.launch();

async function run({oldToken = null, newToken = null, url}){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, serviceWorkers: "block"});
  const visits = [];
  for (const host of [NEWA, OLDA]) await ctx.route(host + "/**", r => {
    let p = new URL(r.request().url()).pathname; if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (r.request().resourceType() === "document") visits.push(r.request().url());
    if (!fs.existsSync(f)) return r.fulfill({status: 404, body: ""});
    r.fulfill({status: 200, contentType: types[path.extname(p)] || "application/octet-stream", body: fs.readFileSync(f)});
  });
  // the API: /api/home says the switch is on; anything else never answers (the login must survive, never be judged)
  await ctx.route("https://hybrid-api.hybridapp.workers.dev/**", r => {
    if (new URL(r.request().url()).pathname === "/api/home") return r.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"},
      body: JSON.stringify({live: true, app: NEWA + "/", site: "https://milesetapp.com/"})});
    /* hang */ });
  await ctx.route(/^https:\/\/(?!app\.(milesetapp|hybrdrunning)\.com|hybrid-api)/, r => r.abort());
  await ctx.addInitScript(([oldToken, newToken, OLDA, NEWA]) => {
    try { if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
      const t = location.origin === OLDA ? oldToken : location.origin === NEWA ? newToken : null;
      if (t) localStorage.setItem("hp-token", t); } catch(e){}
  }, [oldToken, newToken, OLDA, NEWA]);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(2500);
  const out = {url: page.url(), visits, token: await page.evaluate(() => localStorage.getItem("hp-token")).catch(() => null)};
  await ctx.close();
  return out;
}

let r = await run({oldToken: OLD_T, url: NEWA + "/?m=1#today"});
t(r.url.startsWith(NEWA + "/") && r.token === OLD_T, "email link, login only on the old address: signed in on the new address (" + r.url + ")");
t(/#today$/.test(r.url) && !/m=1|move=/.test(r.url), "lands on #today with no token or ?m=1 in the address bar");
t(r.visits.some(u => u.startsWith(OLDA)) && r.visits.length <= 3, "one step to the old address and back (" + r.visits.length + " page loads)");

r = await run({oldToken: OLD_T, newToken: NEW_T, url: NEWA + "/?m=1#today"});
t(r.token === NEW_T && !r.visits.some(u => u.startsWith(OLDA)), "a login already on the new address is kept: no hop, never swapped");

r = await run({oldToken: OLD_T, url: NEWA + "/#today"});
t(!r.visits.some(u => u.startsWith(OLDA)) && r.token === null, "an ordinary visit without ?m=1 never leaves the new address");

r = await run({url: NEWA + "/?m=1#today"});
t(r.url.startsWith(NEWA + "/") && r.token === null && r.visits.length <= 3 && !/m=1/.test(r.url), "signed out everywhere: one hop and back, then sign in (no loop, " + r.visits.length + " page loads)");

r = await run({oldToken: OLD_T, url: OLDA + "/?m=1#today"});
t(r.url.startsWith(NEWA + "/") && r.token === OLD_T && !/m=1/.test(r.url), "an old-address email link (switch off when sent) still lands signed in on the new address");

// Worker: every member email's app link carries ?m=1 (brandLinks turns the address into app.milesetapp.com)
const w = fs.readFileSync(path.join(root, "api/worker.js"), "utf8");
const links = [...w.matchAll(/https:\/\/app\.hybrdrunning\.com\/[^"'\s\\]*/g)].map(m => m[0]).filter(u => !/\/brand\//.test(u) && u !== "https://app.hybrdrunning.com/");
t(links.length >= 8 && links.every(u => /^https:\/\/app\.hybrdrunning\.com\/\?m=1(#today)?$/.test(u)), "member emails mark their app links with ?m=1 (" + links.length + " links)");

await b.close();
console.log(bad ? bad + " FAILED" : "ALL PASS");
process.exit(bad ? 1 : 0);
