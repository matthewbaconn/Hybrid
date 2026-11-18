// Share image (Matthew's Nov 18 list): on a run's screen, "Share image" makes a 1080x1350 PNG with the route and stats
// and hands it to the phone's share sheet (or saves it). Run: node tests/share_image.mjs  (serves this folder itself)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8099);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const b = await chromium.launch(), p = await b.newPage({viewport: {width: 390, height: 844}});
await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap/, r => r.abort());
await p.addInitScript(() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async d => { const f = d.files[0]; const bm = await createImageBitmap(f); window.__shared = {name: f.name, type: f.type, size: f.size, w: bm.width, h: bm.height}; }; });
await p.goto("http://localhost:8099/index.html?local=1");
await p.click('[data-act="sample"]'); await p.waitForSelector(".hub-hero");
await p.evaluate(() => { const b = [...document.querySelectorAll("nav button, .tabbar button, [data-tab]")].find(x => /activit/i.test(x.textContent + (x.dataset.tab || ""))); b && b.click(); });
await p.waitForSelector('[data-act="actopen"]');
const run = await p.$('.actc .amap'); await (run ? (await run.evaluateHandle(e => e.closest('[data-act="actopen"]'))).asElement() : await p.$('[data-act="actopen"]')).click();
await p.waitForSelector('[data-act="ashare"]');
t(await p.isVisible('[data-act="ashare"]'), "a workout's screen has a Share image button");
await p.click('[data-act="ashare"]'); await p.waitForFunction(() => window.__shared, null, {timeout: 10000});
const s = await p.evaluate(() => window.__shared);
t(s.type === "image/png" && s.w === 1080 && s.h === 1350 && s.size > 20000 && /^mileset-.*\.png$/.test(s.name), `it hands the share sheet a 1080x1350 PNG (${s.w}x${s.h}, ${Math.round(s.size / 1024)} KB)`);
await p.evaluate(() => { navigator.canShare = () => false; });
const [dl] = await Promise.all([p.waitForEvent("download", {timeout: 10000}), p.click('[data-act="ashare"]')]);
t(/^mileset-.*\.png$/.test(dl.suggestedFilename()), "without a share sheet it saves the PNG");
if (process.env.SAVE) await dl.saveAs(process.env.SAVE);
await b.close(); srv.close(); process.exit(bad ? 1 : 0);
