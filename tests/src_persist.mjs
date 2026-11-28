// Source tracking from first landing to first workout (Nov 27, 2026 tracking audit). Checks that a sign-up's channel
// survives every hop and ends up counted under its exact source (or "direct") in funnel_daily.by_source:
//   website page lands with ?src= / utm_source / ?ref=  ->  kept across site pages (first touch wins)
//   -> "open the app" links carry it  ->  the app stores hp-src / hp-ref  ->  the sign-up request sends them
//   -> the API stores users.src ("invite" for a bare ?ref=, "direct" with no tag) and users.ref
//   -> after a check-off, the nightly writes {"<src>": {signed_up, trained}} and the per-source trained add up to "trained".
// Part 1 runs in a browser with the API mocked. Part 2 runs its own local API on a throwaway database (never live data).
//   cd api && node ../tests/src_persist.mjs          (CHROME=/usr/bin/google-chrome if Playwright's browser isn't installed)
//   NO_API=1 node tests/src_persist.mjs              (browser part only)
import {chromium} from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import {spawn, execFileSync} from "node:child_process"; import {mkdtempSync, rmSync} from "node:fs"; import {tmpdir} from "node:os";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".webmanifest": "application/manifest+json"};
const SITE = "http://localhost:8098";
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(root, p), (e, b) => { if (e){ r.writeHead(404); r.end(); return; } r.writeHead(200, {"content-type": types[path.extname(p)] || "application/octet-stream"}); r.end(b); }); }).listen(8098);
let bad = 0; const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- part 2 setup first, so the invite code is a real member's ----------
const useApi = !process.env.NO_API;
let dir, dev, sql, API, inviter = "abcdef12";
if (useApi){
  const PORT = 8795; API = "http://127.0.0.1:" + PORT; dir = mkdtempSync(join(tmpdir(), "srcp-"));
  sql = q => { const o = execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", "--local", "--persist-to", dir, "--json", "--command", q], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
    return JSON.parse(o.slice(o.indexOf("[")))[0].results; };   // skip any banner line wrangler prints before the JSON
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "hybrid", "--local", "--persist-to", dir], {stdio: "ignore", env: {...process.env, CI: "1"}});
  dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local-upstream", "127.0.0.1:" + PORT, "--persist-to", dir, "--test-scheduled",
    "--var", "OUTBOX_URL:http://127.0.0.1:1/none"], {stdio: process.env.SP_DEBUG ? "inherit" : "ignore", detached: true});
  for (let i = 0; i < 40; i++){ try { if ((await fetch(API + "/api/health")).ok) break; } catch(e){} await sleep(1500); }
}
function join(...a){ return path.join(...a); }
const signup = async body => { const r = await fetch(API + "/api/signup", {method: "POST", headers: {"Content-Type": "application/json", Origin: "http://localhost:8000"}, body: JSON.stringify(body)}); return r.json(); };
const stop = () => { try { if (dev) process.kill(-dev.pid); } catch(e){} try { if (dir) rmSync(dir, {recursive: true, force: true}); } catch(e){} };

const b = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
const block = async p => { await p.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|open-meteo/, r => r.abort()); };
// The CTA links on a page, as the app address + query (the test serves the app at SITE/ instead of app.milesetapp.com).
const ctas = p => p.evaluate(() => [...document.querySelectorAll('a[href^="https://app.milesetapp.com/"]')].map(a => a.href).filter(h => /^https:\/\/app\.milesetapp\.com\/(\?|$)/.test(h)));
const q = href => new URL(href).searchParams;
// Open the app with a query, create an account through the real form and return the sign-up request body.
async function appSignup(ctx, query){
  const p = await ctx.newPage(); await block(p); let body = null;
  await p.route(/hybrid-api\.hybridapp\.workers\.dev|\/api\//, r => { const u = r.request().url();
    if (/\/api\/signup/.test(u)){ body = r.request().postDataJSON(); return r.fulfill({status: 400, json: {error: "test stop"}}); }
    return r.fulfill({json: {left: 80}}); });
  await p.goto(SITE + "/index.html" + query); await p.waitForTimeout(800);
  const st = await p.evaluate(() => [localStorage.getItem("hp-src"), localStorage.getItem("hp-ref")]);
  await p.click('[data-act="authsignup"]'); await p.fill("#a-name", "Src Test"); await p.fill("#a-email", "src" + Date.now() + "@t.test");
  await p.fill("#a-pass", "testpass123"); await p.check("#a-agree"); await p.click('#authform button[type="submit"]');
  for (let i = 0; i < 30 && !body; i++) await p.waitForTimeout(100);
  await p.close(); return {stored: st, body};
}

try {
  if (useApi){
    const own = await signup({email: "owner-" + Date.now() + "@sp.test", password: "srcpersist123", name: "Owner", agree: true});
    const inv = await signup({email: "inviter-" + Date.now() + "@sp.test", password: "srcpersist123", name: "Inviter", agree: true});
    sql(`INSERT OR IGNORE INTO not_members (user_id, why, created) VALUES ('${own.user.id}', 'owner', '2026-11-27');`);
    inviter = inv.user.id.slice(0, 8);
  }

  // ---------- part 1: website -> app -> sign-up request ----------
  // a) Instagram post link to a site page, then the visitor browses to another page: the channel follows them
  let ctx = await b.newContext(), p = await ctx.newPage(); await block(p);
  await p.route(/hybrid-api\.hybridapp\.workers\.dev/, r => r.fulfill({json: {left: 80}}));
  await p.goto(SITE + "/home/index.html?utm_source=Instagram&utm_medium=social"); await p.waitForTimeout(300);
  let links = await ctas(p);
  t(links.length > 0 && links.every(h => q(h).get("src") === "instagram"), "landing with utm_source: every app link carries src=instagram, not the page's own src=home (" + links.length + " links)");
  await p.goto(SITE + "/home/5k-plan-for-beginners.html"); await p.waitForTimeout(300);
  links = await ctas(p);
  t(links.length > 0 && links.every(h => q(h).get("src") === "instagram"), "next page with no tag: the first-touch channel is still on the links");
  await p.goto(SITE + "/home/race-pace-calculator.html?src=google"); await p.waitForTimeout(300);
  t((await ctas(p)).every(h => q(h).get("src") === "instagram"), "a later tag doesn't overwrite the first touch");
  t(!(await p.evaluate(() => [...document.querySelectorAll('a[href*="app.milesetapp.com/privacy"]')].some(a => /src=/.test(a.href)))), "non-app links (privacy) are left alone");
  await ctx.close();

  // b) no tag at all: the page's own tag stays (that IS the source: this page)
  ctx = await b.newContext(); p = await ctx.newPage(); await block(p);
  await p.route(/hybrid-api\.hybridapp\.workers\.dev/, r => r.fulfill({json: {left: 80}}));
  await p.goto(SITE + "/home/5k-plan-for-beginners.html"); await p.waitForTimeout(300);
  links = await ctas(p);
  t(links.length > 0 && links.every(h => q(h).get("src") === "5k" && !q(h).get("ref")), "untagged visit keeps the page tag src=5k and adds no ref");
  await ctx.close();

  // c) a member's invite link lands on the website: ?ref= is kept across pages, through the app, into the sign-up
  ctx = await b.newContext(); p = await ctx.newPage(); await block(p);
  await p.route(/hybrid-api\.hybridapp\.workers\.dev/, r => r.fulfill({json: {left: 80}}));
  await p.goto(SITE + "/home/train-together.html?ref=" + inviter); await p.waitForTimeout(300);
  await p.goto(SITE + "/home/index.html"); await p.waitForTimeout(300);
  links = await ctas(p);
  t(links.length > 0 && links.every(h => q(h).get("ref") === inviter && !q(h).get("src")), "invite ?ref= survives to another page; the page tag is dropped so the sign-up counts as an invite");
  const viaSite = await appSignup(ctx, new URL(links[0]).search);
  t(viaSite.stored[1] === inviter, "the app stored the invite code from the link (" + viaSite.stored + ")");
  t(viaSite.body && viaSite.body.ref === inviter, "the sign-up request sends ref=" + inviter + " (" + JSON.stringify(viaSite.body && {ref: viaSite.body.ref, src: viaSite.body.src}) + ")");
  await ctx.close();

  // d) Instagram bio link straight to the app
  ctx = await b.newContext();
  const bio = await appSignup(ctx, "?src=ig_bio");
  t(bio.body && bio.body.src === "ig_bio", "app opened from ?src=ig_bio sends src=ig_bio at sign-up");
  await ctx.close();

  // e) typed address, no tag, no referrer
  ctx = await b.newContext();
  const direct = await appSignup(ctx, "");
  t(direct.body && !direct.body.src && !direct.body.ref, "no tag: the request sends no src (the API files it as direct)");
  await ctx.close();

  // ---------- part 2: API -> users.src -> first workout -> funnel_daily.by_source ----------
  if (useApi){
    const mk = async (body, tag) => { const j = await signup({...body, email: tag + "-" + Date.now() + "@sp.test", password: "srcpersist123", name: tag, agree: true}); return j.user && j.user.id; };
    const ids = {invite: await mk(viaSite.body || {ref: inviter}, "Invited"), bio: await mk(bio.body || {src: "ig_bio"}, "Bio"), direct: await mk(direct.body || {}, "Direct")};
    const row = id => sql(`SELECT src, ref FROM users WHERE id = '${id}'`)[0] || {};
    t(row(ids.invite).src === "invite" && row(ids.invite).ref && row(ids.invite).ref.slice(0, 8) === inviter, "API: invite sign-up stored src=invite and the inviter (" + JSON.stringify(row(ids.invite)) + ")");
    t(row(ids.bio).src === "ig_bio", "API: bio-link sign-up stored src=ig_bio");
    t(row(ids.direct).src === "direct", "API: no tag and no invite is stored as direct, not left empty (" + row(ids.direct).src + ")");
    const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    for (const k of ["invite", "bio", "direct"]) sql(`INSERT INTO profiles (user_id, data, updated) VALUES ('${ids[k]}', '{"name":"T"}', '${day(0)}T12:00:00.000Z');`);
    // first workouts: the invited member checks one off in the app; the bio member's first workout is a synced run
    // (the case Vesper's old count missed); the direct member built a plan and hasn't trained
    sql(`INSERT INTO done (user_id, key) VALUES ('${ids.invite}', '${day(0)}-0');
         INSERT INTO activities (id, user_id, source, date, type, name, created) VALUES ('a-sp-${Date.now()}', '${ids.bio}', 'garmin', '${day(0)}', 'run', 'Run', '${day(0)}T12:00:00.000Z');`);
    for (let k = 0; k < 4; k++){ try { if ((await fetch(API + "/__scheduled?cron=*+*+*+*+*")).ok) break; } catch(e){} await sleep(1000); } await sleep(4000);
    const fd = sql("SELECT trained, signed_up, by_source FROM funnel_daily ORDER BY day DESC LIMIT 1")[0] || {};
    let bs = {}; try { bs = JSON.parse(fd.by_source || "{}"); } catch(e){}
    t(bs.invite && bs.invite.signed_up === 1 && bs.invite.trained === 1, "funnel_daily.by_source: the ?ref= sign-up and its first workout count under invite (" + JSON.stringify(bs.invite) + ")");
    t(bs.ig_bio && bs.ig_bio.trained === 1, "a first workout that is a synced run counts as trained for its source (" + JSON.stringify(bs.ig_bio) + ")");
    t(bs.direct && bs.direct.signed_up >= 1 && bs.direct.trained === 0, "direct sign-ups are their own bucket (" + JSON.stringify(bs.direct) + ")");
    const sumT = Object.values(bs).reduce((a, v) => a + (v.trained || 0), 0), sumS = Object.values(bs).reduce((a, v) => a + (v.signed_up || 0), 0);
    t(sumT === fd.trained && sumS === fd.signed_up, "per-source totals add up: trained " + sumT + "/" + fd.trained + ", signed up " + sumS + "/" + fd.signed_up);
    t(!/@|name|email/i.test(fd.by_source || ""), "by_source holds counts only");
    // the "How did you hear about Mileset?" answer moves a direct member out of the blind bucket
    sql(`UPDATE users SET src_answer = 'friend' WHERE id = '${ids.direct}';`);
    for (let k = 0; k < 4; k++){ try { if ((await fetch(API + "/__scheduled?cron=*+*+*+*+*")).ok) break; } catch(e){} await sleep(1000); } await sleep(4000);
    const bs2 = JSON.parse((sql("SELECT by_source FROM funnel_daily ORDER BY day DESC LIMIT 1")[0] || {}).by_source || "{}");
    t(bs2["said-friend"] && bs2["said-friend"].signed_up === 1, "an untagged member who answered 'a friend' is counted under said-friend (" + JSON.stringify(bs2["said-friend"]) + ")");
  }
} catch(e){ t(false, "test crashed: " + (e && e.message)); }
finally { await b.close(); srv.close(); stop(); }
console.log(bad ? bad + " failed" : "all passed"); process.exit(bad ? 1 : 0);
