// One run, one notification (Nov 16). A member with Garmin AND Strava linked got two notifications for one run: the
// Garmin copy was reviewed and announced, then the Strava copy of the same run a minute later. Runs its own local API
// against a fake Strava, a stand-in AI and a throwaway local database. Checks that when the Strava copy arrives:
//   - only one activity is kept (the Strava copy), and the coach's review moves onto it
//   - the run is not reviewed (and so not announced) a second time
//   - a Strava run with no Garmin twin is still reviewed as before
//   cd api && node ../tests/one_push.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8794, MOCK = 9914, API = "http://127.0.0.1:" + PORT;
let failed = 0, aiCalls = 0, list = [];
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake Strava (activity list + detail) and a stand-in AI on one port
const mock = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => {
  const u = req.url; res.setHeader("Content-Type", "application/json");
  if (u.startsWith("/v1/messages")){ aiCalls++; res.end(JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: JSON.stringify({headline: "AI REVIEW", numbers: "8.08 mi", meaning: "Steady and easy.", next: "Tomorrow as planned."})}]})); return; }
  if (u.startsWith("/api/v3/athlete/activities")){ res.end(JSON.stringify(list)); return; }
  if (/^\/api\/v3\/activities\//.test(u)){ res.end(JSON.stringify({laps: []})); return; }
  res.statusCode = 404; res.end("{}");
}); }).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "onep-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "STRAVA_BASE:http://127.0.0.1:" + MOCK, "--var", "ANTHROPIC_URL:http://127.0.0.1:" + MOCK + "/v1/messages", "--var", "ANTHROPIC_API_KEY:test-key"], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };
const iso = d => d.toISOString().slice(0, 10), addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, method, path, data) => fetch(API + path, {method, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined});
  const token = (await (await call(null, "POST", "/api/signup", {email: "onep-" + Date.now() + "@example.com", password: "one-push-test-123", name: "One Push", agree: true, adult: true})).json()).token;
  ok(!!token, "signed up a throwaway local member");
  const today = iso(new Date()), dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, monday = addDays(today, -dow), far = Math.floor(Date.now() / 1000) + 86400;
  await call(token, "PUT", "/api/settings", {tz: "UTC"});
  const profile = {name: "One Push", goal: "half", raceDate: addDays(monday, 11 * 7 + 6), goalSec: 6240, weekly: 20, longest: 8, prDist: "10k", prSec: 2910, easyPace: null, weight: 178, goalWeight: 172, lifts: 3, liftExp: "Some", days: [1, 2, 3, 5, 6], longDay: 6};
  ok((await call(token, "PUT", "/api/profile", {profile})).ok, "plan saved");
  const uid = sql("SELECT id FROM users ORDER BY created DESC LIMIT 1")[0].id;
  sql(`INSERT INTO strava_links (user_id, athlete_id, access_token, refresh_token, expires_at) VALUES ('${uid}', 'ath-1', 't', 'r', ${far});
       INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES ('${uid}', 'g-1', 't', 'r', ${far}, '${today}')`);
  const n = q => sql(q)[0].n;

  // 1. the watch sends the run to Garmin first: stored, reviewed by the coach (one AI call)
  const start = Math.floor(Date.now() / 1000) - 600, startLocal = new Date(start * 1000).toISOString().slice(0, 19);
  const g = await fetch(API + "/api/garmin/push", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({activities: [{userId: "g-1", summaryId: "ga1", activityType: "RUNNING", activityName: "Evening Run",
    startTimeInSeconds: start, startTimeOffsetInSeconds: 0, durationInSeconds: 3840, distanceInMeters: 13003, averageHeartRateInBeatsPerMinute: 165}]})});
  ok(g.status === 200, "Garmin push accepted");
  for (let i = 0; i < 12 && !n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'"); i++) await sleep(1000);
  ok(n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND source = 'garmin'") === 1, "the Garmin copy of the run is stored");
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") === 1 && aiCalls === 1, "the coach reviewed it once (AI calls: " + aiCalls + ")");

  // 2. a minute later Strava has the same run, plus a different run that Garmin never sent
  list = [{id: 777, start_date_local: startLocal + "Z", sport_type: "Run", name: "Evening Run", distance: 13003, moving_time: 3838, average_heartrate: 165, map: {summary_polyline: "abc"}},
          {id: 778, start_date_local: startLocal + "Z", sport_type: "Run", name: "Shakeout", distance: 3219, moving_time: 1200, average_heartrate: 130, map: {summary_polyline: "abc"}}];
  const s = await call(token, "POST", "/api/strava/sync");
  ok(s.ok, "Strava sync ran");
  for (let i = 0; i < 12 && n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") < 2; i++) await sleep(1000);
  await sleep(1500);
  ok(n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND source = 'garmin'") === 0 && n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND ext_id = '777'") === 1, "only one copy of the run is kept (the Strava one)");
  const rv = sql("SELECT r.data FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = '777'");
  ok(rv.length === 1 && JSON.parse(rv[0].data).headline === "AI REVIEW" && !JSON.parse(rv[0].data).askFeel, "the coach's review moved onto the kept copy; the run was NOT reviewed and announced a second time");
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "' AND activity_id NOT IN (SELECT id FROM activities)") === 0, "no review is left pointing at the deleted Garmin copy");
  const other = sql("SELECT r.data FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = '778'");
  ok(other.length === 1 && JSON.parse(other[0].data).askFeel === true, "a Strava run with no Garmin twin is still reviewed, with the how-did-it-feel ask");
  ok(aiCalls === 1, "no extra AI call (Strava data never goes to the AI): " + aiCalls);
  ok(n("SELECT COUNT(*) AS n FROM events WHERE kind = 'strava_sync' AND detail LIKE '%1 already reviewed from Garmin%'") === 1, "the event log says one run was already reviewed from Garmin");

  // 3. syncing again changes nothing
  await call(token, "POST", "/api/strava/sync"); await sleep(2500);
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") === 2 && n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "'") === 2, "a second sync adds nothing");
} catch(e){ ok(false, "test crashed: " + (e && e.stack || e)); }
finally { stop(); }
console.log(failed ? failed + " problem(s)" : "ALL PASS");
process.exit(failed ? 1 : 0);
