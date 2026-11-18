// Food-read retry test (Nov 17, 2026: 6 failed AI food reads in 3 days). Own local API + a stand-in AI that answers
// from a script. Checks: a busy/overloaded API or a reply without JSON gets exactly one more try; a bad request does
// not; a read that fails on our side gives the member's daily read back (an unreadable photo still counts);
// a good read counts once.
// Runs in PR checks from tests/webhooks.mjs (pr-checks.yml is a protected file).  cd api && node ../tests/food_retry.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url)), APIDIR = join(HERE, "..", "api");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + "food retry: " + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GOOD = {status: 200, body: JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: '{"items":[{"name":"2 eggs","cal":140,"protein":12,"carbs":1,"fat":10}],"note":"ok"}'}]})};
const PROSE = {status: 200, body: JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: "Looks like a tasty breakfast!"}]})};
const BUSY = {status: 529, body: JSON.stringify({type: "error", error: {type: "overloaded_error", message: "Overloaded"}})};
const BAD = {status: 400, body: JSON.stringify({type: "error", error: {type: "invalid_request_error", message: "bad image"}})};

const PORT = 8797, MOCK = 9917, API = "http://127.0.0.1:" + PORT;
let script = [], calls = 0, systems = [];
const mock = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => {
  calls++; try { systems.push(JSON.parse(b).system || ""); } catch(e){ systems.push(""); }
  const a = script.shift() || GOOD; res.writeHead(a.status, {"Content-Type": "application/json"}); res.end(a.body); }); }).listen(MOCK, "127.0.0.1");
const dir = mkdtempSync(join(tmpdir(), "food-"));
const wr = args => execFileSync("npx", ["wrangler", "d1", ...args], {cwd: APIDIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: {...process.env, CI: "1"}});
const sql = cmd => JSON.parse(wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", cmd]))[0].results;
wr(["migrations", "apply", "hybrid", "--local", "--persist-to", dir]);
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "ANTHROPIC_URL:http://127.0.0.1:" + MOCK, "--var", "ANTHROPIC_API_KEY:test-key"], {cwd: APIDIR, stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, method, path, data) => fetch(API + path, {method, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined});
  const token = (await (await call(null, "POST", "/api/signup", {email: "food-" + Date.now() + "@example.com", password: "food-retry-test-123", name: "Food Test", agree: true, adult: true})).json()).token;
  ok(!!token, "signed up a throwaway local member");
  const used = () => { const r = sql("SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage"); return r[0].n; };
  const read = async (steps) => { script = [...steps]; const c0 = calls; systems = [];
    const r = await call(token, "POST", "/api/food/analyze", {text: "2 eggs"}); return {status: r.status, body: await r.json().catch(() => ({})), calls: calls - c0}; };

  let r = await read([GOOD]);
  ok(r.status === 200 && r.body.items && r.body.items[0].name === "2 eggs" && r.calls === 1, "a good read answers on the first try");
  ok(used() === 1, "a good read counts once (" + used() + ")");

  r = await read([BUSY, GOOD]);
  ok(r.status === 200 && r.calls === 2, "an overloaded API (529) gets one more try and the read succeeds (" + r.status + ", " + r.calls + " calls)");
  ok(used() === 2, "the retried read still counts once (" + used() + ")");

  r = await read([PROSE, GOOD]);
  ok(r.status === 200 && r.calls === 2 && /JSON object only/.test(systems[1] || "") && !/JSON object only/.test(systems[0] || ""), "a reply without JSON gets one more try that asks for JSON only");

  r = await read([BAD]);
  ok(r.status === 502 && r.calls === 1, "a bad request (400) is not retried (" + r.calls + " calls)");
  ok(used() === 3, "a failed read gives the member's read back (" + used() + ")");

  r = await read([BUSY, BUSY]);
  ok(r.status === 502 && r.calls === 2 && /try again in a minute/i.test(r.body.error || r.body.message || JSON.stringify(r.body)), "two busy answers: stop after two calls, friendly message");
  ok(used() === 3, "still no read used up (" + used() + ")");

  r = await read([PROSE, PROSE]);
  ok(r.status === 502 && r.calls === 2 && /clearer photo/i.test(JSON.stringify(r.body)), "two unreadable replies: stop, ask for a clearer photo");
  ok(used() === 4, "an unreadable photo still uses a read, so junk photos can't get around the daily cap (" + used() + ")");

  await sleep(500);
  const ev = sql("SELECT ok, detail FROM events WHERE kind = 'ai_food' ORDER BY rowid");
  const fails = ev.filter(e => !e.ok).map(e => e.detail), wins = ev.filter(e => e.ok).length;
  ok(wins === 3 && fails.length === 3, "one event per read, not per try (" + wins + " ok, " + fails.length + " failed)");
  ok(fails.includes("400 invalid_request_error") && fails.includes("529 overloaded_error") && fails.some(d => /^unreadable reply \d+ chars$/.test(d)), "failures keep their safe codes: " + JSON.stringify(fails));
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { stop(); }
console.log(failed ? failed + " food retry check(s) failed" : "food retry: all checks pass");
process.exit(failed ? 1 : 0);
