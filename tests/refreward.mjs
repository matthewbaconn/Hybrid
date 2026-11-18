// Released to all members Nov 18; PREVIEW_ADD puts it back in preview so the owner-only switch stays tested.
// Referral reward test (backlog 13, audit P1-8): "bring 2 training partners -> a personal plan review from Matthew".
// Runs its own local API on a throwaway local database (no live data, no mail). Checks: preview only (the owner sees
// it, members don't, and the endpoint refuses them); it counts partners who joined through your link AND built a
// plan; test accounts never count; asking before it's earned is refused; asking once records one row; asking again
// changes nothing; the owner's Members list shows the request; deleting the account removes it.
//   cd api && node ../tests/refreward.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const PORT = 8796, API = "http://127.0.0.1:" + PORT;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "rr-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir,
  "--var", "OUTBOX_URL:http://127.0.0.1:1/none", "--var", "PREVIEW_ADD:refreward"], {stdio: process.env.RR_DEBUG ? "inherit" : "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} rmSync(dir, {recursive: true, force: true}); };
const H = {"Content-Type": "application/json", Origin: "http://localhost:8000"};
const call = async (method, path, tok, body) => { const r = await fetch(API + path, {method, headers: {...H, Authorization: "Bearer " + tok}, body: body ? JSON.stringify(body) : undefined}); let j = {}; try { j = await r.json(); } catch(e){} return {status: r.status, j}; };

try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const t0 = Date.now();
  const signup = async (email, name, ref) => { const r = await fetch(API + "/api/signup", {method: "POST", headers: H, body: JSON.stringify({email, password: "ref-reward-123", name, agree: true, ref})}); return (await r.json()).token; };
  const owner = await signup("owner-" + t0 + "@rr.test", "Owner");   // oldest real account = the owner
  const member = await signup("member-" + t0 + "@rr.test", "Member");
  const id = {}; for (const r of sql("SELECT id, name FROM users")) id[r.name] = r.id;
  const code = id.Owner.slice(0, 8);
  await signup("f1-" + t0 + "@rr.test", "F1", code);
  await signup("f2-" + t0 + "@rr.test", "F2", code);
  await signup("robot-" + t0 + "@example.com", "Robot", code);   // test accounts never count
  for (const r of sql("SELECT id, name FROM users")) id[r.name] = r.id;
  const prof = n => sql(`INSERT INTO profiles (user_id, data, updated) VALUES ('${id[n]}', '{"name":"T"}', '2026-11-17T12:00:00.000Z');`);

  const meO = await call("GET", "/api/me", owner), meM = await call("GET", "/api/me", member);
  ok(meO.j.features && meO.j.features.refreward === true, "owner sees the preview");
  ok(meM.j.features && meM.j.features.refreward === false, "members don't see it while it's in preview");
  ok(!("reward" in (await call("GET", "/api/invites", member)).j), "a member's invite stats carry no reward while in preview");
  ok((await call("POST", "/api/invites/review", member, {note: "x"})).status === 404, "the endpoint refuses members while in preview");

  prof("F1"); prof("Robot");
  let inv = (await call("GET", "/api/invites", owner)).j;
  ok(inv.joined === 2 && inv.reward && inv.reward.have === 1 && inv.reward.need === 2 && !inv.reward.earned, "1 of 2: only partners who built a plan count, test accounts never (" + JSON.stringify(inv.reward) + ")");
  const early = await call("POST", "/api/invites/review", owner, {note: "x"});
  ok(early.status === 400 && /2 friends/.test(early.j.error || ""), "asking before it's earned is refused (" + early.status + ")");
  ok(sql("SELECT COUNT(*) AS n FROM plan_reviews")[0].n === 0, "nothing recorded before it's earned");

  prof("F2");
  inv = (await call("GET", "/api/invites", owner)).j;
  ok(inv.reward.have === 2 && inv.reward.earned && inv.reward.requested === null, "2 of 2: earned");
  const ask = await call("POST", "/api/invites/review", owner, {note: "  Is my long run   too long? " + "x".repeat(400)});
  ok(ask.status === 200 && ask.j.requested === "requested", "asking records the request");
  const rows = sql("SELECT user_id, note, status FROM plan_reviews");
  ok(rows.length === 1 && rows[0].user_id === id.Owner && rows[0].note.startsWith("Is my long run too long?") && rows[0].note.length <= 300 && rows[0].status === "requested", "one row, note tidied and capped at 300");
  ok((await call("POST", "/api/invites/review", owner, {note: "again"})).j.again === true && sql("SELECT COUNT(*) AS n FROM plan_reviews")[0].n === 1 && sql("SELECT note FROM plan_reviews")[0].note.startsWith("Is my"), "asking again changes nothing");
  ok((await call("GET", "/api/invites", owner)).j.reward.requested === "requested", "the card shows it's requested");
  sql(`INSERT INTO plan_reviews (user_id, note, status, created) VALUES ('${id.Member}', 'race in March', 'requested', '2026-11-17T12:00:00.000Z');`);   // as after release
  const mem = (await call("GET", "/api/admin/members", owner)).j.members || [];
  ok(mem.some(m => m.name === "Member" && m.review === "requested" && m.review_note === "race in March"), "the owner's Members list shows a member's request and note");
  sql(`DELETE FROM plan_reviews WHERE user_id = '${id.Member}';`);
  ok(sql("SELECT COUNT(*) AS n FROM profiles")[0].n === 3, "member data unchanged");

  const del = await fetch(API + "/api/account", {method: "DELETE", headers: {...H, Authorization: "Bearer " + owner}, body: JSON.stringify({password: "ref-reward-123"})});
  ok(del.ok && sql("SELECT COUNT(*) AS n FROM plan_reviews")[0].n === 0, "deleting the account removes the request (" + del.status + ")");
} catch(e){ ok(false, "test crashed: " + (e && e.message)); }
stop();
console.log(failed ? failed + " check(s) failed" : "ALL PASS");
process.exit(failed ? 1 : 0);
