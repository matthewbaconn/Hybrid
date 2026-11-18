// Pinned lifting days (Nov 17, in preview as "liftdays"). Runs its own local API against a throwaway local database,
// so it never touches live data. Checks that:
//   - /api/me tells only the owner's account the lift-day picker is on
//   - a member's saved plan never keeps liftDays while the feature is in preview; the owner's does
//   - plan logic for pinned days is in tests/plan_features.mjs
//   cd api && node ../tests/lift_days.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8793, API = "http://127.0.0.1:" + PORT, OWNER = "owner-lift@mileset-test.dev";
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "lift-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--var", "OWNER_EMAIL:" + OWNER], {stdio: "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} rmSync(dir, {recursive: true, force: true}); };
try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, method, path, data) => fetch(API + path, {method, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined});
  const signup = async email => (await (await call(null, "POST", "/api/signup", {email, password: "lift-days-test-123", name: "Lift Test", agree: true, adult: true})).json()).token;
  const owner = await signup(OWNER), member = await signup("member-" + Date.now() + "@example.com");
  ok(!!owner && !!member, "signed up a throwaway owner and a throwaway member");
  const meO = await (await call(owner, "GET", "/api/me")).json(), meM = await (await call(member, "GET", "/api/me")).json();
  ok(meO.features && meO.features.liftdays === true, "owner: the app is told the lift-day picker is on");
  ok(meM.features && meM.features.liftdays === false, "member: the app is told the lift-day picker is off");
  const profile = {name: "Lift Test", goal: "half", raceDate: "2027-03-07", weekly: 20, longest: 8, prDist: "none", easyPace: 600, lifts: 2, liftExp: "Some", days: [0, 2, 4, 6], longDay: 6, liftDays: [1, 3]};
  for (const t of [owner, member]) ok((await call(t, "PUT", "/api/profile", {profile})).ok, "plan saved");
  const saved = email => JSON.parse(sql("SELECT p.data FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '" + email + "'")[0].data);
  ok(JSON.stringify(saved(OWNER).liftDays) === "[1,3]", "owner: pinned lifting days are kept");
  const m = saved("member-%");
  ok(!("liftDays" in m) && m.lifts === 2 && m.longDay === 6, "member: pinned days dropped while in preview, the rest of the plan saved as sent");
} catch(e){ ok(false, "test crashed: " + e.message); }
stop();
console.log(failed ? failed + " failed" : "ALL PASS"); process.exit(failed ? 1 : 0);
