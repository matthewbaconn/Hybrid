// First-workout reminder test (B7). Runs its own local API with a fake email service and a throwaway local database,
// so it never touches live data or sends real mail. Checks: a member who built a plan 3+ days ago and never checked off
// or synced a workout gets exactly ONE reminder, ever; members who trained, just built a plan, unsubscribed, or are
// test (@example.com) accounts get nothing.
//   cd api && node ../tests/first_workout.mjs
import http from "node:http";
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8792, MOCK = 9912, API = "http://127.0.0.1:" + PORT;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mails = [];   // fake Resend: record every email
const mock = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { mails.push(JSON.parse(b)); } catch(e){} res.writeHead(200, {"Content-Type": "application/json"}); res.end('{"id":"m"}'); }); }).listen(MOCK, "127.0.0.1");

const dir = mkdtempSync(join(tmpdir(), "fw-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--test-scheduled",
  "--var", "RESEND_API_KEY:test", "--var", "RESEND_URL:http://127.0.0.1:" + MOCK + "/emails", "--var", "OUTBOX_URL:http://127.0.0.1:" + MOCK + "/none"], {stdio: process.env.FW_DEBUG ? "inherit" : "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };

// a time zone where it's about noon right now, so the 9 am-7 pm window is open
let off = 12 - new Date().getUTCHours(); if (off > 12) off -= 24; if (off < -11) off += 24;
const tz = off === 0 ? "Etc/GMT" : "Etc/GMT" + (off > 0 ? "-" : "+") + Math.abs(off);
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const mon = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 14); return d.toISOString().slice(0, 10); })();
const profile = JSON.stringify({name: "T", goal: "half", start: mon, raceDate: day(70), goalSec: 6240, weekly: 20, longest: 8, prDist: "10k", prSec: 2910, weight: 178, goalWeight: 172, lifts: 3, liftExp: "Some", days: [0, 1, 2, 3, 4, 5, 6], longDay: 6});

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const signup = async (email, name) => { const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({email, password: "first-workout-123", name, agree: true})}); return (await r.json()).token; };
  const t0 = Date.now();
  await signup("owner-" + t0 + "@fw.test", "Owner");   // oldest real account = the owner, never counted
  for (const k of ["due", "trained", "fresh", "unsub", "robot"]) ok(!!(await signup((k === "robot" ? "robot-" + t0 + "@example.com" : k + "-" + t0 + "@fw.test"), k[0].toUpperCase() + k.slice(1))), "signed up " + k);
  const id = {}; for (const r of sql("SELECT id, name FROM users")) id[r.name] = r.id;
  sql(`INSERT OR IGNORE INTO not_members (user_id, why, created) VALUES ('${id.Owner}', 'owner', '${day(0)}');
       UPDATE lifecycle_mail SET sent_at = '${day(-10)}';`);
  const p = profile.replace(/'/g, "''");
  for (const n of ["Owner", "Due", "Trained", "Fresh", "Unsub", "Robot"]){
    sql(`INSERT INTO profiles (user_id, data, updated) VALUES ('${id[n]}', '${p}', '${n === "Fresh" ? new Date().toISOString() : day(-5) + "T12:00:00.000Z"}');
         INSERT INTO settings (user_id, data) VALUES ('${id[n]}', '{"tz":"${tz}"}') ON CONFLICT (user_id) DO UPDATE SET data = excluded.data;`);
  }
  sql(`INSERT INTO done (user_id, key) VALUES ('${id.Trained}', '${day(-2)}-0'); UPDATE users SET no_mail = 1 WHERE id = '${id.Unsub}'; UPDATE users SET created = '${day(-6)}T00:00:00.000Z';`);
  mails.length = 0;

  // the first request after the database is edited from outside can hit a closed keep-alive socket: retry it
  const tick = async () => { for (let k = 0; k < 4; k++){ try { if ((await fetch(API + "/__scheduled?cron=*+*+*+*+*")).ok) break; } catch(e){} await sleep(1000); } await sleep(4000); };
  await tick();
  const to = e => mails.filter(m => (m.to || []).some(x => x.startsWith(e + "-")) && /first workout/i.test(m.subject || ""));
  ok(to("due").length === 1, "member with a 5-day-old plan and no workout got one reminder (" + to("due").length + ")");
  const m = to("due")[0] || {};
  ok(/Your first workout, Due/.test(m.subject || ""), "subject: " + m.subject);
  ok(/I did it/.test(m.text || "") && /Matthew/.test(m.text || "") && /Unsubscribe/.test(m.text || ""), "body names the one tap, is signed Matthew, has unsubscribe");
  ok(to("trained").length === 0, "member who checked off a workout got nothing");
  ok(to("fresh").length === 0, "member who just built a plan got nothing");
  ok(to("unsub").length === 0, "unsubscribed member got nothing");
  ok(to("owner").length === 0 && to("robot").length === 0, "owner and test accounts got nothing");
  ok(sql(`SELECT COUNT(*) AS n FROM lifecycle_mail WHERE kind = 'first_workout' AND ok = 1 AND user_id = '${id.Due}'`)[0].n === 1, "recorded once in lifecycle_mail");
  await tick();
  ok(to("due").length === 1, "second cron run: still only one reminder, ever");
  ok(sql(`SELECT COUNT(*) AS n FROM done`)[0].n === 1 && sql(`SELECT COUNT(*) AS n FROM profiles`)[0].n === 6, "member data unchanged");
} catch(e){ ok(false, "test crashed: " + (e && e.message)); }
stop();
console.log(failed ? failed + " check(s) failed" : "ALL PASS");
process.exit(failed ? 1 : 0);
