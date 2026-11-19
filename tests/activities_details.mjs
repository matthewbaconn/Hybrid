// Activities section (Matthew's Nov 18 list, item 4): each workout's box shows heart rate + zone, climb, effort and how it lined
// up with the plan; this week's box shows planned miles; filters have counts; the list is grouped by week; empty filters explain
// themselves; nothing scrolls sideways at 390px. Run: node tests/activities_details.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8097);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const b = await chromium.launch(), p = await b.newPage({viewport: {width: 390, height: 844}});
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap/, r => r.abort());
await p.addInitScript(() => { try { localStorage.setItem("hy-nonew", "1"); } catch(e){} });
await p.goto("http://localhost:8097/index.html?local=1");
await p.click('[data-act="sample"]'); await p.waitForSelector(".hub-hero");
await p.evaluate(() => { const b = [...document.querySelectorAll("nav button, .tabbar button, [data-tab]")].find(x => /activit/i.test(x.textContent + (x.dataset.tab || ""))); b && b.click(); });
await p.waitForSelector('[data-act="actopen"]');
const chips = await p.$$eval(".actc .achips span", x => x.map(e => e.textContent));
t(chips.some(c => /\d+ bpm/.test(c)), "a workout box shows heart rate (with its zone when zones are set): " + (chips.find(c => /bpm/.test(c)) || "none"));
t(chips.some(c => /on target|faster than easy|slower than target|faster than target|done|of \d|Extra|Counted/.test(c)), "and how it lined up with the plan: " + (chips.find(c => /·|Extra|Counted/.test(c) && !/bpm/.test(c)) || "none"));
const wsum = await p.$eval(".wsum", e => e.textContent);
t(/\/\s*\d/.test(wsum) && await p.$(".wbar i") !== null, "this week's box shows run miles against the plan, with a bar: " + wsum.replace(/\s+/g, " ").slice(0, 60));
const fl = await p.$$eval(".afilt button", x => x.map(e => e.textContent.trim()));
t(fl.every(l => /\d+$/.test(l)), "each filter shows its count: " + fl.join(" | "));
t(await p.$$eval(".awk", x => x.length) >= 1 && /This week|Last week|–/.test(await p.$eval(".awk", e => e.textContent)), "the list is grouped by week");
const wide = await p.evaluate(() => document.scrollingElement.scrollWidth);
t(wide <= 390, "nothing scrolls sideways at 390px (" + wide + ")");
// empty filter
const empty = await p.evaluate(() => [...document.querySelectorAll(".afilt button")].find(b => / 0$/.test(b.textContent.trim()))?.dataset.k || null);
if (empty){ await p.click('.afilt [data-k="' + empty + '"]'); await p.waitForTimeout(300); t(await p.isVisible('.card [data-act="afilt"][data-k="all"]') && /show up here|yet/.test(await p.evaluate(() => [...document.querySelectorAll(".card")].pop().innerText)), "an empty filter explains itself and offers Show all"); }
else t(true, "(every filter has workouts in the sample)");
if (process.env.SHOT){ await p.click('.afilt [data-k="all"]').catch(() => {}); await p.waitForTimeout(500); await p.screenshot({path: process.env.SHOT, fullPage: true}); }
t(!errs.length, "no script errors" + (errs.length ? ": " + errs[0] : ""));
await b.close(); srv.close(); process.exit(bad ? 1 : 0);
