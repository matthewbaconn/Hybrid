// Resend welcome (Matthew, Nov 20 10:53pm): a signed admin action from Vesper. Runs its own local API on a throwaway
// database with a TEST key pair and a fake Resend (no live data, no real mail). Checks: only a request signed by the
// key in VESPER_ADMIN_PUB works; a forged, altered, expired or replayed request is refused; it re-sends the existing
// welcome email to that member only; once a day per member; members who opted out are skipped.
//   cd api && node ../tests/admin_welcome.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import crypto from "node:crypto";
import http from "node:http";

const PORT = 8798, MAILP = 8799, API = "http://127.0.0.1:" + PORT;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kp = crypto.generateKeyPairSync("ed25519"), other = crypto.generateKeyPairSync("ed25519");
const pub = kp.publicKey.export({format: "der", type: "spki"}).subarray(-32).toString("base64");
const mails = [];
const fake = http.createServer((q, s) => { let b = ""; q.on("data", d => b += d); q.on("end", () => { mails.push(JSON.parse(b)); s.writeHead(200, {"Content-Type": "application/json"}); s.end('{"id":"x"}'); }); }).listen(MAILP);
const dir = mkdtempSync(join(tmpdir(), "aw-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--var", "OUTBOX_URL:http://127.0.0.1:1/none",
  "--var", "VESPER_ADMIN_PUB:" + pub, "--var", "RESEND_API_KEY:test", "--var", "RESEND_URL:http://127.0.0.1:" + MAILP + "/emails"], {stdio: process.env.AW_DEBUG ? "inherit" : "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} fake.close(); rmSync(dir, {recursive: true, force: true}); };
const H = {"Content-Type": "application/json", Origin: "http://localhost:8000"};
const signed = (uid, key = kp.privateKey, ts = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(12).toString("hex")) =>
  ({uid, ts: String(ts), nonce, sig: crypto.sign(null, Buffer.from(`mileset-admin-v1|welcome|${uid}|${ts}|${nonce}`), key).toString("base64")});
const post = async b => { const r = await fetch(API + "/api/admin/welcome", {method: "POST", headers: H, body: JSON.stringify(b)}); let j = {}; try { j = await r.json(); } catch(e){} return {s: r.status, j}; };
try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  const t0 = Date.now();
  for (const [e, n] of [["owner-" + t0 + "@aw.test", "Owner"], ["ana-" + t0 + "@aw.test", "Ana Runner"], ["ben-" + t0 + "@aw.test", "Ben"]])
    await fetch(API + "/api/signup", {method: "POST", headers: H, body: JSON.stringify({email: e, password: "admin-welcome-1", name: n, agree: true})});
  await sleep(1500); mails.length = 0;
  const id = {}; for (const r of sql("SELECT id, name FROM users")) id[r.name] = r.id;
  sql(`UPDATE users SET no_mail = 1 WHERE id = '${id.Ben}'`);
  ok((await post(signed(id["Ana Runner"], other.privateKey))).s === 401 && !mails.length, "a request signed by any other key is refused");
  const good = signed(id["Ana Runner"]);
  ok((await post({...good, uid: id.Owner})).s === 401, "changing the member id breaks the signature");
  ok((await post(signed(id["Ana Runner"], kp.privateKey, Math.floor(Date.now() / 1000) - 900))).s === 401, "an expired request (over 5 minutes) is refused");
  ok((await post({uid: id["Ana Runner"]})).s === 400, "an unsigned request is refused");
  const r1 = await post(good);
  ok(r1.s === 200 && r1.j.sent === true && mails.length === 1 && mails[0].to[0].startsWith("ana-") && /Welcome to Mileset, Ana/.test(mails[0].subject), "Vesper's signed request re-sends the existing welcome email to that member only");
  ok((await post(good)).s === 409 && mails.length === 1, "the same signed request can't be replayed");
  ok((await post(signed(id["Ana Runner"]))).s === 429 && mails.length === 1, "at most once a day per member");
  ok((await post(signed(id.Ben))).s === 409 && mails.length === 1, "a member who opted out of update emails is skipped");
  ok(sql("SELECT COUNT(*) AS n FROM users")[0].n === 3 && sql(`SELECT no_mail FROM users WHERE id = '${id["Ana Runner"]}'`)[0].no_mail === 0, "no member data changes");
} finally { stop(); }
console.log(failed ? `admin welcome: ${failed} FAILED` : "admin welcome: all checks pass");
process.exit(failed ? 1 : 0);
