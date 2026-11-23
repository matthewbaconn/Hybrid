// Bring a partner after your first week (growth move 12, Nov 23, 2026): right after a member's 3rd workout (3 days with a
// check-off or a synced workout), Today asks once "Training with someone?" with a link tagged ?src=ref-week1. Sent or
// "Not now" retires it; the general invite card takes over. Mocks the API.
// Run: node tests/partner_week1.mjs  (serves this folder itself; SHOTS=<dir> saves phone screenshots)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8098);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
let me = null, left = 83, have = 0;
const b = await chromium.launch();
const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
const today = iso(new Date()), add = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
const dw = d => (new Date(d + "T12:00:00").getDay() + 6) % 7, monday = add(today, -dw(today));
const prof = {name: "Casey", goal: "fitness", weekly: 20, longest: 6, prDist: "none", days: [0,1,2,3,4,5,6], longDay: 6, lifts: 0, liftExp: "Some", weight: 170, start: add(monday, -7), built: add(today, -8), pv: 2};
const base = extra => ({user: {id: "abcdef1234567890", name: "Casey Runner", email: "u1@t.test", terms_at: "2026-11-01T10:00:00Z"}, profile: prof, activities: [], done: [], features: {refreward: true},
  strava: {available: true, connected: false}, garmin: {available: true, connected: false}, ...extra});
const days = n => Array.from({length: n}, (_, i) => add(today, -1 - i) + "-0");
async function page(share){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
  p.on("pageerror", e => { console.log("FAIL page error: " + e.message); bad++; });
  await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
  await p.route(/hybrid-api\.hybridapp\.workers\.dev|\/api\//, async r => {
    const u = new URL(r.request().url());
    if (u.pathname === "/api/me") return r.fulfill({json: me});
    if (u.pathname === "/api/founding") return r.fulfill({json: {left}});
    if (u.pathname === "/api/invites") return r.fulfill({json: {joined: have, plan: have, reward: {have, need: 2, earned: have >= 2, requested: null}}});
    return r.fulfill({json: {ok: true}});
  });
  await ctx.addInitScript(sh => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){}
    window.__shared = []; if (sh) navigator.share = d => { window.__shared.push(d.text); return Promise.resolve(); }; }, share);
  return {ctx, p};
}
const open = async (p, j) => { me = j; await p.goto("http://localhost:8098/"); await p.waitForSelector("#tabbar", {timeout: 15000}); await p.waitForTimeout(900); };
const shot = async (p, f) => { if (!process.env.SHOTS) return; await p.waitForTimeout(2500); await p.evaluate(() => { const c = document.querySelector(".pmc") || document.querySelector(".invc"); if (c) c.scrollIntoView({block: "center"}); }); await p.waitForTimeout(400); await p.screenshot({path: process.env.SHOTS + "/" + f}); };
try {
  let {ctx, p} = await page(true);
  await open(p, base({done: days(2)}));
  t(!(await p.$(".pmc")), "2 workouts: no partner card yet");
  t(!!(await p.$(".invc")), "2 workouts: the general invite card still shows");
  await open(p, base({done: days(3)}));
  const txt = await p.$eval(".pmc", e => e.innerText).catch(() => "");
  t(/Training with someone\?/.test(txt) && /3 workouts done/.test(txt), "3rd workout: Training with someone? card (" + txt.replace(/\s+/g, " ").slice(0, 90) + ")");
  t(/83 Founding 100 spots left/.test(txt) && /free for life/.test(txt) && /Matthew reviews yours/.test(txt), "it says the real spots left and the plan-review reward");
  t((await p.$$(".invc")).length === 1, "only one invite card on Today (the general one steps aside)");
  const order = await p.evaluate(() => { const a = document.querySelector(".pmc"), t = document.querySelector(".tgrid"); return !!(a && t && (a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  t(order, "the ask sits above the tiles, right after today's workout");
  await shot(p, "partner-card.png");
  await p.click(".pmc [data-act=pmsend]"); await p.waitForTimeout(600);
  const sent = await p.evaluate(() => window.__shared);
  t(sent.length === 1 && /\?ref=abcdef12&src=ref-week1$/.test(sent[0]) && /Want to do it with me\?/.test(sent[0]), "Send shares a 1-to-1 message with the tagged link (" + (sent[0] || "").slice(-60) + ")");
  t(!(await p.$(".pmc")), "after sending: the ask is gone");
  t(!!(await p.$(".invc")), "after sending: the general invite card is back");
  t(/^sent /.test(await p.evaluate(() => localStorage.getItem("hy-pm"))), "sent is remembered");
  await shot(p, "partner-after-send.png");
  await open(p, base({done: days(5)}));
  t(!(await p.$(".pmc")), "reopened with more workouts: never asked twice");
  await ctx.close();

  ({ctx, p} = await page(false));
  await open(p, base({done: days(1), activities: [{id: "a1", source: "garmin", date: add(today, -4), type: "run", name: "Run", mi: 3, minutes: 30}, {id: "a2", source: "strava", date: add(today, -5), type: "run", name: "Run", mi: 3, minutes: 30}]}));
  t(!!(await p.$(".pmc")), "synced workouts count toward the 3 days");
  await p.click(".pmc [data-act=pmskip]"); await p.waitForTimeout(400);
  t(!(await p.$(".pmc")) && !(await p.$(".invc")), "Not now: the ask is gone, and the invite card rests for a week");
  t(/^skip /.test(await p.evaluate(() => localStorage.getItem("hy-pm"))), "Not now is remembered");
  await ctx.close();

  ({ctx, p} = await page(false));
  await open(p, base({done: [add(today, -1) + "-0", add(today, -2) + "-0"], activities: [{id: "a1", source: "strava", date: add(today, -1), type: "run", name: "Run", mi: 3, minutes: 30}]}));
  t(!(await p.$(".pmc")), "a check-off and a synced run on the same day count once");
  left = 0; await open(p, base({done: days(4)}));
  t(!(await p.$(".pmc")), "no Founding 100 spots left: no ask");
  left = 83; have = 1; await p.evaluate(() => localStorage.clear()); await p.evaluate(() => { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-new", "9999"); });
  await open(p, base({done: days(3)}));
  t(/1 of 2/.test(await p.$eval(".pmc", e => e.innerText).catch(() => "")), "a member already part-way to the reward sees 1 of 2");
  await ctx.close();
} catch(e){ console.log("FAIL error: " + e.message); bad++; }
await b.close(); srv.close();
console.log(bad ? bad + " FAILED" : "ALL PASS"); process.exit(bad ? 1 : 0);
