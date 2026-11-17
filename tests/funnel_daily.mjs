// Members-trained counts (audit P1-2, Nov 17, 2026). Runs its own local API on a throwaway local database, so it
// never touches live data. Checks: the cron writes ONE funnel_daily row per day with totals only; "trained" counts
// a check-off OR a synced workout; "checked_off" counts check-offs alone; trained_7d only counts the last 7 days;
// the owner and @example.com test accounts are never counted; member data is unchanged; the owner-only
// /api/admin/funnel keeps its shape (workout = trained).
//   cd api && node ../tests/funnel_daily.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8794, API = "http://127.0.0.1:" + PORT;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "fd-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--test-scheduled",
  "--var", "OUTBOX_URL:http://127.0.0.1:1/none"], {stdio: process.env.FD_DEBUG ? "inherit" : "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} rmSync(dir, {recursive: true, force: true}); };
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const signup = async (email, name) => { const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({email, password: "funnel-daily-123", name, agree: true})}); return (await r.json()).token; };
  const t0 = Date.now(), tok = {};
  tok.Owner = await signup("owner-" + t0 + "@fd.test", "Owner");   // oldest real account = the owner, never counted
  for (const k of ["Checked", "Synced", "Old", "Planonly", "Noplan", "Robot"]) { tok[k] = await signup((k === "Robot" ? "robot-" + t0 + "@example.com" : k.toLowerCase() + "-" + t0 + "@fd.test"), k); ok(!!tok[k], "signed up " + k); }
  const id = {}; for (const r of sql("SELECT id, name FROM users")) id[r.name] = r.id;
  sql(`INSERT OR IGNORE INTO not_members (user_id, why, created) VALUES ('${id.Owner}', 'owner', '${day(0)}');`);
  for (const n of ["Owner", "Checked", "Synced", "Old", "Planonly", "Robot"]) sql(`INSERT INTO profiles (user_id, data, updated) VALUES ('${id[n]}', '{"name":"T"}', '${day(-3)}T12:00:00.000Z');`);
  const act = (n, d) => `INSERT INTO activities (id, user_id, source, date, type, name, created) VALUES ('a-${n}-${d}', '${id[n]}', 'strava', '${d}', 'run', 'Run', '${d}T12:00:00.000Z');`;
  sql(`INSERT INTO done (user_id, key) VALUES ('${id.Checked}', '${day(-1)}-0'); INSERT INTO done (user_id, key) VALUES ('${id.Owner}', '${day(-1)}-0');
       ${act("Synced", day(-2))} ${act("Old", day(-20))} ${act("Robot", day(-1))} ${act("Owner", day(-1))}`);
  // everyone joined 10 days ago (logins that day too); Synced joined through Checked's invite link
  sql(`UPDATE users SET created = '${day(-10)}T09:00:00.000Z'; UPDATE sessions SET created = '${day(-10)}T09:00:00.000Z'; UPDATE users SET ref = '${id.Checked}' WHERE id = '${id.Synced}';`);
  const before = {done: sql("SELECT COUNT(*) AS n FROM done")[0].n, acts: sql("SELECT COUNT(*) AS n FROM activities")[0].n, profiles: sql("SELECT COUNT(*) AS n FROM profiles")[0].n};

  const tick = async () => { for (let k = 0; k < 4; k++){ try { if ((await fetch(API + "/__scheduled?cron=*+*+*+*+*")).ok) break; } catch(e){} await sleep(1000); } await sleep(4000); };
  await tick();
  const rows = sql("SELECT day, signed_up, plan, checked_off, trained, trained_7d, d7_eligible, active_d7, returned, via_invite, referrers FROM funnel_daily");
  ok(rows.length === 1 && rows[0].day === new Date().toISOString().slice(0, 10), "cron wrote one row for today (" + rows.length + ")");
  const r = rows[0] || {};
  ok(r.signed_up === 5, "real members counted, owner and test account left out (" + r.signed_up + ")");
  ok(r.plan === 4, "built a plan (" + r.plan + ")");
  ok(r.checked_off === 1, "checked off in the app (" + r.checked_off + ")");
  ok(r.trained === 3, "trained = check-off OR synced workout (" + r.trained + ")");
  ok(r.trained_7d === 2, "trained in the last 7 days leaves out the 20-day-old run (" + r.trained_7d + ")");
  ok(r.returned === 2, "returned = activity on a later day than sign-up: the check-off and the synced run, not the run from before joining (" + r.returned + ")");
  ok(r.via_invite === 1 && r.referrers === 1, "joined through an invite and members who brought someone (" + r.via_invite + ", " + r.referrers + ")");
  const cols = sql("SELECT name FROM pragma_table_info('funnel_daily')").map(c => c.name);
  ok(!cols.some(c => /user|name|email|mi|pace|hr|src/i.test(c)), "funnel_daily holds totals only: " + cols.join(","));
  await tick();
  ok(sql("SELECT COUNT(*) AS n FROM funnel_daily")[0].n === 1, "second cron run the same day refreshes the row, no duplicate");
  ok(sql("SELECT COUNT(*) AS n FROM done")[0].n === before.done && sql("SELECT COUNT(*) AS n FROM activities")[0].n === before.acts && sql("SELECT COUNT(*) AS n FROM profiles")[0].n === before.profiles, "member data unchanged");
  const owner = await (await fetch(API + "/api/admin/funnel", {headers: {Authorization: "Bearer " + tok.Owner}})).json();
  ok(owner.funnel && owner.funnel.workout === 3 && owner.funnel.trained === 3 && owner.funnel.checked_off === 1 && owner.funnel.returned === 2, "owner's Members funnel: workout = trained (" + JSON.stringify(owner.funnel) + ")");
  const other = await fetch(API + "/api/admin/funnel", {headers: {Authorization: "Bearer " + tok.Checked}});
  ok(other.status === 403, "a member can't read the funnel (" + other.status + ")");
} catch(e){ ok(false, "test crashed: " + (e && e.message)); }
stop();
console.log(failed ? failed + " check(s) failed" : "ALL PASS");
process.exit(failed ? 1 : 0);
