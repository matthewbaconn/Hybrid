// Weekly member email from the Worker (Matthew, Nov 23, 2026). Runs its own local API on a throwaway database with a
// stand-in AI, a stand-in What's new list and a fake Resend (no live data, no real mail). The clock is set to a Monday
// 10:30 ET with the test-only WEEKLY_NOW. Checks: one draft a week, written from this week's What's new entries only
// (old and sex-filtered entries left out, no member data sent to the AI); Matthew alone gets a [Test] copy with a
// private cancel link; a draft that breaks the rules is never used (the fixed template goes instead); cancel stops it;
// after the hold it goes once to every member (not to opted-out or test accounts), never twice.
//   cd api && node ../tests/weekly_auto.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";

const PORT = 8802, MOCK = 8803, API = "http://127.0.0.1:" + PORT, NOW = "2026-11-30T15:30:00Z", OWNER = "owner-" + Date.now() + "@wa.test";
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IG = "https://www.instagram.com/hybrdrunning/";
const good = {subject: "Your lifts, tracked", message: "Hey {name},\n\nThank you for being part of Mileset and for all the support. Big things are coming soon.\n\nNew this week: My workouts. Open More, then My workouts, build a session like a shoulder day, log weight and reps, and watch each lift go up week to week.\n\nAs a founding member, Mileset is free for you for life. Share it with a friend before the Founding 100 spots run out.\n\nWe're on Instagram at " + IG + " for training tips.\n\nGot an idea? Just reply. I read every one.\n\nMatthew\nMileset"};
let reply = good;
const seenAI = [], mails = [];
const NEWS_PAGE = `<script>
const NEWS = [
  ["dumbbell", "Your own workouts, with progress", "More > My workouts: build a workout (like a shoulder day), log weight and reps each time, and see every lift go up week to week.", "myw", null, "2026-11-28.2"],
  ["heart", "Cycle tracking", "Only for some members.", null, "f", "2026-11-27"],
  ["share", "Old feature", "Shipped long ago.", null, null, "2026-11-10"],
];
</script>`;
const mock = http.createServer((q, s) => { let b = ""; q.on("data", d => b += d); q.on("end", () => {
  // a stale mail/outbox.json with this week's weekly id (the old Monday task's file): must never be sent while weeklyAuto is on
  if (q.url.startsWith("/outbox")){ s.writeHead(200, {"Content-Type": "application/json"}); return s.end(JSON.stringify({id: "2026-11-30-weekly", subject: "Old outbox weekly", send_after: new Date(Date.now() - 60e3).toISOString(), message: "Hey {name},\n\nThis came from mail/outbox.json and must not go out.\n\nMatthew\nMileset"})); }
  if (q.url.startsWith("/news")){ s.writeHead(200, {"Content-Type": "text/html"}); return s.end(NEWS_PAGE); }
  if (q.url.startsWith("/emails")){ const j = JSON.parse(b); for (const m of Array.isArray(j) ? j : [j]) mails.push(m); s.writeHead(200, {"Content-Type": "application/json"}); return s.end(Array.isArray(j) ? '{"data":[]}' : '{"id":"x"}'); }
  seenAI.push(b); s.writeHead(200, {"Content-Type": "application/json"});
  s.end(JSON.stringify({stop_reason: "end_turn", content: [{type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply)}]}));
}); }).listen(MOCK, "127.0.0.1");
const dir = mkdtempSync(join(tmpdir(), "wa-"));
const sql = q => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}))[0].results;
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
const M = "http://127.0.0.1:" + MOCK;
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--test-scheduled",
  "--var", "OUTBOX_URL:" + "http://127.0.0.1:" + MOCK + "/outbox", "--var", "WEEKLY_NOW:" + NOW, "--var", "NEWS_URL:" + M + "/news", "--var", "OWNER_EMAIL:" + OWNER,
  "--var", "ANTHROPIC_URL:" + M + "/v1/messages", "--var", "ANTHROPIC_API_KEY:test-key", "--var", "RESEND_API_KEY:test", "--var", "RESEND_URL:" + M + "/emails"],
  {stdio: process.env.WA_DEBUG ? "inherit" : "ignore", detached: true});
const stop = () => { try { process.kill(-dev.pid); } catch(e){} mock.close(); rmSync(dir, {recursive: true, force: true}); };
const H = {"Content-Type": "application/json", Origin: "http://localhost:8000"};
const tick = async () => { for (let k = 0; k < 4; k++){ try { if ((await fetch(API + "/__scheduled?cron=*+*+*+*+*")).ok) break; } catch(e){} await sleep(1000); } await sleep(3000); };
const drafts = () => sql("SELECT id, subject, message, source, status, token, send_after FROM weekly_drafts");
const memberMails = () => mails.filter(m => !/^\[Test\]/.test(m.subject));
const due = () => sql(`UPDATE weekly_drafts SET send_after = '${new Date(Date.parse(NOW) - 60e3).toISOString()}'`);
try {
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
  for (const [e, n] of [[OWNER, "Matthew Owner"], ["ana-" + Date.now() + "@wa.test", "Ana Runner"], ["ben-" + Date.now() + "@wa.test", "Ben"], ["robot-" + Date.now() + "@example.com", "Robot"]])
    await fetch(API + "/api/signup", {method: "POST", headers: H, body: JSON.stringify({email: e, password: "weekly-auto-123", name: n, agree: true})});
  sql("UPDATE users SET no_mail = 1 WHERE name = 'Ben'");
  await sleep(1500); mails.length = 0;
  const membersBefore = sql("SELECT COUNT(*) AS n FROM users")[0].n;

  await tick();
  let d = drafts();
  ok(d.length === 1 && d[0].id === "2026-11-30-weekly" && d[0].source === "ai" && d[0].status === "ready", "Monday 10:30 ET: one AI draft for this week (" + JSON.stringify(d.map(x => [x.id, x.source, x.status])) + ")");
  ok(Date.parse(d[0].send_after) - Date.parse(NOW) === 2 * 3600e3, "it waits 2 hours before going out");
  const ai = seenAI.join("\n");
  ok(/Your own workouts, with progress/.test(ai) && !/Cycle tracking/.test(ai) && !/Old feature/.test(ai), "the AI gets this week's What's new entries only (no old or sex-filtered ones)");
  ok(!/@wa\.test|@example\.com|Ana Runner|Ben/.test(ai), "no member's email or name is sent to the AI");
  ok(mails.length === 1 && mails[0].to[0] === OWNER && /^\[Test\] Your lifts, tracked/.test(mails[0].subject) && mails[0].text.includes("/api/weekly/" + d[0].token), "only Matthew gets a [Test] copy, with the private link");
  ok(!memberMails().length, "no member gets anything before the hold is over");
  ok(!mails.some(m => m.subject === "Old outbox weekly"), "a mail/outbox.json with this week's weekly id is never sent while the Worker owns the weekly email");

  await tick();
  ok(drafts().length === 1 && mails.length === 1 && seenAI.length === 1, "a second tick doesn't write or send another draft");

  const page = await fetch(API + "/api/weekly/" + d[0].token);
  const html = await page.text();
  ok(page.status === 200 && html.includes("Your lifts, tracked") && /Cancel this email/.test(html), "the link shows the draft with a Cancel button");
  ok((await fetch(API + "/api/weekly/" + "0".repeat(32))).status === 404, "a made-up link shows nothing");
  const c = await (await fetch(API + "/api/weekly/" + d[0].token, {method: "POST"})).text();
  ok(/Cancelled/.test(c) && drafts()[0].status === "cancelled", "Cancel marks it cancelled");
  due(); await tick();
  ok(!memberMails().length && !sql("SELECT * FROM mail_sent").length, "a cancelled email never goes out");

  // rule breakers: each one is refused, the fixed template goes instead
  const bad = [
    {...good, message: good.message.replace("Matthew\nMileset", "Matt\nMileset")},
    {...good, message: good.message.replace("week to week.", "week to week. Members lift 30% more.")},
    {...good, message: good.message.replace("for training tips.", "for training tips. Also see https://evil.example.com")},
    {...good, message: good.message.replace(IG, "https://www.instagram.com/someoneelse/")},
    {...good, message: good.message + " " + "word ".repeat(120)},
    "not json at all",
  ];
  for (const [i, b] of bad.entries()){
    reply = b; sql("DELETE FROM weekly_drafts"); const n0 = seenAI.length;
    await tick();
    const x = drafts()[0] || {};
    ok(x.source === "template" && seenAI.length - n0 === 2 && !/30%|evil|someoneelse|Matt\n/.test(x.message), "rule-breaking AI draft " + (i + 1) + " is refused twice, the fixed template is used");
  }
  const tpl = drafts()[0];
  ok(tpl.message.startsWith("Hey {name},") && tpl.message.endsWith("Matthew\nMileset") && tpl.message.includes(IG) && /Founding 100/.test(tpl.message) && tpl.message.includes("My workouts") && tpl.message.split(/\s+/).length <= 170, "the template follows the rules too");

  reply = good; sql("DELETE FROM weekly_drafts"); mails.length = 0;
  await tick(); due(); await tick();
  const sent = memberMails();
  ok(sent.length === 2 && sent.every(m => m.subject === "Your lifts, tracked") && sent.some(m => m.to[0].startsWith("ana-") && /^Hey Ana,/.test(m.text)) && sent.some(m => m.to[0] === OWNER), "after the hold it goes to every member who gets email, with their first name");
  ok(!sent.some(m => /ben-|@example\.com/.test(m.to[0])), "never to members who unsubscribed or test accounts");
  ok(drafts()[0].status === "sent" && sql("SELECT sent FROM mail_sent WHERE id = '2026-11-30-weekly'")[0].sent === 2, "marked sent once, under this week's id");
  await tick(); await tick();
  ok(memberMails().length === 2 && !mails.some(m => m.subject === "Old outbox weekly"), "never sent twice, and the stale outbox weekly never goes");
  ok(sql("SELECT COUNT(*) AS n FROM users")[0].n === membersBefore && sql("SELECT no_mail FROM users WHERE name = 'Ana Runner'")[0].no_mail === 0, "no member data changes");
} finally { stop(); }
console.log(failed ? `weekly auto: ${failed} FAILED` : "weekly auto: all checks pass");
process.exit(failed ? 1 : 0);
