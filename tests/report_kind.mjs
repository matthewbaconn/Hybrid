// Problem reports vs the smoke test's own report (Nov 17, 2026). The hourly smoke test files "Nightly test report."
// through /api/report; it is logged as "report_test" so tools/signals.py can see when a MEMBER reports a problem.
// Runs in PR checks from tests/webhooks.mjs (pr-checks.yml is a protected file).  cd api && node ../tests/report_kind.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
const APIDIR = join(dirname(fileURLToPath(import.meta.url)), "..", "api");
let failed = 0;
const ok = (c, m) => { console.log((c ? "ok " : "::error::") + "report kind: " + m); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8798, API = "http://127.0.0.1:" + PORT, dir = mkdtempSync(join(tmpdir(), "rep-"));
const wr = a => execFileSync("npx", ["wrangler", "d1", ...a], {cwd: APIDIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: {...process.env, CI: "1"}});
const sql = q => JSON.parse(wr(["execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q]))[0].results;
wr(["migrations", "apply", "hybrid", "--local", "--persist-to", dir]);
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir], {cwd: APIDIR, stdio: "ignore", detached: true});
try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const rep = text => fetch(API + "/api/report", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify({text, screen: "today"})});
  ok((await rep("Nightly test report. Please ignore.")).ok && (await rep("The food photo button does nothing on my phone")).ok, "both reports accepted");
  await sleep(500);
  const ev = sql("SELECT kind FROM events WHERE kind LIKE 'report%' ORDER BY rowid").map(r => r.kind);
  ok(JSON.stringify(ev) === JSON.stringify(["report_test", "report"]), "test report -> report_test, member report -> report: " + JSON.stringify(ev));
  ok(sql("SELECT COUNT(*) AS n FROM reports")[0].n === 2, "both are still stored as reports (nothing else changes)");
} catch(e){ ok(false, "test crashed: " + (e && e.message || e)); }
finally { try { process.kill(-dev.pid); } catch(e){} rmSync(dir, {recursive: true, force: true}); }
console.log(failed ? failed + " report kind check(s) failed" : "report kind: all checks pass");
process.exit(failed ? 1 : 0);
