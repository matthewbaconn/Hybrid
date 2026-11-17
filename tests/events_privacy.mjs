// Event-log privacy test (Matthew, Nov 17, 2026). The "Recent server events" workflow log is PUBLIC, so this fails if
// personal or free-text content can reach events.detail or the workflow's output. Three layers:
//   A. the filter itself (api/events_safe.mjs) against realistic hostile and error text;
//   B. the exact public query + printer against a throwaway local database seeded with hostile rows;
//   C. the real API (own local server, stand-in AI and fake webhooks that echo personal data back), then every
//      detail it wrote must be safe and no planted secret may appear anywhere.
// Runs in PR checks from tests/webhooks.mjs (pr-checks.yml is a protected file).  cd api && node ../tests/events_privacy.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url)), APIDIR = join(HERE, "..", "api");
const {safeDetail, REMOVED, apiErrType, routeOf, errName, publicEventsSQL, formatPublic, PUBLIC_COLUMNS} = await import(join(APIDIR, "events_safe.mjs"));

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + "events privacy: " + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// planted markers: none of these may ever come out of the public path
const SECRETS = ["Jane Doe", "jane.doe", "gmail.com", "Lake Park", "STRAVASECRET", "hunter2", "sk-ant-", "<script", "DROP TABLE", "resting HR"];
const leaks = text => SECRETS.filter(s => String(text).toLowerCase().includes(s.toLowerCase()));

// ---------- A. the filter ----------
const keep = ["3 seen, 1 new", "3 seen, 1 new, 1 already reviewed from Garmin", "HTTP 202", "net", "refresh HTTP 401", "confirmed",
  "ignored: Strava says 500", "429 rate limited", "dailies:3,sleeps:1,hrv:2", "confirmed by Garmin", "ignored: Garmin still accepts the link (200)",
  "create 400", "schedule net", "4 sent, 0 removed, 1 failed", "api 400 invalid_request_error", "unreadable reply (max_tokens, 812 chars)",
  "move,open", "57", "expired subscription removed (410)", "morning-2026-11-17", "run-3f9a2c41b7d0", "mail-2026-11-17-weekly", "error TypeError",
  "outbox TypeError", "cron error", "test 1 sent, 0 failed", "12 sent, 0 failed", "token HTTP 400", "user id HTTP 500", "activityDetails 400",
  "stopped after 412, permissions 2", "apple 5 types", "activity create", "athlete update", "sent", "signed in", "not signed in", "3 found",
  "api 529 overloaded_error", "GET /api/food TypeError", "POST /api/:id error", "GET /api/food/:id TypeError", "photo", "bad json", "400 invalid_request_error", "push", "mail", "unreadable reply 151 chars"];
for (const d of keep) ok(safeDetail(d) === d, "keeps a safe code: " + JSON.stringify(d));
const hostile = [
  "unreadable: Jane Doe had 2 eggs and toast at Lake Park cafe",                         // an AI reply (old ai_food path)
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"jane.doe@gmail.com"}}', // an API error body (old path)
  "api 500 Internal error for user Jane Doe",                                              // free-text service message
  "jane.doe@gmail.com", "Jane.Doe at gmail dot com", "Jane Doe",                              // email, obfuscated email, a name
  "Morning Run 6.2 mi around Lake Park (STRAVASECRET)",                                     // Strava activity name
  "resting HR 48 bpm, slept 5.1 h",                                                         // health values in words
  "<script>fetch('//x')</script>", "'; DROP TABLE users; --", "password hunter2",
  "token sk-ant-api03-AAAA", "Bearer eyJhbGciOi", "cron: Cannot read properties of undefined (reading 'email')",
  "i ate scrambled eggs", "x".repeat(200), "a b c d e f g h i j k l m n o p q",               // lowercase free text, too long, too many words
  "GET /api/john.smith@x.com: TypeError", "run-JaneDoe", "morning-<b>", "😀 great run"];
for (const d of hostile) ok(safeDetail(d) === REMOVED, "removes hostile text: " + JSON.stringify(d.slice(0, 60)));
ok(safeDetail(null) === null && safeDetail("") === null, "empty detail stays empty");
ok(apiErrType('{"type":"error","error":{"type":"rate_limit_error","message":"Jane Doe jane.doe@gmail.com"}}') === "rate_limit_error", "API error body -> its type code only");
ok(apiErrType('{"error":{"type":"Jane Doe"}}') === "error" && apiErrType("<html>502 Bad Gateway for jane.doe@gmail.com</html>") === "error", "unknown error types and non-JSON bodies -> \"error\"");
ok(routeOf("/api/food/analyze") === "/api/food/:id" && routeOf("/api/jane.doe@gmail.com") === "/api/:id" && routeOf("/../etc/passwd") === "other", "paths -> route only");
class Weird extends Error { constructor(){ super("Jane Doe's data"); this.name = "JaneDoeError"; } }
ok(errName(new TypeError("Cannot read jane.doe@gmail.com")) === "TypeError" && errName(new Weird()) === "error" && errName("Jane Doe") === "error", "errors -> their class name only, never the message");

// every write to the events table goes through safeDetail, and no call site hands over free text
const W = readFileSync(join(APIDIR, "worker.js"), "utf8");
ok((W.match(/INSERT INTO events/g) || []).length === 1, "worker.js writes the events table in exactly one place");
ok(/INSERT INTO events \(ts, kind, ok, detail\) VALUES \(\?, \?, \?, \?\)"\)\.bind\(now\(\), kind, ok \? 1 : 0, safeDetail\(detail\)\)/.test(W), "that one place stores safeDetail(detail)");
const calls = W.split("logEvent(env, ").slice(1).map(c => c.slice(0, 260).split(/\);|\)\)\)|\)\);/)[0]);
const bad = calls.map(c => c.replace(/apiErrType\(await \w+\.text\(\)(\.catch\(\(\) => ""\))?\)/g, "apiErrType()")).filter(c => /\.text\(\)|\.message|JSON\.stringify|raw\.slice|\bt\)$|\bt\b \+|\+ t\b|\.permissions\b(?!.*length)|Object\.keys\(saved\)\.join/.test(c));
ok(calls.length >= 50 && bad.length === 0, "no logEvent call passes AI text, error messages or response bodies (" + calls.length + " calls" + (bad.length ? "; bad: " + bad.map(b => b.slice(0, 60)).join(" | ") : "") + ")");

// the public query and printer
const q = publicEventsSQL("ai_%,strava%'; DELETE FROM users; --,garmin%");
const selectList = q.slice(0, q.indexOf(" FROM events"));
ok(!/\bdetail\b/.test(q) && [...selectList.matchAll(/ AS (\w+)/g)].map(m => m[1]).join() === "ok_24h,failed_24h,ok_3d,failed_3d" && /^SELECT kind, /.test(selectList), "public query selects only kind and four totals (never detail or a time)");
ok(!/DELETE|;|--/.test(q) && q.includes("kind LIKE 'strava%users'"), "kind patterns can't inject SQL (quotes, ; and -- are stripped)");
ok(PUBLIC_COLUMNS.join() === "kind,ok_24h,failed_24h,ok_3d,failed_3d", "public columns are the five totals");
const pj = rows => JSON.stringify([{results: rows, success: true}]);
const throws = f => { try { f(); return false; } catch(e){ return /refusing to print/.test(e.message); } };
ok(throws(() => formatPublic(pj([{kind: "ai_food", ok_24h: 1, failed_24h: 0, ok_3d: 1, failed_3d: 0, detail: "Jane Doe"}]))), "printer refuses an extra column");
ok(throws(() => formatPublic(pj([{kind: "jane.doe@gmail.com", ok_24h: 1, failed_24h: 0, ok_3d: 1, failed_3d: 0}]))), "printer refuses a strange kind");
ok(throws(() => formatPublic(pj([{kind: "push", ok_24h: "Jane Doe", failed_24h: 0, ok_3d: 1, failed_3d: 0}]))), "printer refuses a non-number");
ok(throws(() => formatPublic(pj([{kind: "push", ok_24h: 1, failed_24h: 0, ok_3d: 1}]))), "printer refuses a missing column");

// ---------- B + C need wrangler and a throwaway local database ----------
const PORT = 8796, MOCK = 9916, API = "http://127.0.0.1:" + PORT;
let ai = {status: 200, body: "{}"}, aiCalls = 0;
const mock = http.createServer((req, res) => { req.on("data", () => {}); req.on("end", () => {
  aiCalls++; res.writeHead(ai.status, {"Content-Type": "application/json"}); res.end(ai.body); }); }).listen(MOCK, "127.0.0.1");
const dir = mkdtempSync(join(tmpdir(), "evp-"));
const wr = args => execFileSync("npx", ["wrangler", "d1", ...args], {cwd: APIDIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: {...process.env, CI: "1"}});
const sql = cmd => JSON.parse(wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", cmd]))[0].results;
wr(["migrations", "apply", "hybrid", "--local", "--persist-to", dir]);
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "ANTHROPIC_URL:http://127.0.0.1:" + MOCK, "--var", "ANTHROPIC_API_KEY:test-key"], {cwd: APIDIR, stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

try {
  // B. hostile rows straight into the table (as an older build might have left them), then the exact public path
  const now = new Date().toISOString();
  sql(`INSERT INTO events (ts, kind, ok, detail) VALUES
    ('${now}', 'ai_food', 0, 'unreadable: Jane Doe ate eggs at Lake Park'), ('${now}', 'ai_food', 1, NULL),
    ('${now}', 'strava_sync', 1, '3 seen, 1 new STRAVASECRET'), ('${now}', 'health_import', 1, 'apple: resting HR 48'),
    ('${now}', 'signup_notice', 1, 'HTTP 202 jane.doe@gmail.com'), ('${now}', 'server_error', 0, 'GET /api/x: hunter2 <script>'),
    ('${now}', 'push', 1, 'morning-2026-11-17'), ('2026-01-01T00:00:00.000Z', 'push', 0, 'old Jane Doe row')`);
  const raw = wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", publicEventsSQL("%")]);
  const printed = formatPublic(raw);
  ok(leaks(raw).length === 0 && leaks(printed).length === 0, "public query output holds none of the planted secrets" + (leaks(raw + printed).length ? ": " + leaks(raw + printed) : ""));
  const rows = JSON.parse(raw)[0].results, by = Object.fromEntries(rows.map(r => [r.kind, r]));
  ok(rows.every(r => Object.keys(r).sort().join() === [...PUBLIC_COLUMNS].sort().join()), "every output row is exactly the five totals");
  ok(by.ai_food && by.ai_food.ok_3d === null && by.ai_food.failed_3d === 1 && by.strava_sync.ok_3d === null && by.health_import.ok_3d === null, "food, Strava and health show failures only, never success counts");
  ok(by.signup_notice.ok_3d === 1 && by.push.ok_24h === 1 && by.push.failed_3d === 0 && by.server_error.failed_24h === 1, "other kinds show their totals (rows older than 3 days left out)");
  console.log("sample of the public output:\n" + printed);

  // C. the real API writes events while outside services echo personal data back
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, method, path, data) => fetch(API + path, {method, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined});
  const token = (await (await call(null, "POST", "/api/signup", {email: "evp-" + Date.now() + "@example.com", password: "privacy-test-123", name: "Privacy Test", agree: true, adult: true})).json()).token;
  ok(!!token, "signed up a throwaway local member");
  const iso = d => d.toISOString().slice(0, 10), today = iso(new Date());
  await call(token, "PUT", "/api/profile", {profile: {name: "Privacy Test", goal: "half", raceDate: iso(new Date(Date.now() + 80 * 864e5)), goalSec: 6240, weekly: 20, longest: 8, prDist: "10k", prSec: 2910, easyPace: null, weight: 178, goalWeight: 172, lifts: 3, liftExp: "Some", days: [1, 2, 3, 5, 6], longDay: 6}});
  sql("DELETE FROM events");
  const PII = "Jane Doe (jane.doe@gmail.com) ran 6.2 mi around Lake Park, resting HR 48 bpm, password hunter2, key sk-ant-api03-AAAA <script>x</script>";
  const before = aiCalls;
  ai = {status: 400, body: JSON.stringify({type: "error", error: {type: "invalid_request_error", message: PII}})};
  await call(token, "POST", "/api/food/analyze", {text: "2 eggs, Jane Doe's breakfast"});
  ai = {status: 200, body: JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: "Sorry " + PII + " no JSON here"}]})};
  await call(token, "POST", "/api/food/analyze", {text: "toast"});
  ai = {status: 500, body: JSON.stringify({type: "error", error: {type: "api_error", message: PII}})};
  await call(token, "POST", "/api/ask", {q: "what is today's workout? " + PII});
  ai = {status: 200, body: JSON.stringify({stop_reason: "max_tokens", content: [{type: "text", text: PII}]})};
  await call(token, "POST", "/api/ask", {q: "and tomorrow?"});
  ok(aiCalls - before >= 3, "the stand-in AI was really called (" + (aiCalls - before) + " times)");
  const post = (path, body) => fetch(API + path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  await post("/api/strava/webhook", {object_type: "jane.doe@gmail.com", aspect_type: "<script>x</script>", owner_id: "nobody", object_id: 1});
  await post("/api/garmin/push", {"Jane Doe": [{userId: "nobody"}], "dailies": [{userId: "nobody"}]});
  await fetch(API + "/api/jane.doe@gmail.com/hunter2", {headers: {Origin: "http://localhost:8000"}});
  await sleep(2000);
  const ev = sql("SELECT kind, ok, detail FROM events");
  const unsafe = ev.filter(e => e.detail !== null && e.detail !== REMOVED && safeDetail(e.detail) !== e.detail);
  const dump = JSON.stringify(ev);
  ok(ev.length >= 4, "the API logged events for these calls (" + ev.length + ": " + [...new Set(ev.map(e => e.kind))].join(",") + ")");
  ok(unsafe.length === 0, "every detail the API wrote is a safe code" + (unsafe.length ? ": " + JSON.stringify(unsafe).slice(0, 200) : ""));
  ok(leaks(dump).length === 0, "no planted secret reached the events table" + (leaks(dump).length ? ": " + leaks(dump) : ""));
  const aiFood = ev.filter(e => e.kind === "ai_food").map(e => e.detail);
  ok(aiFood.includes("400 invalid_request_error") && aiFood.some(d => /^unreadable reply \d+ chars$/.test(d)), "AI food failures are logged as codes: " + JSON.stringify(aiFood));
  ok(leaks(formatPublic(wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", publicEventsSQL("%")]))).length === 0, "public output after the hostile calls is clean");
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { stop(); }
console.log(failed ? failed + " event privacy check(s) failed" : "events privacy: all checks pass");
process.exit(failed ? 1 : 0);
