// Forged-webhook test (Nov 16 security fix, PR #35). Runs its own local API against a fake Strava/Garmin and a
// throwaway local database, so it never touches live data. Checks that a webhook post alone can't delete a member's
// data: deletes happen only when Strava/Garmin themselves confirm it.
//   cd api && node ../tests/webhooks.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8791, MOCK = 9911, API = "http://127.0.0.1:" + PORT;
const state = {activity: 200, athlete: 200, garmin: 200};
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake Strava + Garmin: answer with whatever status the current step needs
const mock = http.createServer((req, res) => {
  const u = req.url;
  const code = /^\/api\/v3\/activities\//.test(u) ? state.activity : u === "/api/v3/athlete" ? state.athlete : u === "/wellness-api/rest/user/id" ? state.garmin : 404;
  res.writeHead(code, {"Content-Type": "application/json"}); res.end(code === 200 ? '{"id":1,"userId":"g-1"}' : '{"message":"x"}');
}).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "wh-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--var", "STRAVA_BASE:http://127.0.0.1:" + MOCK, "--var", "GARMIN_API:http://127.0.0.1:" + MOCK], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({email: "wh-" + Date.now() + "@example.com", password: "webhook-test-123", name: "WH", agree: true})});
  const {token} = await r.json(); ok(!!token, "signed up a throwaway local member");
  const uid = sql("SELECT id FROM users ORDER BY created DESC LIMIT 1")[0].id, far = Math.floor(Date.now() / 1000) + 86400, today = new Date().toISOString().slice(0, 10);
  sql(`INSERT INTO strava_links (user_id, athlete_id, access_token, refresh_token, expires_at) VALUES ('${uid}', 'ath-1', 't', 'r', ${far});
       INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES ('${uid}', 'g-1', 't', 'r', ${far}, '${today}');
       INSERT INTO activities (id, user_id, source, ext_id, date, type, name, created) VALUES ('a1', '${uid}', 'strava', 'act-1', '${today}', 'run', 'Run', '${today}'),
         ('a2', '${uid}', 'garmin', 'gact-1', '${today}', 'run', 'Run', '${today}')`);
  const count = q => sql(q)[0].n;
  const post = (path, body) => fetch(API + path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).then(x => x.status);

  // 1. forged posts while Strava/Garmin say everything still exists: nothing may be deleted
  ok(await post("/api/strava/webhook", {object_type: "activity", aspect_type: "delete", owner_id: "ath-1", object_id: "act-1"}) === 200, "forged Strava delete accepted (200)");
  ok(await post("/api/strava/webhook", {object_type: "athlete", aspect_type: "update", owner_id: "ath-1", updates: {authorized: "false"}}) === 200, "forged Strava deauth accepted (200)");
  ok(await post("/api/garmin/push", {deregistrations: [{userId: "g-1"}]}) === 200, "forged Garmin deregistration accepted (200)");
  await sleep(2500);
  ok(count("SELECT COUNT(*) AS n FROM activities WHERE id = 'a1'") === 1, "forged Strava delete did NOT delete the activity");
  ok(count("SELECT COUNT(*) AS n FROM strava_links WHERE athlete_id = 'ath-1'") === 1, "forged Strava deauth did NOT unlink Strava");
  ok(count("SELECT COUNT(*) AS n FROM garmin_links WHERE garmin_user_id = 'g-1'") === 1, "forged Garmin deregistration did NOT unlink Garmin");
  ok(count("SELECT COUNT(*) AS n FROM activities WHERE id = 'a2'") === 1, "forged Garmin deregistration did NOT delete Garmin data");

  // 2. the same posts once Strava/Garmin confirm: now the data goes
  Object.assign(state, {activity: 404, athlete: 401, garmin: 401});
  await post("/api/strava/webhook", {object_type: "activity", aspect_type: "delete", owner_id: "ath-1", object_id: "act-1"});
  await sleep(1500);
  await post("/api/strava/webhook", {object_type: "athlete", aspect_type: "update", owner_id: "ath-1", updates: {authorized: "false"}});
  await post("/api/garmin/push", {deregistrations: [{userId: "g-1"}]});
  await sleep(2500);
  ok(count("SELECT COUNT(*) AS n FROM activities WHERE id = 'a1'") === 0, "confirmed Strava delete removed the activity");
  ok(count("SELECT COUNT(*) AS n FROM strava_links WHERE athlete_id = 'ath-1'") === 0, "confirmed Strava deauth unlinked Strava");
  ok(count("SELECT COUNT(*) AS n FROM garmin_links WHERE garmin_user_id = 'g-1'") === 0, "confirmed Garmin deregistration unlinked Garmin");
  ok(count("SELECT COUNT(*) AS n FROM activities WHERE id = 'a2'") === 0, "confirmed Garmin deregistration removed Garmin data");
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { stop(); }
console.log(failed ? failed + " webhook check(s) failed" : "webhooks: all checks pass");
// The event-log privacy test (Nov 17) runs here: pr-checks.yml is a protected file, so it has no step of its own yet.
try { execFileSync("node", [new URL("./events_privacy.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::event-log privacy test failed"); }
// The setup-step test (Nov 17) runs here too, for the same reason.
try { execFileSync("node", [new URL("./setup_step.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::setup step test failed"); }
// The food-read retry test (Nov 17) runs here too, for the same reason.
try { execFileSync("node", [new URL("./food_retry.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::food-read retry test failed"); }
// The report-kind test (Nov 17) runs here too, for the same reason.
try { execFileSync("node", [new URL("./report_kind.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::report kind test failed"); }
// The visitor-kind diagnostic test (Nov 17) rides along for the same reason.
try { execFileSync("node", [new URL("./visits.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::visitor-kind test failed"); }
// The milesetapp.com move tests (Nov 21) ride along for the same reason: which address serves what, and the Worker side
// (mail fallback, the switch, CORS for both domains, reset links, /api/home) on its own local API.
try { execFileSync("node", [new URL("./domains.mjs", import.meta.url).pathname], {stdio: "inherit"}); }
catch(e){ failed++; console.log("::error::domain move test failed"); }
try { execFileSync("node", [new URL("./domain_mail.mjs", import.meta.url).pathname], {stdio: "inherit", cwd: new URL("../api/", import.meta.url).pathname}); }
catch(e){ failed++; console.log("::error::domain mail test failed"); }
// The Garmin backfill test (Nov 23, incident fail-other) rides along for the same reason, on its own local API.
try { execFileSync("node", [new URL("./garmin_backfill.mjs", import.meta.url).pathname], {stdio: "inherit", cwd: new URL("../api/", import.meta.url).pathname}); }
catch(e){ failed++; console.log("::error::garmin backfill test failed"); }
process.exit(failed ? 1 : 0);
