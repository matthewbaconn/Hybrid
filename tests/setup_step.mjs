// Onboarding drop-off (growth funnel question 4, Nov 17, 2026): the app records the furthest plan-setup step a member
// reached. Own local API. Checks: it only moves forward, rejects junk, needs a signed-in member, stores a number only.
// Runs in PR checks from tests/webhooks.mjs (pr-checks.yml is a protected file).  cd api && node ../tests/setup_step.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url)), APIDIR = join(HERE, "..", "api");
let failed = 0;
const ok = (c, m) => { console.log((c ? "ok " : "::error::") + "setup step: " + m); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8799, API = "http://127.0.0.1:" + PORT, dir = mkdtempSync(join(tmpdir(), "stp-"));
const wr = a => execFileSync("npx", ["wrangler", "d1", ...a], {cwd: APIDIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: {...process.env, CI: "1"}});
const sql = q => JSON.parse(wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q]))[0].results;
wr(["migrations", "apply", "hybrid", "--local", "--persist-to", dir]);
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir], {cwd: APIDIR, stdio: "ignore", detached: true});
try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const call = (token, data) => fetch(API + "/api/account/setup-step", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(token ? {Authorization: "Bearer " + token} : {})}, body: JSON.stringify(data)});
  const email = "stp-" + Date.now() + "@example.com";
  const token = (await (await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({email, password: "setup-step-test-123", name: "Step Test", agree: true, adult: true})})).json()).token;
  ok(!!token, "signed up a throwaway local member");
  const step = () => sql(`SELECT setup_step AS s FROM users WHERE email = '${email}'`)[0].s;
  ok(step() === null, "a new member starts with no step recorded");
  ok((await call(token, {step: 0})).ok && step() === 0, "step 0 (reached the goal screen) is recorded, so it reads apart from never leaving the welcome screen");
  ok((await call(token, {step: 2})).ok && step() === 2, "step 2 is recorded");
  ok((await call(token, {step: 1})).ok && step() === 2, "going Back never lowers the furthest step");
  ok((await call(token, {step: 4})).ok && step() === 4, "building the plan records step 4");
  const fp = () => sql(`SELECT first_plan_at AS f FROM users WHERE email = '${email}'`)[0].f;
  const putProfile = () => fetch(API + "/api/profile", {method: "PUT", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", Authorization: "Bearer " + token}, body: JSON.stringify({profile: {goal: "5k", weekly: 4, days: [1, 3, 6]}})});
  ok(fp() === null && (await putProfile()).ok && !!fp(), "the first saved plan records when it was built (time to first plan)");
  const f1 = fp(); await sleep(1100); await putProfile();
  ok(fp() === f1, "editing the plan later never moves the first-plan time");
  ok((await call(token, {step: 9})).status === 400 && (await call(token, {step: "x"})).status === 400 && step() === 4, "junk steps are refused");
  ok((await call(null, {step: 3})).status === 401, "only a signed-in member can record a step");
  const app = readFileSync(join(HERE, "..", "index.html"), "utf8");
  ok(/mode === "account" && !plan && setup\.step >= 0\) api\("POST", "\/api\/account\/setup-step"/.test(app), "the app records the step only for signed-in members building their first plan");
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { try { process.kill(-dev.pid); } catch(e){} rmSync(dir, {recursive: true, force: true}); }
console.log(failed ? failed + " setup step check(s) failed" : "setup step: all checks pass");
process.exit(failed ? 1 : 0);
