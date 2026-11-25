// Founding Ambassador links (Nov 25, 2026): ?src=ambassador-<instagram handle> is kept as the member's sign-up source.
// Instagram handles can hold "." and run to 30 chars, which the old 24-char [a-z0-9_-] check dropped. The app and the API
// now turn "." into "-" (handles never contain "-"), drop "@" and allow 48 chars. App side mocks the API; with API=<url>
// (a local wrangler dev) it also signs up for real and reads users.src back through wrangler's local D1.
// Run: node tests/invite_src.mjs   or   API=http://localhost:8787 node tests/invite_src.mjs
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import {execFileSync} from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8097);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const b = await chromium.launch();
async function stored(qs, pre){
  const ctx = await b.newContext(), p = await ctx.newPage();
  await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort());
  await p.route(/hybrid-api\.hybridapp\.workers\.dev|\/api\//, r => r.fulfill({json: {left: 80}}));
  if (pre) await ctx.addInitScript(v => { try { localStorage.setItem("hp-src", v); } catch(e){} }, pre);
  await p.goto("http://localhost:8097/" + qs); await p.waitForTimeout(700);
  const v = await p.evaluate(() => [localStorage.getItem("hp-src"), localStorage.getItem("hp-ref")]); await ctx.close(); return v;
}
try {
  let [s, r] = await stored("?ref=abcdef12&src=ambassador-Jane.Doe_runs");
  t(s === "ambassador-jane-doe_runs" && r === "abcdef12", "ambassador link with a dotted handle is kept (" + s + ") and the invite ref too");
  [s] = await stored("?src=ambassador-@" + "a".repeat(30));
  t(s === "ambassador-" + "a".repeat(30), "30-char handle with @ fits (" + (s || "").length + " chars)");
  [s] = await stored("?src=home");
  t(s === "home", "plain src still works");
  [s] = await stored("?src=" + "x".repeat(49));
  t(s === null, "over 48 chars is not stored");
  [s] = await stored("?src=ambassador-jane", "ig");
  t(s === "ig", "first source still wins");
  if (process.env.API){
    const go = async (src, ref) => { const email = "amb" + Date.now() + Math.random().toString(36).slice(2, 6) + "@t.test";
      const res = await fetch(process.env.API + "/api/signup", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({email, password: "testpass123", name: "Amb Test", agree: true, src, ref})});
      const j = await res.json(); const out = execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--json", "--command", "SELECT src FROM users WHERE id = '" + j.user.id.replace(/[^a-z0-9]/gi, "") + "'"], {cwd: path.join(root, "api"), encoding: "utf8"});
      return JSON.parse(out)[0].results[0].src; };
    t(await go("ambassador-Jane.Doe_runs") === "ambassador-jane-doe_runs", "API stores ambassador-<dotted handle> in users.src");
    t(await go("ambassador-" + "b".repeat(30)) === "ambassador-" + "b".repeat(30), "API keeps a 41-char ambassador src whole");
    t(await go("", "abcdef12") === "invite", "API still marks a plain invite as src=invite");
    t(await go("bad src!") === null, "API ignores a malformed src");
  }
} finally { await b.close(); srv.close(); }
console.log(bad ? bad + " failed" : "all passed"); process.exit(bad ? 1 : 0);
