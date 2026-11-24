// Garmin history backfill after a connect (incident fail-other, Nov 23, 2026). Runs its own local API against a fake
// Garmin and a throwaway local database, so it never touches live data. Checks that what a member chose not to share
// (a summary type whose export permission is off, or Garmin's 412 for history) is logged as an ok outcome, never as a
// failure, while a real refusal (a 500) still counts as one, and Garmin refusing history (403) logs as garmin_backfill_refused.
//   cd api && node ../tests/garmin_backfill.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8793, MOCK = 9913, API = "http://127.0.0.1:" + PORT;
const state = {perms: [], backfill: {}};
const asked = [];
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake Garmin: token, user id, permissions, and a backfill answer per summary type
const mock = http.createServer((req, res) => {
  const u = req.url.split("?")[0], send = (code, body) => { res.writeHead(code, {"Content-Type": "application/json"}); res.end(JSON.stringify(body)); };
  if (u === "/token") return send(200, {access_token: "tok", refresh_token: "r", expires_in: 86400});
  if (u === "/wellness-api/rest/user/id") return send(200, {userId: "g-bf"});
  if (u === "/wellness-api/rest/user/permissions") return send(200, state.perms);
  const m = u.match(/^\/wellness-api\/rest\/backfill\/(\w+)$/);
  if (m){ asked.push(m[1]); return send(state.backfill[m[1]] || 202, {}); }
  send(404, {});
}).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "bf-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "GARMIN_API:http://127.0.0.1:" + MOCK, "--var", "GARMIN_TOKEN_URL:http://127.0.0.1:" + MOCK + "/token"], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

// one connect: a fresh oauth state, the callback, then the backfill events it logged
async function connect(uid, n){
  asked.length = 0;
  const st = "bfstate" + n;
  sql(`DELETE FROM events WHERE kind = 'garmin_backfill'; INSERT INTO oauth_states (state, user_id, created, verifier) VALUES ('${st}', '${uid}', '${new Date().toISOString()}', 'v')`);
  const r = await fetch(API + "/api/garmin/callback?state=" + st + "&code=c", {redirect: "manual"});
  ok(r.status === 302 && /garmin=connected/.test(r.headers.get("location") || ""), "connect " + n + " redirects back connected");
  for (let i = 0; i < 20; i++){ await sleep(500); const e = sql("SELECT ok, detail FROM events WHERE kind = 'garmin_backfill' ORDER BY rowid"); if (e.length && e.length === sql("SELECT COUNT(*) AS n FROM events WHERE kind = 'garmin_backfill'")[0].n && i > 3) return e; }
  return sql("SELECT ok, detail FROM events WHERE kind = 'garmin_backfill' ORDER BY rowid");
}

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({email: "bf-" + Date.now() + "@example.com", password: "backfill-test-123", name: "BF", agree: true})});
  const {token} = await r.json(); ok(!!token, "signed up a throwaway local member");
  const uid = sql("SELECT id FROM users ORDER BY created DESC LIMIT 1")[0].id;

  // 1. everything shared: all five types asked, all ok
  state.perms = ["ACTIVITY_EXPORT", "HEALTH_EXPORT", "HISTORICAL_DATA_EXPORT"]; state.backfill = {};
  let ev = await connect(uid, 1);
  ok(asked.length === 5, "all shared: asked Garmin for all 5 types (" + asked.join(",") + ")");
  ok(ev.length === 5 && ev.every(e => e.ok === 1), "all shared: 5 ok events, no failures");

  // 2. activities only: health types skipped without asking, logged ok
  state.perms = ["ACTIVITY_EXPORT", "HISTORICAL_DATA_EXPORT"];
  ev = await connect(uid, 2);
  ok(asked.join(",") === "activities,activityDetails", "activities only: asked only for activity types (" + asked.join(",") + ")");
  ok(ev.length === 5 && ev.every(e => e.ok === 1), "activities only: no failures logged");
  ok(ev.filter(e => /not shared, skipped/.test(e.detail || "")).length === 3, "activities only: the 3 health types logged as skipped");

  // 3. history not shared: Garmin answers 412, the backfill stops with one ok event and no failure
  state.perms = ["ACTIVITY_EXPORT", "HEALTH_EXPORT"]; state.backfill = {sleeps: 412, dailies: 412, hrv: 412, activities: 412, activityDetails: 412};
  ev = await connect(uid, 3);
  ok(asked.length === 1, "412: stopped after the first refusal");
  ok(ev.length === 1 && ev[0].ok === 1 && /412 history not shared, stopped/.test(ev[0].detail || ""), "412: one ok event, no failure (" + JSON.stringify(ev) + ")");

  // 4. a real refusal still counts as a failure, with Garmin's status
  state.backfill = {hrv: 500};
  ev = await connect(uid, 4);
  const bad = ev.filter(e => e.ok === 0);
  ok(bad.length === 1 && bad[0].detail === "hrv 500", "real refusal: still logged as a failure with its status (" + JSON.stringify(bad) + ")");

  // 4b. Garmin refusing history (403): its own kind, never a garmin_backfill failure
  state.perms = ["ACTIVITY_EXPORT", "HEALTH_EXPORT"]; state.backfill = {sleeps: 403, dailies: 403, hrv: 403, activities: 403, activityDetails: 403};
  sql("DELETE FROM events WHERE kind = 'garmin_backfill_refused'");
  ev = await connect(uid, 6);
  const ref = sql("SELECT ok, detail FROM events WHERE kind = 'garmin_backfill_refused' ORDER BY rowid");
  ok(ev.length === 0, "403: no garmin_backfill failures (" + JSON.stringify(ev) + ")");
  ok(ref.length === 5 && ref[0].detail === "sleeps 403", "403: 5 garmin_backfill_refused events with Garmin's code (" + JSON.stringify(ref) + ")");

  // 5. Garmin's permission list unreadable: ask for everything, as before
  state.perms = {nope: 1}; state.backfill = {};
  ev = await connect(uid, 5);
  ok(asked.length === 5 && ev.every(e => e.ok === 1), "unreadable permissions: asked for all 5 types");
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { stop(); }
console.log(failed ? failed + " backfill check(s) failed" : "garmin backfill: all checks pass");
process.exit(failed ? 1 : 0);
