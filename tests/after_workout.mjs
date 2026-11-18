// After-workout sheet (Matthew, Nov 18 10:43am: "after each activity ... a pop up for the bottom of the page next time it's opened
// like Strava where they can edit the name"). Mocks the API in the browser (no live data): a run synced today slides up once,
// can be renamed and shared (incl. the mile-splits sticker); it never shows again, and older or hand-logged workouts never pop up.
// Run: node tests/after_workout.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8098);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const enc = pts => { let out = "", pl = 0, pg = 0; const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20){ s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [a, b] of pts){ const la = Math.round(a * 1e5), lg = Math.round(b * 1e5); out += e(la - pl) + e(lg - pg); pl = la; pg = lg; } return out; };
const day = n => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const mon = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 14); return day(Math.round((d - Date.now()) / 864e5)); })();
const route = Array.from({length: 60}, (_, i) => [27.63 + Math.sin(i / 9) * .01, -80.39 + i * .0006]);
const laps = [8.3, 8.2, 8.13, 8.2, 7.77, 7.62, 7.67, 7.32].map(m => [1609.34, m * 60, 150 + Math.round(m)]);
const run = {id: "a-today", source: "strava", date: day(0), start_local: day(0) + "T07:05:00", type: "run", name: "Morning Run", mi: 8.08, minutes: 63.8, avg_hr: 165, max_hr: 182, poly: enc(route), laps: JSON.stringify(laps)};
const old = {id: "a-old", source: "strava", date: day(-5), start_local: day(-5) + "T07:00:00", type: "run", name: "Old Run", mi: 5, minutes: 42};
const hand = {id: "a-hand", source: "manual", date: day(0), type: "lift", name: "Lift", minutes: 45};
const profile = {name: "T", goal: "half", start: mon, raceDate: day(70), goalSec: 6240, weekly: 20, longest: 8, prDist: "10k", prSec: 2910, weight: 178, goalWeight: 172, lifts: 3, liftExp: "Some", days: [0, 1, 2, 3, 4, 5, 6], longDay: 6};
let renamed = null;
const b = await chromium.launch(), ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage();
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap/, r => r.abort());
await p.route(/hybrid-api\.hybridapp\.workers\.dev/, async r => {
  const u = new URL(r.request().url()), m = r.request().method();
  if (u.pathname === "/api/me") return r.fulfill({json: {user: {id: "u1", name: "Tess", email: "t@t.test"}, profile, activities: [run, old, hand], features: {rename: true}, strava: {available: true, connected: false}}});
  if (m === "PUT" && /\/api\/activity\/.+\/name/.test(u.pathname)){ renamed = JSON.parse(r.request().postData()).name; return r.fulfill({json: {name: renamed, src_name: "Morning Run"}}); }
  return r.fulfill({json: {}});
});
await ctx.addInitScript(() => { try { localStorage.setItem("hp-token", "test"); localStorage.setItem("hy-nonew", "1"); localStorage.setItem("hy-nask", String(Date.now())); } catch(e){}
  window.__shared = null; navigator.canShare = () => true; navigator.share = async d => { const f = d.files[0]; const bm = await createImageBitmap(f); const oc = new OffscreenCanvas(bm.width, bm.height), g = oc.getContext("2d"); g.drawImage(bm, 0, 0); window.__shared = {name: f.name, w: bm.width, h: bm.height, corner: g.getImageData(4, 4, 1, 1).data[3]}; }; });
await p.goto("http://localhost:8098/index.html");
const sheet = await p.waitForSelector(".back.apl .apls", {timeout: 10000}).catch(() => null);
t(!!sheet, "a run synced today slides up the next time the app opens");
t(await p.inputValue("#apl-q").catch(() => "") === "Morning Run", "it opens on that run, ready to rename");
t(await p.$$eval(".back", x => x.length) === 1, "only one sheet: older and hand-logged workouts don't stack up");
const box = await p.$eval(".apls", e => { const r = e.getBoundingClientRect(); return {bottom: r.bottom, h: innerHeight}; });
t(box.h - box.bottom < 40, "it sits at the bottom of the screen");
await p.fill("#apl-q", "Tempo by the river"); await p.click('[data-act="aplsave"]');
await p.waitForFunction(() => !document.querySelector(".back.apl"), null, {timeout: 5000}).catch(() => {});
t(renamed === "Tempo by the river" && !(await p.$(".back.apl")), "Save renames it and closes the sheet");
await p.reload(); await p.waitForTimeout(2500);
t(!(await p.$(".back.apl")), "it shows once: reopening the app doesn't bring it back");
// share from the sheet, incl. mile splits (this run has laps)
await p.evaluate(() => localStorage.removeItem("hy-actpop")); await p.reload();
await p.waitForSelector(".back.apl .apls", {timeout: 10000});
await p.click('[data-act="aplshare"]'); await p.waitForSelector('.shs [data-act="shpick"][data-k="splits"]');
t(true, "Share opens the sticker sheet, with mile splits for a run that has laps");
await p.click('.shs [data-act="shpick"][data-k="splits"]'); await p.waitForFunction(() => window.__shared, null, {timeout: 10000});
const s = await p.evaluate(() => window.__shared);
t(s.w === 1080 && s.corner === 0 && /-splits\.png$/.test(s.name), `the splits sticker is a see-through PNG (${s.w}x${s.h})`);
if (process.env.SHOT){ await p.click('[data-act="close"]').catch(() => {}); await p.evaluate(() => localStorage.removeItem("hy-actpop")); await p.reload(); await p.waitForSelector(".back.apl .apls"); await p.waitForTimeout(2000); await p.screenshot({path: process.env.SHOT}); await p.click('[data-act="aplshare"]'); await p.waitForFunction(() => [...document.querySelectorAll(".shs-i")].every(e => /data:image/.test(e.style.backgroundImage)), null, {timeout: 15000}); await p.screenshot({path: process.env.SHOT.replace(".png", "-share.png"), fullPage: true}); }
await b.close(); srv.close(); process.exit(bad ? 1 : 0);
