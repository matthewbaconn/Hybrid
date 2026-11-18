// One run, one copy, one notification (Nov 16-17). A member with Garmin AND Strava linked got two notifications for one
// run (the Garmin copy was announced, then the Strava copy). Since Nov 17 the GARMIN copy is the one that is kept, because
// Strava's rules keep its data away from the AI: with the Strava copy the coach could not see the run at all.
// Runs its own local API against a fake Strava, a stand-in AI and a throwaway local database. Checks that
//   - Garmin first, Strava second: the Strava copy is never stored, nothing is reviewed or announced twice
//   - Strava first, Garmin second: the Garmin copy replaces it, the member's own name and effort move over, the coach
//     reviews it from the real numbers, and no review is left pointing at a deleted workout
//   - a Strava run with no Garmin twin is still stored and reviewed as before (without the AI)
//   - the coach bar is sent the Garmin run and never the Strava-only run
// Also (Nov 16): giving a workout your own name (PUT /api/activity/:id/name, preview "rename"). Checks that the name
//   - is saved only on your own workout, cleaned and cut to 60 characters; an empty name puts the original back
//   - moves from the Garmin copy to the Strava copy that is kept, and is never undone by a later sync
//   - works for every member on their own workouts (released Nov 17)
//   cd api && node ../tests/one_push.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8794, MOCK = 9914, API = "http://127.0.0.1:" + PORT, OWNER = "owner-onep@mileset-test.dev";
let failed = 0, aiCalls = 0, list = [], lastAI = "";
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fake Strava (activity list + detail) and a stand-in AI on one port
const mock = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => {
  const u = req.url; res.setHeader("Content-Type", "application/json");
  if (u.startsWith("/v1/messages")){ aiCalls++; lastAI = b; if (/WHERE THINGS ARE/.test(b)){ res.end(JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: '{"answer":"Steady run.","actions":[]}'}]})); return; } res.end(JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: JSON.stringify({headline: "AI REVIEW", numbers: "8.08 mi", meaning: "Steady and easy.", next: "Tomorrow as planned."})}]})); return; }
  if (u.startsWith("/api/v3/athlete/activities")){ res.end(JSON.stringify(list)); return; }
  if (/^\/api\/v3\/activities\//.test(u)){ res.end(JSON.stringify({laps: []})); return; }
  res.statusCode = 404; res.end("{}");
}); }).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "onep-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "STRAVA_BASE:http://127.0.0.1:" + MOCK, "--var", "ANTHROPIC_URL:http://127.0.0.1:" + MOCK + "/v1/messages", "--var", "ANTHROPIC_API_KEY:test-key", "--var", "OWNER_EMAIL:" + OWNER], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };
const iso = d => d.toISOString().slice(0, 10), addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, method, path, data) => fetch(API + path, {method, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined});
  const token = (await (await call(null, "POST", "/api/signup", {email: OWNER, password: "one-push-test-123", name: "One Push", agree: true, adult: true})).json()).token;
  ok(!!token, "signed up a throwaway local member");
  const today = iso(new Date()), dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, monday = addDays(today, -dow), far = Math.floor(Date.now() / 1000) + 86400;
  await call(token, "PUT", "/api/settings", {tz: "UTC"});
  const profile = {name: "One Push", goal: "half", raceDate: addDays(monday, 11 * 7 + 6), goalSec: 6240, weekly: 20, longest: 8, prDist: "10k", prSec: 2910, easyPace: null, weight: 178, goalWeight: 172, lifts: 3, liftExp: "Some", days: [1, 2, 3, 5, 6], longDay: 6};
  ok((await call(token, "PUT", "/api/profile", {profile})).ok, "plan saved");
  const uid = sql("SELECT id FROM users WHERE email = '" + OWNER + "'")[0].id;
  const rename = async (tok, id, name) => { const r = await call(tok, "PUT", "/api/activity/" + id + "/name", {name}); let j = null; try { j = await r.json(); } catch(e){} return {status: r.status, j}; };
  const mine = async ext => ((await (await call(token, "GET", "/api/me")).json()).activities || []).find(a => a.ext_id === ext);
  sql(`INSERT INTO strava_links (user_id, athlete_id, access_token, refresh_token, expires_at) VALUES ('${uid}', 'ath-1', 't', 'r', ${far});
       INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES ('${uid}', 'g-1', 't', 'r', ${far}, '${today}')`);
  const n = q => sql(q)[0].n;
  // Garmin linked: the AI coach waits for the member's own yes (tests/ask.mjs checks the refusal); this member says yes
  ok((await (await call(token, "PUT", "/api/settings", {ai: true})).json()).ai.on === true, "the member said yes to the AI coach");

  // 1. the watch sends the run to Garmin first: stored, reviewed by the coach (one AI call)
  const start = Math.floor(Date.now() / 1000) - 600, startLocal = new Date(start * 1000).toISOString().slice(0, 19);
  const g = await fetch(API + "/api/garmin/push", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({activities: [{userId: "g-1", summaryId: "ga1", activityType: "RUNNING", activityName: "Evening Run",
    startTimeInSeconds: start, startTimeOffsetInSeconds: 0, durationInSeconds: 3840, distanceInMeters: 13003, averageHeartRateInBeatsPerMinute: 165}]})});
  ok(g.status === 200, "Garmin push accepted");
  for (let i = 0; i < 12 && !n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'"); i++) await sleep(1000);
  ok(n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND source = 'garmin'") === 1, "the Garmin copy of the run is stored");
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") === 1 && aiCalls === 1, "the coach reviewed it once (AI calls: " + aiCalls + ")");

  // 1b. the member gives the Garmin copy their own name
  const gid = sql("SELECT id FROM activities WHERE user_id = '" + uid + "' AND source = 'garmin'")[0].id;
  const r1 = await rename(token, gid, "  Sunday long run with Dad  ");
  ok(r1.status === 200 && r1.j.name === "Sunday long run with Dad" && r1.j.src_name === "Evening Run", "rename: saved, trimmed, and the original name comes back with it (" + r1.status + " " + JSON.stringify(r1.j) + ")");
  const m1 = await mine("ga1");
  ok(m1 && m1.name === "Sunday long run with Dad" && m1.src_name === "Evening Run", "rename: the app is sent the new name, with the original underneath");

  // 2. a minute later Strava has the same run, plus a different run that Garmin never sent
  list = [{id: 777, start_date_local: startLocal + "Z", sport_type: "Run", name: "Evening Run", distance: 13003, moving_time: 3838, average_heartrate: 165, map: {summary_polyline: "abc"}},
          {id: 778, start_date_local: startLocal + "Z", sport_type: "Run", name: "Shakeout", distance: 3219, moving_time: 1200, average_heartrate: 130, map: {summary_polyline: "abc"}}];
  const s = await call(token, "POST", "/api/strava/sync");
  ok(s.ok, "Strava sync ran");
  for (let i = 0; i < 12 && n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") < 2; i++) await sleep(1000);
  await sleep(1500);
  ok(n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND source = 'garmin'") === 1 && n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "' AND ext_id = '777'") === 0, "only one copy of the run is kept: the Garmin one; the Strava copy is never stored");
  const rv = sql("SELECT r.data FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = 'ga1'");
  ok(rv.length === 1 && JSON.parse(rv[0].data).headline === "AI REVIEW" && !JSON.parse(rv[0].data).askFeel, "the coach's review stays on the kept copy; the run was NOT reviewed and announced a second time");
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "' AND activity_id NOT IN (SELECT id FROM activities)") === 0, "no review points at a workout that is not there");
  const other = sql("SELECT r.data FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = '778'");
  ok(other.length === 1 && JSON.parse(other[0].data).askFeel === true, "a Strava run with no Garmin twin is still reviewed, with the how-did-it-feel ask");
  ok(aiCalls === 1, "no extra AI call (Strava data never goes to the AI): " + aiCalls);
  ok(n("SELECT COUNT(*) AS n FROM events WHERE kind = 'strava_sync' AND detail LIKE '%1 already from Garmin%'") === 1, "the event log says one run was already from Garmin (allowed words only, see events_safe.mjs)");

  const m2 = await mine("ga1");
  ok(m2 && m2.name === "Sunday long run with Dad" && m2.src_name === "Evening Run" && m2.source === "garmin", "rename: the name is still on the copy that is kept (" + (m2 && m2.name) + ")");

  // 3. syncing again changes nothing
  await call(token, "POST", "/api/strava/sync"); await sleep(2500);
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "'") === 2 && n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "'") === 2, "a second sync adds nothing");
  const m3 = await mine("ga1");
  ok(m3 && m3.name === "Sunday long run with Dad", "rename: a later sync does not undo it");
  ok(sql("SELECT name, title FROM activities WHERE ext_id = 'ga1'")[0].name === "Evening Run", "rename: the original name is still stored underneath");
  // a second Garmin push of the same run (Garmin re-sends activities) writes Garmin's name again: the member's name stays
  await fetch(API + "/api/garmin/push", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({activities: [{userId: "g-1", summaryId: "ga1", activityType: "RUNNING", activityName: "Evening Run",
    startTimeInSeconds: start, startTimeOffsetInSeconds: 0, durationInSeconds: 3840, distanceInMeters: 13003, averageHeartRateInBeatsPerMinute: 165}]})});
  await sleep(1500);
  ok((await mine("ga1")).name === "Sunday long run with Dad" && aiCalls === 1, "rename: Garmin sending the run again does not undo it, and does not review it again");

  // 3b. the coach bar is sent the Garmin run and never the Strava-only one
  const before = aiCalls, ar = await call(token, "POST", "/api/ask", {q: "How was my run today?"}), arj = await ar.clone().json().catch(() => ({}));
  ok(arj.garmin === true, "an answer that had Garmin data as an input is marked, so the app shows Garmin's attribution line under it");
  ok(ar.status === 200 && aiCalls === before + 1 && /Sunday long run with Dad/.test(lastAI) && /8\.08/.test(lastAI) && /avg_hr\\?":\s*165/.test(lastAI) && !/Shakeout/.test(lastAI), "the coach is sent the Garmin run (the member's name for it, 8.08 mi, 165 bpm) and nothing from the Strava-only run (" + ar.status + ")");

  // 3c. the other order: Strava has the run first, the watch reaches Garmin later
  const start2 = start - 86400, local2 = new Date(start2 * 1000).toISOString().slice(0, 19);
  list = [{id: 880, start_date_local: local2 + "Z", sport_type: "Run", name: "Lunch Run", distance: 8047, moving_time: 2700, average_heartrate: 150, map: {summary_polyline: "abc"}}];
  await call(token, "POST", "/api/strava/sync");
  for (let i = 0; i < 12 && !n("SELECT COUNT(*) AS n FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = '880'"); i++) await sleep(1000);
  const s880 = sql("SELECT id FROM activities WHERE ext_id = '880'")[0];
  ok(!!s880 && JSON.parse(sql("SELECT data FROM reviews WHERE activity_id = '" + s880.id + "'")[0].data).askFeel === true, "Strava first: the run is stored and gets the no-AI review");
  await rename(token, s880.id, "Lunch miles"); await call(token, "PUT", "/api/activity/" + s880.id + "/effort", {rpe: 7});
  const ai2 = aiCalls;
  await fetch(API + "/api/garmin/push", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({activities: [{userId: "g-1", summaryId: "ga2", activityType: "RUNNING", activityName: "Lunch Run",
    startTimeInSeconds: start2, startTimeOffsetInSeconds: 0, durationInSeconds: 2702, distanceInMeters: 8047, averageHeartRateInBeatsPerMinute: 150}]})});
  for (let i = 0; i < 12 && aiCalls === ai2; i++) await sleep(1000);
  await sleep(1500);
  const g2 = sql("SELECT id, title, rpe, name FROM activities WHERE user_id = '" + uid + "' AND ext_id = 'ga2'")[0];
  ok(!!g2 && n("SELECT COUNT(*) AS n FROM activities WHERE ext_id = '880'") === 0, "Garmin second: the Garmin copy replaces the Strava copy (one copy kept)");
  ok(!!g2 && g2.title === "Lunch miles" && g2.rpe === 7, "Garmin second: the member's own name and effort moved onto the Garmin copy (" + JSON.stringify(g2) + ")");
  const rv2 = g2 ? sql("SELECT data FROM reviews WHERE activity_id = '" + g2.id + "'") : [];
  ok(rv2.length === 1 && JSON.parse(rv2[0].data).headline === "AI REVIEW" && aiCalls === ai2 + 1, "Garmin second: the coach reviewed it from the real numbers, once");
  ok(n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = '" + uid + "' AND activity_id NOT IN (SELECT id FROM activities)") === 0, "Garmin second: no review is left pointing at the removed Strava copy");
  await call(token, "POST", "/api/strava/sync"); await sleep(2000);
  ok(n("SELECT COUNT(*) AS n FROM activities WHERE ext_id = '880'") === 0 && n("SELECT COUNT(*) AS n FROM activities WHERE user_id = '" + uid + "'") === 3, "Garmin second: the next Strava sync does not bring the Strava copy back");

  // 3d. AI coach switched off: a new Garmin run still gets the fixed-rule review, and nothing goes to the AI
  await call(token, "PUT", "/api/settings", {ai: false});
  const ai3 = aiCalls, start3 = start - 2 * 86400;
  await fetch(API + "/api/garmin/push", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({activities: [{userId: "g-1", summaryId: "ga3", activityType: "RUNNING", activityName: "Morning Run",
    startTimeInSeconds: start3, startTimeOffsetInSeconds: 0, durationInSeconds: 1800, distanceInMeters: 4828, averageHeartRateInBeatsPerMinute: 140}]})});
  for (let i = 0; i < 12 && !n("SELECT COUNT(*) AS n FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = 'ga3'"); i++) await sleep(1000);
  const rv3 = sql("SELECT r.data FROM reviews r JOIN activities a ON a.id = r.activity_id WHERE a.ext_id = 'ga3'");
  ok(rv3.length === 1 && JSON.parse(rv3[0].data).headline !== "AI REVIEW" && !JSON.parse(rv3[0].data).askFeel && aiCalls === ai3, "AI coach off: a Garmin run gets the fixed-rule review and nothing is sent to the AI (" + (rv3[0] && JSON.parse(rv3[0].data).headline) + ")");
  ok((await call(token, "POST", "/api/ask", {q: "How was that?"})).status === 403 && aiCalls === ai3, "AI coach off: the coach bar is refused");
  await call(token, "PUT", "/api/settings", {ai: true});
  sql("DELETE FROM reviews WHERE activity_id IN (SELECT id FROM activities WHERE ext_id = 'ga3'); DELETE FROM activities WHERE ext_id = 'ga3'");

  // 4. renaming: the edges
  const sid = m3.id;   // the Garmin copy
  const junk = await rename(token, sid, "Tempo <script>alert(1)</script>\u0000\u202E day " + "x".repeat(80));
  ok(junk.status === 200 && junk.j.name.length <= 60 && !/[<>\u0000-\u001F\u202E]/.test(junk.j.name) && /^Tempo script/.test(junk.j.name), "rename: tags and control characters are stripped and the name is cut to 60 (" + JSON.stringify(junk.j.name) + ")");
  const same = await rename(token, sid, "Evening Run");
  ok(same.status === 200 && same.j.name === "Evening Run" && same.j.src_name === null && sql("SELECT title FROM activities WHERE id = '" + sid + "'")[0].title === null, "rename: typing the original name back clears the rename");
  await rename(token, sid, "Again");
  const empty = await rename(token, sid, "   ");
  ok(empty.status === 200 && empty.j.name === "Evening Run" && empty.j.src_name === null, "rename: an empty name puts the original back");
  ok((await rename(token, sid, 12345)).status === 400 && (await rename(token, sid, {a: 1})).status === 400, "rename: a name that is not text is refused");
  const otherTok = (await (await call(null, "POST", "/api/signup", {email: "onep-" + Date.now() + "@example.com", password: "one-push-test-123", name: "Other", agree: true, adult: true})).json()).token;
  const oid = sql("SELECT id FROM users WHERE email LIKE 'onep-%'")[0].id;
  sql(`INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, created) VALUES ('aaaaaaaaaaaaaaaaaaaa', '${oid}', 'manual', NULL, '${today}', 'run', 'Their run', 3, 30, '${new Date().toISOString()}')`);
  const theirs = await rename(token, "aaaaaaaaaaaaaaaaaaaa", "Mine now");
  ok(theirs.status === 404 && sql("SELECT title FROM activities WHERE id = 'aaaaaaaaaaaaaaaaaaaa'")[0].title === null, "rename: someone else's workout cannot be renamed (" + theirs.status + ")");
  ok((await rename(null, sid, "x y")).status === 401, "rename: no login, no rename");
  const meOther = await (await call(otherTok, "GET", "/api/me")).json(), prev = await rename(otherTok, "aaaaaaaaaaaaaaaaaaaa", "My own run");
  ok(meOther.features && meOther.features.rename === true && prev.status === 200 && prev.j.name === "My own run" && prev.j.src_name === "Their run", "rename (released): a member who is not the owner can rename their own workout");
  ok((await rename(otherTok, sid, "Not yours")).status === 404 && (await mine("ga1")).name === "Evening Run", "rename: and cannot touch the owner's workout");
} catch(e){ ok(false, "test crashed: " + (e && e.stack || e)); }
finally { stop(); }
console.log(failed ? failed + " problem(s)" : "ALL PASS");
process.exit(failed ? 1 : 0);
