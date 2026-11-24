// Garmin history import refusals (Nov 23, 2026). After a member connected Garmin, all five 14-day history requests came
// back 403/412 (Garmin saying no: the app isn't approved for history, or the member didn't share that data). They were
// logged as "garmin_backfill" failures and Vesper texted Matthew that "something else in the app is failing". A refusal
// now logs as garmin_backfill_refused; a network or server error still logs as garmin_backfill. Runs its own local API
// against a fake Garmin and a throwaway local database, so it never touches live data.
//   cd api && node ../tests/garmin_backfill.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8794, MOCK = 9914, API = "http://127.0.0.1:" + PORT;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let backfill = {sleeps: 403, dailies: 403, hrv: 403, activities: 403, activityDetails: 412};

// fake Garmin: token, user id, and backfill answering with whatever status this step needs
const mock = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  let code = 404, body = '{"message":"x"}';
  if (u === "/token"){ code = 200; body = '{"access_token":"at","refresh_token":"rt","expires_in":86400}'; }
  else if (u === "/wellness-api/rest/user/id"){ code = 200; body = '{"userId":"g-bf"}'; }
  else if (u === "/wellness-api/rest/user/permissions"){ code = 200; body = '[]'; }
  else if (u.startsWith("/wellness-api/rest/backfill/")){ code = backfill[u.split("/").pop()] || 202; body = ""; }
  else if (u.startsWith("/training-api/")){ code = 200; body = "[]"; }
  res.writeHead(code, {"Content-Type": "application/json"}); res.end(body);
}).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "gb-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "GARMIN_API:http://127.0.0.1:" + MOCK, "--var", "GARMIN_TOKEN_URL:http://127.0.0.1:" + MOCK + "/token",
  "--var", "GARMIN_CLIENT_ID:test", "--var", "GARMIN_CLIENT_SECRET:test"], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

async function connect(st){
  const uid = sql("SELECT id FROM users ORDER BY created DESC LIMIT 1")[0].id;
  sql(`INSERT INTO oauth_states (state, user_id, created, verifier) VALUES ('${st}', '${uid}', '${new Date().toISOString()}', 'v')`);
  const r = await fetch(API + "/api/garmin/callback?state=" + st + "&code=c", {redirect: "manual"});
  await sleep(4000);
  return r.headers.get("location") || "";
}
const rows = () => sql("SELECT kind, ok, detail FROM events WHERE kind LIKE 'garmin_backfill%' ORDER BY ts");

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"},
    body: JSON.stringify({email: "gb-" + Date.now() + "@example.com", password: "garmin-test-123", name: "GB", agree: true})});
  ok(!!(await r.json()).token, "signed up a throwaway local member");

  // 1. Garmin refuses every history request (what happened Nov 23): refusals only, nothing counted as an app failure
  const loc = await connect("st-refused");
  ok(/garmin=connected/.test(loc), "the connection itself still succeeds");
  let ev = rows();
  ok(ev.length >= 5 && ev.every(e => e.kind === "garmin_backfill_refused" && e.ok === 0), "403/412 log as garmin_backfill_refused");
  ok(!ev.some(e => e.kind === "garmin_backfill"), "no garmin_backfill failures for Garmin's own refusals");
  ok(ev.some(e => /^sleeps 403$/.test(e.detail)) && ev.some(e => /^stopped after 412/.test(e.detail)), "Garmin's code is kept as the detail");

  // 2. a real server or network error is still a failure
  sql("DELETE FROM events WHERE kind LIKE 'garmin_backfill%'");
  backfill = {sleeps: 202, dailies: 500, hrv: 202, activities: 202, activityDetails: 202};
  await connect("st-error");
  ev = rows();
  ok(ev.some(e => e.kind === "garmin_backfill" && e.ok === 0 && e.detail === "dailies 500"), "a Garmin 500 is still a garmin_backfill failure");
  ok(ev.filter(e => e.kind === "garmin_backfill" && e.ok === 1).length === 4, "accepted requests log as successes");
  ok(!ev.some(e => e.kind === "garmin_backfill_refused"), "and nothing is called a refusal");
} catch(e){ ok(false, "test crashed: " + (e && e.stack || e)); }
stop();
console.log(failed ? `${failed} check(s) failed` : "all Garmin backfill checks passed");
process.exit(failed ? 1 : 0);
