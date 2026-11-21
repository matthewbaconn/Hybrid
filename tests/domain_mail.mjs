// milesetapp.com move (Nov 21, 2026): the Worker side. Runs its own local API twice on throwaway databases with a fake
// Resend (no live data, no real mail):
//   1. switch off, Resend hasn't verified milesetapp.com yet: mail tries hello@milesetapp.com, falls back to the verified
//      hybrdrunning.com sender, and stops trying the new one for an hour; links still point at app.hybrdrunning.com.
//   2. switch on, domain verified: mail goes from hello@milesetapp.com with app.milesetapp.com links; /api/home says live.
// Also: CORS for both domains, a password reset link on the right address, pushes open in the app they came from.
//   cd api && node ../tests/domain_mail.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withApi({port, mailPort, live, verified}, fn){
  const mails = [];
  const fake = http.createServer((q, s) => { let b = ""; q.on("data", d => b += d); q.on("end", () => {
    const m = JSON.parse(b), list = Array.isArray(m) ? m : [m], from = list[0] && list[0].from || "";
    mails.push({path: q.url, from, list});
    if (!verified && /milesetapp\.com/.test(from)){ s.writeHead(403, {"Content-Type": "application/json"}); s.end('{"statusCode":403,"message":"The milesetapp.com domain is not verified."}'); return; }
    s.writeHead(200, {"Content-Type": "application/json"}); s.end('{"id":"x"}'); }); }).listen(mailPort);
  const dir = mkdtempSync(join(tmpdir(), "dm-"));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
  const dev = spawn("npx", ["wrangler", "dev", "--port", String(port), "--local-upstream", "127.0.0.1:" + port, "--persist-to", dir, "--var", "OUTBOX_URL:http://127.0.0.1:1/none",
    "--var", "MILESET_DOMAIN:" + (live ? "on" : "off"), "--var", "RESEND_API_KEY:test", "--var", "RESEND_URL:http://127.0.0.1:" + mailPort + "/emails"],
    {stdio: process.env.DM_DEBUG ? "inherit" : "ignore", detached: true});
  const API = "http://127.0.0.1:" + port;
  try {
    for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
    await fn(API, mails);
  } finally { try { process.kill(-dev.pid); } catch(e){} fake.close(); rmSync(dir, {recursive: true, force: true}); }
}
const signup = (API, origin, email, name) => fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: origin},
  body: JSON.stringify({email, password: "domain-move-1", name, agree: true})});
const html = m => m.list.map(x => (x.html || "") + (x.text || "")).join("");

// 1. switch off, new domain not verified yet
await withApi({port: 8801, mailPort: 8802, live: false, verified: false}, async (API, mails) => {
  const home = await (await fetch(API + "/api/home")).json();
  ok(home.live === false && home.app === "https://app.hybrdrunning.com/" && home.site === "https://hybrdrunning.com/", "off: /api/home says not live, old addresses");
  for (const o of ["https://app.milesetapp.com", "https://app.hybrdrunning.com", "https://milesetapp.com"]){
    const r = await fetch(API + "/api/founding", {headers: {Origin: o}});
    ok(r.headers.get("access-control-allow-origin") === o, "CORS: " + o + " can call the API (no one signed out or blocked)");
  }
  const pre = await fetch(API + "/api/me", {method: "OPTIONS", headers: {Origin: "https://app.milesetapp.com", "Access-Control-Request-Method": "GET"}});
  ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://app.milesetapp.com", "CORS preflight works from app.milesetapp.com");
  ok((await fetch(API + "/api/founding", {headers: {Origin: "https://evil.example"}})).headers.get("access-control-allow-origin") === "https://app.hybrdrunning.com", "CORS: other sites don't get their own origin back");
  const t = Date.now();
  await signup(API, "https://app.milesetapp.com", "ana-" + t + "@dm.test", "Ana");
  await sleep(2500);
  const welcome = mails.filter(m => m.list.some(x => /Welcome to Mileset/.test(x.subject || "")));
  ok(welcome.length === 2 && /hello@milesetapp\.com/.test(welcome[0].from) && /no-reply@hybrdrunning\.com/.test(welcome[1].from),
     "unverified: welcome tried hello@milesetapp.com, then went out from the verified sender (" + welcome.map(m => m.from).join(" → ") + ")");
  ok(welcome[1] && /https:\/\/app\.hybrdrunning\.com\//.test(html(welcome[1])) && !/app\.milesetapp\.com/.test(html(welcome[1])), "off: email links still point at app.hybrdrunning.com");
  const n = mails.length;
  await fetch(API + "/api/password/forgot", {method: "POST", headers: {"Content-Type": "application/json", Origin: "https://app.hybrdrunning.com"}, body: JSON.stringify({email: "ana-" + t + "@dm.test"})});
  await sleep(1500);
  const after = mails.slice(n);
  ok(after.length >= 1 && after.every(m => /no-reply@hybrdrunning\.com/.test(m.from)), "after one refusal the new sender is skipped for an hour (no double sends)");
  const reset = after.find(m => m.list.some(x => /Reset your Mileset password/.test(x.subject || "")));
  ok(!reset || /https:\/\/app\.hybrdrunning\.com\/#reset=[a-f0-9]{64}/.test(html(reset)), "off: password reset link on the current app address");
});

// 2. switch on, domain verified
await withApi({port: 8803, mailPort: 8804, live: true, verified: true}, async (API, mails) => {
  const home = await (await fetch(API + "/api/home")).json();
  ok(home.live === true && home.app === "https://app.milesetapp.com/" && home.site === "https://milesetapp.com/", "on: /api/home says live, milesetapp.com addresses");
  ok((await fetch(API + "/api/founding", {headers: {Origin: "https://app.hybrdrunning.com"}})).headers.get("access-control-allow-origin") === "https://app.hybrdrunning.com",
     "on: the old app address can still call the API (Home Screen icons keep working)");
  const t = Date.now();
  await signup(API, "https://app.milesetapp.com", "ben-" + t + "@dm.test", "Ben");
  await sleep(2500);
  const welcome = mails.filter(m => m.list.some(x => /Welcome to Mileset/.test(x.subject || "")));
  ok(welcome.length === 1 && /^Mileset <hello@milesetapp\.com>$/.test(welcome[0].from), "verified: welcome goes out once, from hello@milesetapp.com");
  ok(welcome[0] && /https:\/\/app\.milesetapp\.com\//.test(html(welcome[0])) && !/https:\/\/app\.hybrdrunning\.com\//.test(html(welcome[0])), "on: every app link in the email points at app.milesetapp.com");
  ok(welcome[0] && welcome[0].list[0].reply_to === "milesetapp@gmail.com", "replies still reach milesetapp@gmail.com");
  const n = mails.length;
  await fetch(API + "/api/password/forgot", {method: "POST", headers: {"Content-Type": "application/json", Origin: "https://app.milesetapp.com"}, body: JSON.stringify({email: "ben-" + t + "@dm.test"})});
  await sleep(1500);
  const reset = mails.slice(n).find(m => m.list.some(x => /Reset your Mileset password/.test(x.subject || "")));
  ok(reset && /https:\/\/app\.milesetapp\.com\/#reset=[a-f0-9]{64}/.test(html(reset)), "on: password reset link opens on app.milesetapp.com");
});

// pushes open inside whichever app (old or new address) the member installed, never bounce them to another address
const w = readFileSync(new URL("../api/worker.js", import.meta.url), "utf8");
ok(/url: "\.\/#today", \.\.\.msg/.test(w) && /url: "\.\/#members"/.test(w) && !/url: \(env\.APP_URL/.test(w), "push links are relative to the app that received them");
ok(!/from: env\.MAIL_FROM \|\| "Mileset <no-reply@hybrdrunning\.com>"/.test(w) && (w.match(/sendMail\(env, /g) || []).length >= 6, "every email goes through the one sender with the fallback");

console.log(failed ? failed + " failed" : "all domain mail checks pass");
process.exit(failed ? 1 : 0);
