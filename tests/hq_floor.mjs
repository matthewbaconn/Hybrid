// HQ command floor (hq/index.html + core.js + ui.js): node tests/hq_floor.mjs   (no network needed; SHOTS=dir saves screenshots)
// Serves the repo, fakes Vesper's feeds, GitHub, the member count, the owner's Mileset account and the HQ mailbox, then
// checks on a 390x844 phone and a desktop: the same private-key flow as before, all 16 modules present and in plain
// words, commands sealed with the key (the key itself never leaves the device), instant screen updates, polling that
// stops when the tab is hidden and resumes on focus, safe areas, no sideways scroll and no console errors.
// Everything below is a TEST-ONLY fixture, encrypted with a throwaway key; it is never published.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
const here = p => fileURLToPath(new URL(p, import.meta.url)), SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
const errs = [], ok = [], check = (c, what) => { (c ? ok : errs).push(what); if (!c) console.log("FAIL " + what); };
const KEYB = crypto.randomBytes(32), KEY = KEYB.toString("base64url"), BOX = crypto.createHash("sha256").update("mileset-hq-box-v1:" + KEY).digest("hex");
const seal = (obj, aad) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEYB, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return {iv: iv.toString("base64url"), ct: ct.toString("base64url")}; };
const open = (env, aad) => { const b = Buffer.from(env.ct, "base64url"), d = crypto.createDecipheriv("aes-256-gcm", KEYB, Buffer.from(env.iv, "base64url")); d.setAAD(Buffer.from(aad)); d.setAuthTag(b.subarray(b.length - 16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]).toString()); };
const iso = m => new Date(Date.now() - m * 60000).toISOString().slice(0, 19) + "Z", day = n => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA");
const PRIV = {v: 1, t: iso(1), o: {streak: [2, 7], working: ["dev-lead"], attention: [], runs_today: 6, ok_today: 5, failed_today: 0, approvals: 1, spend: {spent: 0.67, cap: 0.86, runs: 29, by_model: {"claude-sonnet-5-5": 0.5, "claude-haiku-5-5": 0.17}, by_job: {"Matthew's messages": 0.3, "inbox replies": 0.07}}},
  d: [{id: "dev-lead", s: "w", last: iso(4), next: iso(-900), sum: "TEST PRIVATE fixing the reminder ask in tools/x.py (Hybrid #120)", hist: [[iso(300), "ok", "TEST PRIVATE shipped the header fix"]], runs: 2, min: 14, ok7: 9, fail7: 1},
      {id: "worker", s: "i", last: iso(20), next: iso(-37), sum: "TEST PRIVATE shipped app change", hist: [], runs: 7, min: 30, ok7: 40, fail7: 0},
      {id: "growth-sprint", s: "i", last: iso(200), next: iso(-600), sum: "TEST PRIVATE tagged the Facebook links", hist: [], runs: 1, min: 5, ok7: 6, fail7: 0}],
  f: [[iso(20), "worker", "ok", "TEST PRIVATE ship gate: #118 live"], [iso(200), "growth-sprint", "ok", "TEST PRIVATE growth note"]],
  a: [{k: "pr", repo: "Hybrid", n: 1, title: "TEST held change", url: "https://github.com/matthewbaconn/Hybrid/pull/1", why: "SHIP IT"}, {k: "pr", repo: "vesper-relay", n: 77, title: "TEST Vesper upgrade", url: "", why: "protected: needs your tap"}],
  dec: [], done: [], jobs: [["0", "PLAN"], ["B1", "TEST backlog job", "product lead", "building"]],
  g: {asof: day(0), src7: {ig: 5, unknown: 6}, funnel: {signed_up: 17, plan: 13, trained: 3, workout: 1, d7_eligible: 6, active_d7: 0, trained_7d: 3}, members: [[day(-3), 14], [day(-2), 15], [day(-1), 17], [day(0), 17]]},
  me: {days: [[day(0), [["shift", "TEST work shift", "04:30", "12:30"], ["deadline", "TEST Pharm exam", "14:00", ""]]], [day(1), []], [day(2), [["class", "TEST clinical lab", "09:00", "11:00"]]], [day(3), []], [day(4), []], [day(5), []], [day(6), []]],
       overdue: [], todos: ["TEST renew parking pass"], rem: [[day(1) + "T08:00", "TEST call the registrar", ""]], cal: []},
  money: {today: 0.67, today_cap: 0.86, month: 8.27, month_cap: 17, from: day(-6)}, fix: "",
  inc: {t: iso(5), rows: [["activation-none-trained", "high", "fixing", "product", "product-lead", "TEST members with a plan are not training", "3 of 13", iso(900), iso(-300), "", 0, 0, "fix in progress", ""]]},
  x: {work7: {"dev-lead": {ok: 9, failed: 1, skipped: 0, min: 120}}, health: {status: "TEST all quiet"}, exps: [["E1", "running", "TEST Reddit experiment", ">=1 sign-up", "Nov 30", "running"]], runs: []},
  hq2: {mode: "normal", holds: [111], approved: [], dev: {stark: {ts: Date.now() / 1000 - 120, busy: false, hands: true, mic_ok: true}}, spend: {daily_cap: 5, throttled: false},
        quiet: {today: 2, items: [{at: iso(50), source: "sweep", text: "Growth Sprint run failed: status/growth-sprint.json timeout"}, {at: iso(30), source: "watchdog", text: "A retry of the worker job failed"}]},
        ideas: [{col: "ready", title: "TEST one-screen run summary", why: "Strava feed clutter", green: 1, metric: "weekly opens", src: "Demo Day"}, {col: "exploring", title: "TEST day-3 nudge", why: "research finding", src: "research"}],
        exams: [[day(0), "TEST Pharm exam"], [day(9), "TEST Med-surg exam"]], races: [[day(200), "TEST City Marathon"]], obj: {"dev-lead": "TEST raise first-workout activation above 50%"}}};
const pr = (n, t, ref, o) => ({number: n, title: t, html_url: "https://github.com/matthewbaconn/Hybrid/pull/" + n, head: {ref, sha: "sha" + n}, draft: false, state: "open", created_at: iso(5000 - n), merged_at: null, body: "Plain summary of change " + n + ".", ...o});
const PULLS = [pr(2, "TEST feature change", "claude/feature"), pr(4, "Fix: TEST bug fix", "claude/fix"), pr(1, "TEST held change", "claude/smoke", {body: "NEEDS MATTHEW: adds a workflow.\n\nRuns a phone test."}),
  pr(111, "TEST dock key change", "claude/hq-dock", {body: "NEEDS MATTHEW: key in the URL"}), pr(3, "TEST draft", "claude/draft", {draft: true}), pr(5, "TEST shipped change", "claude/done", {state: "closed", merged_at: iso(30)})];
const PUB = {v: 1, t: iso(1), ok: true, sk: [2, 7], r: [["dev-lead", "w", iso(4), iso(-900), 2], ["worker", "i", iso(20), iso(-37), 7], ["growth-sprint", "i", iso(200), iso(-600), 1], ["audit", "i", iso(900), iso(-400), 1]], tl: []};
const ME = {user: {name: "Test"}, profile: {raceDate: day(84), goal: "half"}, done: [day(-1) + "-0"], food: [{date: day(0)}, {date: day(-1)}], checkins: [{date: day(0), sleep_h: 7.5, energy: 4}], activities: [{date: day(-1), type: "run", mi: 5.1, minutes: 46}, {date: day(-8), type: "run", mi: 4}]};

const TYPES = {html: "text/html", js: "text/javascript", json: "application/json", png: "image/png", webmanifest: "application/manifest+json"};
const srv = http.createServer((q, r) => { const f = here("../") + decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/^\/+/, "").replace(/\/$/, "/index.html");
  if (f.includes("..") || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
  r.writeHead(200, {"Content-Type": TYPES[f.split(".").pop()] || "application/octet-stream"}); fs.createReadStream(f).pipe(r); });
await new Promise(k => srv.listen(0, "127.0.0.1", k));
const BASE = `http://127.0.0.1:${srv.address().port}/hq/`;
const browser = await chromium.launch();

async function run(name, ctxOpt, phone){
  const ctx = await browser.newContext(ctxOpt), page = await ctx.newPage(), reqs = [], cmds = [], box = [], seenCid = new Map(), pend = []; let boxOn = true, cErr = [], telAge = 20, telPaused = false, dropNext = "", telBreaker = false, noSignal = false;
  // a stand-in for Vesper's server: Tier 1 reads answer at once; anything else waits for a (simulated) Telegram Approve
  const say = (c, st, extra) => { const seq = (c._seq = (c._seq || 0) + 1); box.push({id: box.length + 1, d: "out", cid: c.command_id + ":" + seq, ...seal({command_id: c.command_id, status: st, ...extra}, "mileset-hq-ack-v1")}); };
  const t1 = c => c.t === "read" || c.t === "defer" || (c.t === "text" && /^(status|spend|health|queue)$/i.test(c.text || ""));
  const ROSTER = [["u1aaaaaa", "Ana Runner", "ana@x.test", "2026-11-02", "2026-11-20 20:10", 4, 3, 0], ["u2bbbbbb", "Ben Lifter", "ben@x.test", "2026-10-28", "2026-11-12 09:00", 0, 0, 1], ["u3cccccc", "Cara Tri", "cara@x.test", "2026-11-19", "2026-11-20 18:00", 2, 1, 0]];
  const readRes = c => c.q === "members" ? {title: "Members", lines: [ROSTER.length + " member(s)"], rows: c.f === "risk" ? ROSTER.slice(1, 2) : ROSTER, q: c.arg || "", f: c.f || "all"}
    : c.q === "member" ? {title: "Ana Runner", lines: ["Joined 2026-11-02"], m: {id: c.arg, name: "Ana Runner", email: "ana@x.test", joined: "2026-11-02", seen: "2026-11-20 20:10", sessions: 12, streak: 3, food7: 3, mails: [["day3_nudge", "2026-11-05", 1]], no_mail: false, flag: false}}
    : c.q === "finance" ? {title: "Finance", lines: ["burn"], fin: {range: c.range, burn: c.range === "30d" ? 21.4 : 6.2, revenue: 0, revenue_note: "No paid plans: the Founding 100 are free for life.", net: c.range === "30d" ? -21.4 : -6.2, run30: 26.6,
        days: [["2026-11-14", 0.5], ["2026-11-15", 1.2], ["2026-11-16", 0.9], ["2026-11-17", 1.1], ["2026-11-18", 0.7], ["2026-11-19", 1.1], ["2026-11-20", 0.7]], by_job: {chat: 3.1, briefing: 2.0, workers: 1.1}, by_model: {"haiku-4": 2.2, "sonnet-4": 4.0},
        cap: 5, today: 0.67, warn_pct: 80, paused: false, reason: "", month: 8.27, month_cap: 17}}
    : c.q === "agents" ? {title: "Agents & team", lines: ["3 of 4 routines on"], agents: {total: 0.42, jobs: {"Matthew's messages": 0.3, "Mac voice": 0.05},
        routines: [{id: "market", name: "Market scan", when: "every day · 09:13", paused: false, by_hq: false, last: "2026-11-20", spend: 0.07, note: ""}, {id: "brief", name: "Morning business brief", when: "every day · morning", paused: true, by_hq: false, last: "", spend: 0, note: "Paused Nov 14 (dedupe)"}],
        workers: [{id: "worker", name: "Worker / ship gate", result: "shipped", last: "2026-11-20T21:42:00", next: "2026-11-20T22:42:00", summary: "Shipped #105"}, {id: "dev-lead", name: "Dev Lead", result: "failed", last: "2026-11-20T18:00:00", next: "", summary: "Tests red"}]}}
    : c.q === "planner" ? {title: "Planner", lines: ["4 item(s)"], plan: {range: c.range, calendar: false, days: [{d: new Date().toISOString().slice(0, 10), items: [{t: "04:30", e: "12:30", title: "Work", kind: "shift", src: "agenda", id: 7, rep: "mon,thu"}, {t: "10:00", e: "11:00", title: "Pharm exam", kind: "deadline", src: "agenda", id: 8, rep: ""}, {t: "22:15", e: "22:30", title: "Ship-gate window", kind: "gate"}, {t: "", e: "", title: "Turkey Trot 5K", kind: "race"}], clash: ["Work overlaps Pharm exam"]}].concat(c.range === "week" ? [{d: "2026-11-22", items: [], clash: []}] : [])}}
    : {title: "Spend", lines: ["Today: $0.67 of the $5.00 daily cap ($4.33 left).", "Over-budget pause: armed"]};
  const vesper = c => { if (t1(c)){ say(c, "running"); say(c, "completed", {ok: true, say: "read " + (c.q || c.t), result: c.t === "defer" ? null : readRes(c)}); return; }
    say(c, "awaiting_telegram_approval", {say: "Waiting for your Approve in Telegram.", cost: c.t === "text" ? 0.15 : 0, tier: 2});
    const tap = () => { if (/reject/.test(c.text || "")) return say(c, "rejected", {say: "Rejected in Telegram. Nothing ran."}); say(c, "running", {say: "Approved in Telegram."});
      say(c, "completed", {ok: true, say: c.t === "text" ? "TEST reply: all steady, Sir." : "Done."}); };
    if (/sign-ups|reject/.test(c.text || "")) pend.push(tap); else setTimeout(tap, 1500); };   // these two wait until the test taps Approve/Reject
  const telegram = () => pend.splice(0).forEach(f => f());
  const tel = () => ({at: Math.round(Date.now() / 1000) - telAge, spend: {today: telPaused ? 0.86 : 0.67, cap: 5, limit: 0.86, left: telPaused ? 0 : 0.19, pct: telPaused ? 17 : 13, paused: telPaused, reason: telPaused ? "cap reached" : "", month: 8.27, month_cap: 17},
    gate: {next_n: 4, next_title: "Fix: TEST bug fix", queue: 2, next_run: new Date(Date.now() + 37 * 60000).toISOString()}, relay: {mode: "normal"},
    // times relative to now (Nov 21): fixed dates made "went live in the last 24h" false a day after the test was written
    pipe: [{n: 4, r: "app", t: "Fix: TEST bug fix", loc: ["Mileset App & Site"], st: "Queued for Gate", ch: "pass", bad: [], files: 2, add: 10, del: 3, sum: "Fixes the TEST bug.", at: iso(120), u: "https://github.com/x/4"},
           {n: 241, r: "vesper", t: "TEST Vesper upgrade", loc: ["Vesper Relay (server)"], st: "Awaiting Telegram Tap", ch: "pass", bad: [], files: 3, add: 50, del: 9, sum: "Tiers.", at: iso(60), u: "https://github.com/x/241"},
           {n: 111, r: "app", t: "TEST held change", loc: ["HQ Frontend"], st: "Held", ch: "none", bad: [], files: 1, add: 2, del: 0, sum: "Held.", at: iso(25 * 60), u: ""},
           {n: 7, r: "app", t: "TEST failing change", loc: ["Cloudflare Worker / D1"], st: "Tests Failing", ch: "fail", bad: ["checks"], files: 1, add: 1, del: 1, sum: "Broken.", at: iso(180), u: ""},
           {n: 3, r: "app", t: "TEST shipped change", loc: ["HQ Frontend"], st: "Live", ch: "pass", bad: [], files: 4, add: 80, del: 20, sum: "Shipped.", at: iso(240), u: ""}],
    incidents: {mail: 2, e5xx: 1, relay: 0, total: 3}, next_block: {d: new Date(Date.now() + 864e5).toISOString().slice(0, 10), t: "07:00", e: "08:30", title: "NCLEX review", kind: "appointment"}, breaker: {on: telBreaker, until: Math.round(Date.now() / 1000) + 600, limit: 1.5, mins: 30},
    members: {total: 42, a24: 9, a7: 21, a30: 33, new24: 1, new7: 5, risk: 6, sessions_today: 14, meals_today: 23, at: Math.round(Date.now() / 1000)}});
  page.on("console", m => { if (m.type() === "error" && !/favicon|404|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(m.text())) cErr.push(m.text()); }); page.on("pageerror", e => cErr.push(String(e)));
  const json = (route, obj, status = 200) => route.fulfill({status, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: JSON.stringify(obj)});
  await ctx.route(/^https:\/\//, async route => { const q = route.request(), u = q.url(); reqs.push({u, at: Date.now(), body: q.postData() || ""});
    if (/hq-data\/hq\.json|contents\/hq\.json/.test(u)) return json(route, PUB);
    if (/hq-full\.json/.test(u)) return json(route, {v: 1, ...seal(PRIV, "mileset-hq-v1")});
    if (/\/pulls\?/.test(u)) return json(route, PULLS);
    if (/check-runs/.test(u)) return json(route, {check_runs: [{name: "checks", status: "completed", conclusion: "success"}]});
    if (/actions\/runs/.test(u)) return json(route, {workflow_runs: [{name: "Nightly check", conclusion: "success", status: "completed", updated_at: iso(600), html_url: ""}]});
    if (/\/api\/founding/.test(u)) return json(route, {left: 83, max: 100, members: 17});
    if (/\/api\/me$/.test(u)) return json(route, ME);
    if (/\/api\/hq\/tel\//.test(u)){ if (!boxOn) return json(route, {error: "Not found"}, 404); return json(route, {tel: {id: 1, ...seal(tel(), "mileset-hq-tel-v1")}, now: new Date().toISOString()}); }
    if (/\/api\/hq\/box\//.test(u)){ if (!boxOn) return json(route, {error: "Not found"}, 404);
      if (q.method() === "OPTIONS") return route.fulfill({status: 204, headers: {"access-control-allow-origin": "*", "access-control-allow-headers": "content-type"}});
      if (q.method() === "POST"){ const b = JSON.parse(q.postData()), c = open(b, "mileset-hq-cmd-v1");
        if (dropNext && c.t === dropNext){ dropNext = ""; return route.abort(); }
        if (noSignal) return route.abort("internetdisconnected");                       // a network failure on the first try
        if (seenCid.has(b.cid)) return json(route, {id: seenCid.get(b.cid), dup: true});            // same command again: stored once
        cmds.push({...c, _cid: b.cid}); seenCid.set(b.cid, cmds.length); vesper(c); return json(route, {id: cmds.length}, 201); }
      const since = +new URL(u).searchParams.get("since") || 0; return json(route, {rows: box.filter(r => r.id > since)}); }
    return route.fulfill({status: 404, body: ""}); });
  await page.addInitScript(() => { try { localStorage.setItem("hp-token", "t".repeat(64)); } catch(e){} });
  const shot = n => SHOTS ? page.screenshot({path: `${SHOTS}/${name}-${n}.png`}) : null;
  const T = what => `${name}: ${what}`;

  // 1. locked: public floor only, nothing private
  await page.goto(BASE); await page.waitForSelector(".stn"); await page.waitForTimeout(900);
  check(await page.locator(".stn").count() === 7, T("7 stations on the floor (Vesper, Dev Lead, Product Lead, Growth, QA / Phone Test, Personal Ops, Stark)"));
  check(await page.isVisible("#lock") && /private link/.test(await page.innerText("#lock")), T("without the key HQ says how to unlock"));
  check(!/TEST PRIVATE/.test(await page.content()), T("without the key no private words are shown"));
  check(await page.locator('.stn[data-id="dev"][data-s="working"]').count() === 1, T("public snapshot still shows who is working"));
  await shot("1-locked");
  // 1b. Nov 21: a home-screen app can't take the key from Telegram; it takes the link pasted into the lock card
  check(await page.isVisible("#lock #ukey") && /hq link/.test(await page.innerText("#lock")), T("the lock card offers paste-to-unlock"));
  await page.fill("#ukey", "not a link"); await page.click("#ugo"); check(/doesn't look like/.test(await page.innerText("#umsg")), T("paste-to-unlock: a wrong paste says so"));
  await page.fill("#ukey", "https://app.milesetapp.com/hq/#k=" + KEY); await page.click("#ugo");
  await page.waitForFunction(() => /\$0\.67/.test(document.querySelector("#t-amt").textContent), null, {timeout: 8000}).catch(() => {});
  check((await page.evaluate(() => localStorage.getItem("hq-k"))) === KEY && /\$0\.67/.test(await page.innerText("#t-amt")), T("paste-to-unlock: the pasted link unlocks this device"));
  await page.evaluate(() => localStorage.removeItem("hq-k")); await page.goto(BASE); await page.reload(); await page.waitForTimeout(400);
  // 2. unlock with the private link
  await page.goto(BASE + "#k=" + KEY); await page.reload(); await page.waitForFunction(() => /\$0\.67/.test(document.querySelector("#t-amt").textContent), null, {timeout: 8000});
  const url = page.url(); check(phone ? /#k=/.test(url) : !/k=/.test(url), T(phone ? "iPhone Safari keeps the key in the address for Add to Home Screen (unchanged)" : "the key is wiped from the address after unlocking (unchanged)"));
  check((await page.evaluate(() => localStorage.getItem("hq-k"))) === KEY, T("the key is kept on this device only (localStorage hq-k, unchanged)"));
  check(await page.getAttribute('#dock [data-v="overview"]', "aria-current") === "page" && await page.isVisible("#c-ov"), T("once unlocked, HQ lands on the Executive Overview"));
  await page.click('#dock [data-v="floor"]'); await page.waitForTimeout(400);
  check(await page.isVisible("#macros .mac"), T("switching to the floor shows the Macro dock straight away"));
  await page.waitForFunction(() => /RELAY ONLINE/.test(document.querySelector("#t-relay").textContent), null, {timeout: 12000}).catch(() => {});
  const tb = await page.innerText("#tbar");
  check(/\$0\.67 \/ \$5\.00/.test(tb) && /\$0\.19 left today/.test(tb) && await page.evaluate(() => document.querySelector("#t-spend .meter u").style.width) === "13%", T("header bar: $0.67 / $5.00, percentage bar, headroom ($0.19 left today, under the monthly limit)"));
  check(/PAUSE ARMED/.test(tb) && await page.getAttribute("#t-pause", "data-s") === "ok", T("header bar: over-budget pause shows ARMED"));
  check(/RELAY ONLINE · \d+s/.test(tb), T("header bar: relay ONLINE with a relative time (" + (tb.match(/RELAY[^\n]*/) || [""])[0] + ")"));
  check(/NEXT #4 · (TOMORROW )?\d/.test(tb), T("header bar: next queued change and the next hourly run [" + (tb.match(/NEXT[^\n]*|GATE[^\n]*/) || [""])[0] + "]"));
  check(/2 quiet failures today/.test(await page.innerText("#p-quiet")), T("HUD quiet-failure badge"));
  check(/All systems go/.test(await page.innerText("#p-health")) && /Vesper/.test(await page.innerText("#p-vesper")), T("HUD health and Vesper status"));
  await page.waitForFunction(() => /Synced/.test(document.querySelector("#sync").textContent), null, {timeout: 5000}).catch(() => {});
  check(/Synced \d+s ago/.test(await page.innerText("#sync")), T("live 'Synced Xs ago' pulse"));
  const bub = await page.innerText('.stn[data-id="dev"] .bub'); check(/fixing the reminder ask/.test(bub) && !/tools\/x\.py|Hybrid #120/.test(bub) && /app change #120/.test(bub), T("activity bubble is plain words (no file names or repo slugs): " + bub));
  check(await page.locator('#b-dev:not([hidden])').count() === 1, T("an energy beam runs to the working station"));
  check(await page.locator('.stn[data-id="qa"][data-s="waiting"]').count() === 1 && await page.locator('.stn[data-id="stark"][data-s="idle"]').count() === 1 && await page.locator('.stn[data-id="personal"][data-s="ok"]').count() === 1, T("status halos: waiting on approval, idle, on track"));
  if (phone) await page.click("#call [data-fold]").catch(() => {});
  const call = await page.innerText("#call"); check(/Needs your call · 2/i.test(call) && /TEST held change/.test(call) && /Approve/.test(call) && /Hold/.test(call) && /Defer/.test(call) && !/dock key/.test(call), T("Needs Your Call banner with Approve / Hold / Defer; a change held by you is not nagged"));
  // Nov 21: a "Defer a day" lasts the day (it came back after 30 min). Checked in a second tab so this one keeps its state.
  { const p2 = await ctx.newPage(), n = t => +((/Needs your call · (\d+)/i.exec(t) || [])[1] || 0);
    const callTxt = async () => { await p2.waitForFunction(() => /Needs your call/i.test((document.querySelector("#call") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
      return p2.evaluate(() => (document.querySelector("#call") || {}).textContent || ""); };
    await p2.goto(BASE); await p2.waitForSelector(".stn", {state: "attached"}); const before = await callTxt();
    await p2.evaluate(() => { const o = JSON.parse(localStorage.getItem("hq-opt") || "{}"); o["defer:pr:1"] = {v: Date.now() + 20 * 3600e3, at: Date.now() - 40 * 60e3}; localStorage.setItem("hq-opt", JSON.stringify(o)); });
    await p2.reload(); const after = await callTxt();
    check(/TEST held change/.test(before) && !/TEST held change/.test(after) && n(after) === n(before) - 1, T("a deferred card stays hidden for the day, not 30 minutes"));
    await p2.evaluate(() => { const o = JSON.parse(localStorage.getItem("hq-opt") || "{}"); delete o["defer:pr:1"]; localStorage.setItem("hq-opt", JSON.stringify(o)); });
    await p2.close(); }
  if (phone) await page.click("#recap [data-fold]").catch(() => {});
  check(await page.locator("#recap li").count() === 3, T("recap card has 3 plain bullets")); await shot("2-floor");
  if (phone){ await page.click("#recap [data-fold]"); await page.click("#call [data-fold]"); }
  await page.waitForTimeout(900); await shot("2b-floor-clear");
  // 3. station inspector
  await page.evaluate(() => document.querySelector('.stn[data-id="dev"]').click()); await page.waitForSelector("#drawer.on"); await page.waitForTimeout(700);
  const dr = await page.innerText("#drawer"); check(/Current task/i.test(dr) && /Recently finished/i.test(dr) && /Reliability and speed/i.test(dr) && /90%/.test(dr) && /Activity/i.test(dr) && /Technical log/.test(dr), T("station inspector: task, progress, recent work, reliability, activity, raw log on demand"));
  await page.waitForFunction(() => /scale\((0\.9|1\.1)/.test(document.querySelector("#world").style.transform), null, {timeout: 4000}).catch(() => {});   // let the camera settle
  const tf = await page.evaluate(() => document.querySelector("#world").style.transform); check(/scale\((0\.9|1\.1)/.test(tf), T("tapping a station zooms the floor to it (" + tf.slice(-14) + ")"));
  await shot("3-inspector"); await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  // pan + zoom
  const t0 = await page.evaluate(() => document.querySelector("#world").style.transform);
  await page.mouse.move(200, 500); await page.mouse.down(); await page.mouse.move(120, 420, {steps: 5}); await page.mouse.up(); await page.mouse.wheel(0, -300); await page.waitForTimeout(500);
  check(t0 !== await page.evaluate(() => document.querySelector("#world").style.transform), T("the floor pans and zooms")); await page.click("#fit"); await page.waitForTimeout(500);
  // 4. approve from the banner: sealed command, instant screen update, Vesper's confirmation
  if (phone) await page.click("#call [data-fold]");
  const n0 = cmds.length; await page.click('#call .btn.go >> nth=0'); await page.waitForTimeout(250);
  check(!/TEST held change/.test(await page.innerText("#call").catch(() => "")), T("Approve updates the screen at once (optimistic)"));
  await page.waitForFunction(() => /Approve it in Telegram/.test(document.querySelector("#toasts").textContent), null, {timeout: 9000}).catch(() => {});
  const HQ_TIER2 = c => c.t !== "read";
  const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check(cmds.length === n0 + 1 && cmds[n0].t === "ship" && cmds[n0].n === 1 && UUIDRE.test(cmds[n0].command_id) && cmds[n0]._cid === cmds[n0].command_id && cmds[n0].origin === "hq" && Math.abs(cmds[n0].ts - Date.now()) < 60000,
        T("Approve sends a sealed 'ship #1' command with a UUID command_id (also the mailbox cid), origin hq and a timestamp"));
  check(/Approve it in Telegram/.test(await page.innerText("#toasts")), T("Tier 2: HQ says it's awaiting your Telegram approval"));
  await page.waitForFunction(() => /Done: Done/.test(document.querySelector("#toasts").textContent), null, {timeout: 9000}).catch(() => {});
  check(/Done: Done/.test(await page.innerText("#toasts")), T("after the (simulated) Telegram Approve, the result arrives without leaving HQ"));
  // 5. focus toggle
  await page.click('#focus [data-m="class"]'); await page.waitForTimeout(80); check(await page.getAttribute('#focus [data-m="class"]', "aria-pressed") === "true", T("focus toggle flips at once")); await page.waitForTimeout(300);
  check(cmds.some(c => c.t === "focus" && c.mode === "class"), T("focus toggle tells Vesper (In class)"));
  // 6. command bar
  if (phone) await page.click("#cmdpill"); else await page.keyboard.press("Control+k");
  await page.waitForSelector("#pal input");
  check(/Spend today\s*instant/.test(await page.innerText("#pal .sug")) && /needs Telegram OK/.test(await page.innerText("#pal .sug")), T("command bar labels reads 'instant' and changes 'needs Telegram OK'"));
  const r1 = cmds.length; await page.click('#pal .sug button:has-text("Spend today")');
  await page.waitForFunction(() => /Completed/i.test(document.querySelector("#pal .thread").textContent) && /\$4\.33 left/.test(document.querySelector("#pal .thread").textContent), null, {timeout: 9000}).catch(() => {});
  const th1 = await page.innerText("#pal .thread"); check(cmds[r1] && cmds[r1].t === "read" && cmds[r1].q === "spend" && /Completed/i.test(th1) && /\$4\.33 left/.test(th1), T("Tier 1 read (spend) runs at once and shows its structured result in place"));
  await page.fill("#pal input", "how are sign-ups today"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Awaiting Telegram approval/i.test(document.querySelector("#pal .thread").textContent), null, {timeout: 6000}).catch(() => {});
  check(/Awaiting Telegram approval/i.test(await page.innerText("#pal .thread")), T("a typed question shows the 'awaiting Telegram approval' badge")); telegram();
  await page.waitForFunction(() => /TEST reply/.test(document.querySelector("#pal .thread").textContent), null, {timeout: 9000}).catch(() => {});
  check(cmds.some(c => c.t === "text" && c.text === "how are sign-ups today") && /TEST reply/.test(await page.innerText("#pal .thread")), T("command bar sends a typed command and shows Vesper's reply in place"));
  await page.fill("#pal input", "please reject this one"); await page.keyboard.press("Enter"); await page.waitForTimeout(800); telegram();
  await page.waitForFunction(() => /Rejected/i.test(document.querySelector("#pal .thread").textContent), null, {timeout: 9000}).catch(() => {});
  check(/Rejected/i.test(await page.innerText("#pal .thread")), T("a command rejected in Telegram shows 'Rejected'")); await shot("4-command"); await page.keyboard.press("Escape");
  // 7. ship gate + PRs
  await page.click('#dock [data-v="ship"]'); await page.waitForSelector(".tl .step");
  const steps = await page.$$eval(".tl .step", e => e.map(x => x.dataset.n + ":" + x.dataset.pr));
  check(steps.join(",").startsWith("1:4,2:1,3:2") || steps.join(",").startsWith("1:4,2:2"), T("ship gate order: bug fix first, then oldest (" + steps.join(",") + ")"));
  const cc = await page.innerText("#c-cmds").catch(() => ""); check(/Commands you sent/i.test(cc) && /Completed/i.test(cc) && /Rejected/i.test(cc), T("'Commands you sent' lists each command with its status badge"));
  const ship = await page.innerText("#views"); check(/Held by you/.test(ship) && /Release hold/.test(ship) && /Still being built/.test(ship) && /Went live/.test(ship) && /Goes live around/.test(ship), T("ship gate shows queued (with times), held by you, not ready and shipped"));
  check(/Pipeline/.test(ship) && /Vesper #241/.test(ship) && !/Pull requests and code changes/.test(ship), T("PR cards: the Pipeline (incl. Vesper upgrades) replaces the plain list once Vesper's heartbeat has it"));
  await page.waitForFunction(() => /Checks passing/.test(document.querySelector("#views").textContent), null, {timeout: 6000}).catch(() => {}); check(/Checks passing/.test(await page.innerText("#views")), T("PR check status shows"));
  await page.click('.tl .step[data-pr="2"]'); await page.waitForSelector("#drawer.on"); check(/Checks/i.test(await page.innerText("#drawer")) && /Open on GitHub/.test(await page.innerText("#drawer")), T("PR click-to-inspect drawer")); await shot("5-ship"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  // 8. company
  await page.click('#dock [data-v="company"]'); await page.waitForSelector("#c-spend"); const co = await page.innerText("#views");
  check(/\$0\.67/.test(co) && /of \$5\.00 today/.test(co) && /real limit is \$0\.86/.test(co) && /Where it went/i.test(co) && /Everyday model/.test(co) && /going over budget/i.test(co), T("spend tracker: today vs $5 cap, monthly limit, breakdown, over-budget trigger"));
  check(/17 members/.test(co) && /83 Founding spots left/.test(co) && /Built a plan/.test(co) && /76%/.test(co) && /All sending/.test(co) && /Nightly full phone test/.test(co) && /Fix in progress/.test(co), T("members and app health: live count, funnel, member emails, phone tests, open incident"));
  await page.click('#dock [data-v="growth"]'); await page.waitForSelector("#c-gctl"); const gr = await page.innerText("#views");
  check(/Instagram followers/.test(gr) && /Ready to connect: Meta Ads/.test(gr) && /Ready to connect: the scheduled post queue/.test(gr), T("Growth: real counts where they exist, clean 'Ready to connect' where Buffer/Meta Ads aren't wired"));
  check(/Ready · 1/i.test(gr) && /Exploring · 1/i.test(gr) && /In progress · 0/i.test(gr), T("Growth: ideas board columns"));
  await page.click(".idea >> nth=0"); await page.waitForSelector("#drawer.on"); await page.click("#drawer .btn.go"); await page.waitForTimeout(300); check(cmds.some(c => c.t === "greenlight" && c.n === 1), T("greenlight an idea in one tap")); await shot("6-company"); await page.keyboard.press("Escape"); await page.waitForTimeout(400); if (SHOTS) await page.screenshot({path: `${SHOTS}/${name}-6b-company-full.png`, fullPage: false});
  // 9. personal wing
  await page.click('#dock [data-v="me"]'); await page.waitForSelector("#cap"); let me = await page.innerText("#views");
  check(/Daily focus/.test(me) && /TEST work shift/.test(me) && /Needs you today/.test(me) && /Vesper is handling/.test(me) && /TEST renew parking pass/.test(me), T("daily focus radar: your day vs what Vesper carries"));
  check(/TEST Med-surg exam/.test(me) && /9 days/.test(me) && /No study cards yet/.test(me), T("nursing hub: exam countdowns and an honest empty study deck"));
  await page.fill("#card-q", "Antidote for heparin?"); await page.fill("#card-a", "Protamine sulfate"); await page.click("[data-addcard]"); await page.waitForTimeout(200);
  check(/1 card/.test(await page.innerText("#views")) && await page.locator("[data-audio]").count() === 1, T("add a study card, then a 1-tap audio active-recall button appears"));
  check(/TEST City Marathon/.test(me) && /200/.test(me) && /Miles this week/.test(me) && /Food logged/.test(me) && /7\.5 h/.test(me), T("running: race countdowns, weekly miles, consistency, recovery (from the owner's own account)"));
  await page.fill("#cap", "pick up scrubs Thursday"); await page.click("[data-capture]"); await page.waitForTimeout(400);
  check(cmds.some(c => c.t === "capture" && /scrubs/.test(c.text)) && /pick up scrubs/.test(await page.innerText("#views")), T("quick capture goes to Vesper and shows in the list"));
  await page.waitForFunction(() => /Completed/i.test(document.querySelector("#views").textContent), null, {timeout: 9000}).catch(() => {});
  check(/Completed/i.test(await page.innerText("#views")), T("quick capture shows its status badge (completed after approval)"));
  // a network failure on the first try: HQ resends the SAME command id, and the mailbox stores it once
  dropNext = "capture"; const c0 = cmds.length, q0 = reqs.length; await page.fill("#cap", "renew parking pass"); await page.click("[data-capture]");
  for (let i = 0; i < 30 && cmds.length === c0; i++) await page.waitForTimeout(500);
  const tries = reqs.slice(q0).filter(r => r.body && /"d":"in"/.test(r.body)).map(r => JSON.parse(r.body));
  check(cmds.length === c0 + 1 && tries.length >= 2 && tries.every(b => b.cid === tries[0].cid && b.ct === tries[0].ct) && cmds[c0].text === "renew parking pass",
        T("after a dropped send, HQ retries with the same command id and envelope, and Vesper gets it once (" + tries.length + " tries)"));
  await shot("7-me");

  // HQ tabs, batch 1: keyboard tabs, the Pipeline board and Members (all reads are $0 Tier 1)
  await page.click('#dock [data-v="floor"]'); await page.mouse.click(5, 300).catch(() => {}); await page.keyboard.press("Escape");
  if (!phone){ await page.keyboard.press("3"); check(await page.getAttribute('#dock [data-v="ship"]', "aria-current") === "page", T("key 3 opens Pipeline"));
    await page.keyboard.press("4"); check(await page.getAttribute('#dock [data-v="members"]', "aria-current") === "page", T("key 4 opens Members"));
    await page.keyboard.press("1"); check(await page.getAttribute('#dock [data-v="overview"]', "aria-current") === "page", T("key 1 opens the Overview")); }
  await page.click('#dock [data-v="ship"]'); await page.waitForSelector("#c-pipe .pc", {timeout: 12000}).catch(() => {});
  check(/^\d\d:\d\d$/.test(await page.innerText("#cd").catch(() => "")), T("Pipeline: live countdown to the next ship-gate run (" + await page.innerText("#cd").catch(() => "?") + ")"));
  const pv = await page.innerText("#c-pipe").catch(() => "");
  check(/Awaiting Telegram Tap/.test(pv) && /Queued for Gate/.test(pv) && /Held/.test(pv) && /Live/.test(pv) && /Tests Failing/.test(pv) && /Vesper Relay/.test(pv) && /Cloudflare Worker \/ D1/.test(pv) && /HQ Frontend/.test(pv),
        T("Pipeline: every change with its exact stage and where it lands (HQ, Worker/D1, app, Vesper)"));
  await page.click('#c-pipe [data-pf="layer:Vesper Relay (server)"]'); const pv2 = await page.innerText("#c-pipe");
  check(/TEST Vesper upgrade/.test(pv2) && !/TEST bug fix/.test(pv2), T("Pipeline: filter by layer"));
  await page.click('#c-pipe [data-pf="layer:all"]'); await page.click('#c-pipe [data-pf="stage:Live"]'); const pv3 = await page.innerText("#c-pipe");
  check(/TEST shipped change/.test(pv3) && !/TEST held change/.test(pv3), T("Pipeline: filter by stage"));
  await page.click('#c-pipe [data-pf="stage:all"]'); await page.click('#c-pipe [data-pf="view:list"]'); check(!(await page.$("#c-pipe .board")), T("Pipeline: board and table views"));
  await page.click('#c-pipe [data-pi="vesper:241"]'); await page.waitForSelector("#drawer.on");
  const dv = await page.innerText("#drawer"); check(/Tiers\./.test(dv) && /All checks passed/.test(dv) && await page.$('#drawer [data-cmd*="install"]'), T("Pipeline drawer: diff summary, tests, and Request approval (Tier 2 install card)"));
  const ip0 = cmds.length; await page.click('#drawer [data-cmd*="install"]'); await page.waitForTimeout(600);
  check(cmds[ip0] && cmds[ip0].t === "install" && cmds[ip0].n === 241 && UUIDRE.test(cmds[ip0].command_id), T("Request approval sends an idempotent Tier 2 command (UUID command_id)"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  await page.click('#c-pipe [data-pi="app:111"]'); await page.waitForSelector("#drawer.on");
  check(!(await page.$("#drawer [data-cmd]")) && /stays held/.test(await page.innerText("#drawer")), T("#111 stays held: its card offers no command at all"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(250); check(!(await page.$("#drawer.on")), T("Esc closes the drawer"));
  await shot("9-pipeline");
  const mr0 = cmds.length; await page.click('#dock [data-v="members"]');
  await page.waitForFunction(() => /Ana Runner/.test((document.querySelector("#c-roster") || {}).textContent || ""), null, {timeout: 12000}).catch(() => {});
  const mk = await page.innerText("#c-kpis"); check(/42\s*Total members/.test(mk) && /21\s*Active 7d/.test(mk) && /6\s*At risk/.test(mk) && /23\s*Meals logged today/.test(mk), T("Members: live KPIs (total, active 24h/7d/30d, new, at-risk, sessions and meals today)"));
  const mr = cmds.find(c => c.t === "read" && c.q === "members");   // key 3 may already have asked
  check(mr && /Ana Runner/.test(await page.innerText("#c-roster")) && /cara@x\.test/.test(await page.innerText("#c-roster")), T("Members: the roster arrives as a Tier 1 read ($0, no AI) and lists each member"));
  await page.fill("#m-q", "ben"); await page.waitForTimeout(200); const ms1 = await page.innerText("#c-roster");
  check(/Ben Lifter/.test(ms1) && !/Ana Runner/.test(ms1), T("Members: instant search by name or email"));
  await page.fill("#m-q", ""); await page.waitForTimeout(150); await page.click('#c-roster [data-ms="name"]'); const firstName = (await page.innerText("#c-roster tbody tr:first-child")).split("\n")[0];
  check(/Ana Runner/.test(firstName), T("Members: sortable columns (" + firstName + ")"));
  const rf0 = cmds.length; await page.click('#c-roster [data-mf="risk"]'); await page.waitForTimeout(1500);
  check(cmds.slice(rf0).some(c => c.q === "members" && c.f === "risk") && !/Ana Runner/.test(await page.innerText("#c-roster")), T("Members: filter pills (At-risk asks Vesper for that list)"));
  await page.click('#c-roster [data-mf="all"]'); await page.waitForFunction(() => /Ana Runner/.test(document.querySelector("#c-roster").textContent), null, {timeout: 8000}).catch(() => {});
  await page.click('#c-roster tr[data-mr="u1aaaaaa"]'); await page.waitForFunction(() => /Streak/.test((document.querySelector("#drawer") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  const md = await page.innerText("#drawer");
  check(/ana@x\.test/.test(md) && /Streak/.test(md) && /day3 nudge/i.test(md) && /Send password reset/.test(md), T("Member drawer: signup, streak, meal days, email status and admin actions"));
  check((await page.$$eval("#drawer button[disabled]", b => b.map(x => x.textContent))).join("|") === "Magic link|Grant trial days", T("Member drawer: actions Mileset doesn't have stay off instead of pretending"));
  const wl0 = cmds.length; await page.click('#drawer [data-cmd*="welcome"]'); await page.waitForTimeout(500);
  check(cmds[wl0] && cmds[wl0].t === "member" && cmds[wl0].act === "welcome" && cmds[wl0].uid === "u1aaaaaa" && UUIDRE.test(cmds[wl0].command_id), T("Resend welcome is a Tier 2 command (Telegram approval)"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(250); await page.$eval('#c-roster tr[data-mr="u1aaaaaa"]', e => e.scrollIntoView({block: "center"})); await page.click('#c-roster tr[data-mr="u1aaaaaa"] b'); await page.waitForFunction(() => /Streak/.test((document.querySelector("#drawer") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  const ma0 = cmds.length; await page.click('#drawer [data-cmd*="reset"]'); await page.waitForTimeout(600);
  check(cmds[ma0] && cmds[ma0].t === "member" && cmds[ma0].act === "reset" && cmds[ma0].uid === "u1aaaaaa" && UUIDRE.test(cmds[ma0].command_id), T("Send password reset is a Tier 2 command with its own UUID (Telegram approval)"));
  const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  check(!/ana@x\.test|Ana Runner|cara@x/.test(stored), T("member names and emails are never written to this device's storage"));
  await page.keyboard.press("Escape"); await shot("10-members");
  if (phone) await page.click("#cmdpill"); else await page.keyboard.press("Meta+k");
  await page.waitForSelector("#pal input"); await page.fill("#pal input", "#241"); await page.waitForTimeout(150);
  check(/Open Vesper #241/.test(await page.innerText("#pal .sug")), T("⌘K: open a change by number"));
  await page.fill("#pal input", "find cara"); await page.waitForTimeout(150); check(/Find member: cara/.test(await page.innerText("#pal .sug")), T("⌘K: search members (\"find …\" or \"@…\")"));
  await page.fill("#pal input", "pipeline"); await page.waitForTimeout(150); check(/Go to Pipeline/.test(await page.innerText("#pal .sug")), T("⌘K: jump to any tab"));
  await page.keyboard.press("Escape");

  // HQ tabs, batch 2: macro dock, live command drawer, finance & spend guardrails
  await page.click('#dock [data-v="floor"]'); await page.waitForSelector("#macros .mac");
  const mtx = await page.innerText("#macros");
  check((await page.$$("#macros .mac")).length === 5 && /Check gate & queue/i.test(mtx) && /Pause all outbound/i.test(mtx) && /Instant · Tier 1/i.test(mtx) && /Telegram gated · Tier 2/i.test(mtx),
        T("Macro dock: five one-tap macros, each badged Instant (Tier 1) or Telegram gated (Tier 2)"));
  check(await page.$eval('#macros [data-macro="3"] small', e => e.className) === "t2" && await page.$eval('#macros [data-macro="4"] small', e => e.className) === "t2" && await page.$eval('#macros [data-macro="2"] small', e => e.className) === "t1",
        T("Macro dock: Sync Buffer and Pause all outbound are gated; reads are instant"));
  const mc0 = cmds.length; await page.click('#macros [data-macro="2"]');
  await page.waitForFunction(() => /Completed/i.test((document.querySelector("#drawer") || {}).textContent || "") && /Latency/.test(document.querySelector("#drawer").textContent), null, {timeout: 9000}).catch(() => {});
  const cdw = await page.innerText("#drawer");
  check(cmds[mc0] && cmds[mc0].t === "read" && cmds[mc0].q === "health" && cdw.includes(cmds[mc0].command_id) && /\d+\.\d s/.test(cdw) && /\$0\.00 \(plain code, no AI\)/.test(cdw) && /"q": "health"/.test(cdw),
        T("Live command drawer: exact payload, command_id, latency, token cost and output"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  if (!phone){ await page.click("#macros .crow"); await page.waitForSelector("#drawer.on"); check(/command_id/.test(await page.innerText("#drawer")), T("tapping a recent command opens its drawer")); await page.keyboard.press("Escape"); }
  await shot("11-macros");
  check(/Finance/.test(await page.innerText('#dock [data-v="company"]')), T("tab 4 is Finance"));
  await page.click('#dock [data-v="company"]'); await page.waitForFunction(() => /Vesper API burn/.test((document.querySelector("#c-fin") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  const fv = await page.innerText("#c-fin");
  check(/\$0\.00\s*Gross revenue/.test(fv) && /\$6\.20\s*Vesper API burn/.test(fv) && /−\$6\.20\s*Net/.test(fv) && /\$26\.60\s*30-day run rate/.test(fv) && /Founding 100 are free/.test(fv),
        T("Finance: revenue (honest $0, no paid plans), burn, net and the 30-day run rate"));
  check((await page.$$("#c-fin .bars i")).length === 7, T("Finance: daily burn bars"));
  const fr0 = cmds.length; await page.click('#c-fin [data-fr="30d"]'); await page.waitForFunction(() => /\$21\.40/.test(document.querySelector("#c-fin").textContent), null, {timeout: 9000}).catch(() => {});
  check(cmds.slice(fr0).some(c => c.t === "read" && c.q === "finance" && c.range === "30d") && /\$21\.40/.test(await page.innerText("#c-fin")), T("Finance: Today / 7D / 30D / All-time ranges ($0 reads)"));
  await page.$eval('#c-fin [data-fj="job:chat"] span', e => e.scrollIntoView({block: "center"})); await page.click('#c-fin [data-fj="job:chat"] span'); check(/chat\s*\$3\.10 · 50%/.test(await page.innerText("#c-fin")), T("Finance: clickable breakdown by job and model"));
  const bc0 = cmds.length; await page.fill("#b-cap", "6"); await page.click('[data-budget="cap"]'); await page.waitForTimeout(500);
  await page.$eval("#b-warn", e => { e.value = "85"; e.dispatchEvent(new Event("input", {bubbles: true})); }); check(/85% \(\$5\.10\)/.test(await page.innerText("#c-guard")), T("Budget controls: the warning slider shows the level and its dollar amount"));
  await page.click('[data-budget="warn"]'); await page.waitForTimeout(500); await page.click('[data-budget="pause"]'); await page.waitForTimeout(500);
  const bcs = cmds.slice(bc0).filter(c => c.t === "budget");
  check(bcs.length === 3 && bcs[0].op === "cap" && bcs[0].val === 6 && bcs[1].op === "warn" && bcs[1].val === 85 && bcs[2].op === "pause" && bcs.every(c => UUIDRE.test(c.command_id)),
        T("Budget controls: cap, warning level and pause each go to Vesper as a Tier 2 command with its own UUID"));
  check(await page.evaluate(() => HQ.tier({t: "budget", op: "cap", val: 6})) === 2, T("every budget change is Tier 2 (Telegram approval)"));
  await shot("12-finance");

  // HQ tabs, batch 3: Growth controls, Planner (Client Sites removed in batch 4)
  check((await page.$$("#dock button")).length === 7, T("seven tabs in the dock"));
  if (!phone){ await page.keyboard.press("6"); check(await page.getAttribute('#dock [data-v="growth"]', "aria-current") === "page", T("key 6 opens Growth"));
    await page.keyboard.press("5"); check(await page.getAttribute('#dock [data-v="company"]', "aria-current") === "page", T("key 5 opens Finance")); }
  check(!(await page.$('#dock [data-v="sites"]')) && !/Client sites|Go to Client/i.test(await page.content()), T("Client Sites is gone: no tab, no key, no palette entry"));
  await page.click('#dock [data-v="growth"]'); await page.waitForSelector("#c-gctl");
  const g0 = cmds.length; await page.fill("#g-post", "fueling your first 20-miler"); await page.click("[data-gpost]"); await page.waitForTimeout(400);
  await page.click('#c-gctl [data-label="Pause the Buffer queue"]'); await page.waitForTimeout(300); await page.click('#c-gctl [data-label="Pause Meta campaigns"]').catch(() => {}); await page.waitForTimeout(300);
  const gc = cmds.slice(g0);
  check(gc.length === 3 && gc.every(c => c.t === "text" && UUIDRE.test(c.command_id)) && /20-miler/.test(gc[0].text) && /draft only/.test(gc[0].text) && /pause the Buffer queue/i.test(gc[1].text) && /Meta ad campaign/i.test(gc[2].text) && gc.every(c => HQ_TIER2(c)),
        T("Growth: Draft post, Pause queue and Pause campaign are Tier 2 (Telegram approval) with their own UUIDs"));
  await shot("13-growth");

  await page.click('#dock [data-v="me"]'); await page.waitForFunction(() => /Pharm exam/.test((document.querySelector("#c-plan") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  const pl = await page.innerText("#c-plan");
  check(/Work/.test(pl) && /Pharm exam/.test(pl) && /Exam \/ due/i.test(pl) && /Ship-gate window/.test(pl) && /Turkey Trot 5K/.test(pl) && /Clash: Work overlaps Pharm exam/.test(pl) && /4:30am/.test(pl),
        T("Planner: one timeline with shifts, exams, races and ship-gate windows; clashes stand out"));
  check(/calendar feed isn't connected/.test(pl), T("Planner: says plainly when the calendar feed isn't connected"));
  const w0 = cmds.length; await page.click('#c-plan [data-pl="week"]'); await page.waitForTimeout(1200);
  check(cmds.slice(w0).some(c => c.t === "read" && c.q === "planner" && c.range === "week"), T("Planner: Today / Week ($0 read)"));
  const qb0 = cmds.length; await page.fill("#qb", "Block 90 mins tomorrow at 7am for NCLEX sleep & pain review"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  check(cmds[qb0] && cmds[qb0].t === "block" && /NCLEX/.test(cmds[qb0].text) && UUIDRE.test(cmds[qb0].command_id) && await page.evaluate(() => HQ.tier({t: "block", text: "x"})) === 2,
        T("Quick-block bar: natural language goes to Vesper as a Tier 2 command (Approve / Reject card before writing)"));
  // Nov 21: edit or delete his own agenda items from the Planner (calendar, races and gate windows stay read-only)
  await page.click('#c-plan [data-pl="today"]').catch(() => {}); await page.waitForFunction(() => /Pharm exam/.test((document.querySelector("#c-plan") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  check(await page.locator("#c-plan [data-aged]").count() === 2, T("Planner: Edit on each agenda item, none on races or ship-gate windows"));
  await page.click('#c-plan [data-aged="8"]'); await page.waitForSelector("#pe-start");
  check(await page.inputValue("#pe-start") === "10:00" && await page.inputValue("#pe-day") !== "", T("Planner edit: opens with the item's own day and time"));
  await page.fill("#pe-start", "13:00"); await page.fill("#pe-end", "14:00"); const ae0 = cmds.length; await page.click("#c-plan [data-pesave]"); await page.waitForTimeout(500);
  const mv = cmds.slice(ae0).find(c => c.t === "agenda");
  check(mv && mv.op === "move" && mv.id === 8 && mv.start === "13:00" && mv.end === "14:00" && /^\d{4}-\d{2}-\d{2}$/.test(mv.day) && UUIDRE.test(mv.command_id), T("Planner edit: Save sends the new time and day to Vesper"));
  await page.click('#c-plan [data-aged="7"]').catch(() => {}); await page.waitForSelector("[data-pedel]").catch(() => {});
  check(await page.locator("#pe-day").count() === 0 && /every Mon, Thu/.test(await page.innerText("#c-plan")), T("Planner edit: a weekly item changes its time every week (no day box)"));
  const ad0 = cmds.length; await page.click("[data-pedel]"); await page.waitForTimeout(200);
  check(!cmds.slice(ad0).some(c => c.t === "agenda") && /Tap again to delete/.test(await page.innerText("#c-plan")), T("Planner delete: the first tap only asks to confirm"));
  await page.click("[data-pedel]"); await page.waitForTimeout(400);
  const rm = cmds.slice(ad0).find(c => c.t === "agenda");
  check(rm && rm.op === "remove" && rm.id === 7, T("Planner delete: the second tap deletes it"));
  await shot("15-planner");

  // HQ batch 4: Executive Overview, incidents badge, burn breaker, Agents & team, rollback, Open in HQ, offline queue
  await page.click('#dock [data-v="overview"]'); await page.waitForSelector("#c-ov .ovt");
  const ov = await page.innerText("#c-ov");
  check(/Active members\s*21/i.test(ov) && /9 today · 42 total/.test(ov) && /Spend today\s*\$0\.67/i.test(ov) && /Pending approvals/i.test(ov) && /Ship gate\s*#4/i.test(ov) && /1 failing/.test(ov)
        && /Incidents \(24h\)\s*\d/i.test(ov) && /2 email · 1 5xx/.test(ov) && /Next on your calendar\s*7:00am/i.test(ov) && /NCLEX review/.test(ov),
        T("Overview: active members, spend vs cap, pending approvals, ship-gate stage, incidents and the next calendar block [" + ov.replace(/\n/g, " / ") + "]"));
  await page.click('#c-ov .ovt[data-go="members"]'); check(await page.getAttribute('#dock [data-v="members"]', "aria-current") === "page", T("Overview tiles jump to their tab"));
  check(/INCIDENTS \d|⚠ \d/.test(await page.innerText("#t-inc")) && await page.getAttribute("#t-inc", "data-s") === "alert", T("header: incidents badge (email failures, Worker 5xx, relay drops)"));
  await page.click("#t-inc"); await page.waitForSelector("#drawer.on"); const idr = await page.innerText("#drawer");
  check(/2\s*Email failures/.test(idr) && /1\s*Worker 5xx errors/.test(idr) && /Relay disconnects/.test(idr), T("incidents drawer breaks the count down")); await page.keyboard.press("Escape");
  telBreaker = true; await page.click("#sync"); await page.waitForFunction(() => /BREAKER/.test(document.querySelector("#t-pause").textContent), null, {timeout: 8000}).catch(() => {});
  check(/BREAKER · \d+ MIN/.test(await page.innerText("#t-pause")) && !(await page.evaluate(() => HQ.blocked({t: "ship", n: 4}))), T("burn breaker shows in the header, and Tier 2 approvals keep working"));
  telBreaker = false; await page.click("#sync"); await page.waitForTimeout(800);
  await page.click('#dock [data-v="ship"]'); await page.waitForFunction(() => /Market scan/.test((document.querySelector("#c-agents") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  const ag = await page.innerText("#c-agents");
  check(/Market scan/.test(ag) && /\$0\.07/.test(ag) && /Paused/.test(ag) && /Worker \/ ship gate/.test(ag) && /Dev Lead/.test(ag) && /\$0\.42 API spend today/.test(ag),
        T("Agents & team: routines and contractors with status, last run and per-agent spend today"));
  const ag0 = cmds.length; await page.click('#c-agents [data-label="Pause Market scan"]'); await page.waitForTimeout(500);
  check(cmds[ag0] && cmds[ag0].t === "agent" && cmds[ag0].op === "pause" && cmds[ag0].id === "market" && UUIDRE.test(cmds[ag0].command_id), T("Agents & team: Pause/Resume is a Tier 2 command"));
  await page.click('#c-pipe [data-pi="app:3"]'); await page.waitForSelector("#drawer.on");
  const rb0 = cmds.length; check(/Rollback to previous/.test(await page.innerText("#drawer")), T("Pipeline: a change that went live in the last 24h offers Rollback to previous"));
  await page.click('#drawer [data-cmd*="rollback"]'); await page.waitForTimeout(500);
  check(cmds[rb0] && cmds[rb0].t === "rollback" && cmds[rb0].n === 3 && UUIDRE.test(cmds[rb0].command_id), T("Rollback is a Tier 2 command (Telegram approval)"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  // Open in HQ: the Telegram card links to #open=cmd:<id> (never the key)
  const last = await page.evaluate(() => HQ.S.out[0].id);
  await page.goto(BASE + "#open=cmd:" + last); await page.reload(); await page.waitForFunction(() => /command_id/.test((document.querySelector("#drawer.on") || {}).textContent || ""), null, {timeout: 9000}).catch(() => {});
  check((await page.innerText("#drawer")).includes(last) && !/open=/.test(page.url()), T("Open in HQ from a Telegram card opens that command's live drawer (and tidies the address) [" + page.url() + " | " + (await page.innerText("#drawer").catch(() => "")).slice(0, 80) + "]"));
  await page.keyboard.press("Escape");
  // offline queue: no signal -> the command waits on this device with its UUID, then goes out once, same id
  const oc0 = cmds.length; noSignal = true; await ctx.setOffline(true); await page.click('#dock [data-v="floor"]'); await page.waitForSelector("#macros .mac");
  await page.click('#macros [data-macro="0"]'); await page.waitForTimeout(600); await page.keyboard.press("Escape");
  const oq = await page.innerText("#offq").catch(() => ""), offl = await page.evaluate(() => JSON.parse(localStorage.getItem("hq-out") || "[]").filter(r => r.st === "offline"));
  check(/1 command waiting for signal/.test(oq) && offl.length === 1 && /^[0-9a-f-]{36}$/.test(offl[0].id) && offl[0].env, T("offline: the command waits in a localStorage queue with its UUID and sealed envelope"));
  noSignal = false; await ctx.setOffline(false); await page.waitForFunction(() => document.querySelector("#offq").hidden, null, {timeout: 12000}).catch(() => {});
  check(cmds.length === oc0 + 1 && cmds[oc0]._cid === offl[0].id && await page.isHidden("#offq"), T("back online: it sends by itself, once, with the same id"));
  await shot("16-overview");
  // layout: no sideways scroll, nothing under the notch or home bar
  const lay = await page.evaluate(() => ({w: document.documentElement.scrollWidth, vw: innerWidth, hud: document.querySelector("#hud").getBoundingClientRect().top, dock: innerHeight - document.querySelector("#dock").getBoundingClientRect().bottom,
    vf: /viewport-fit=cover/.test(document.querySelector('meta[name="viewport"]').content), css: [...document.styleSheets].flatMap(s => [...s.cssRules]).map(r => r.cssText).join("")}));
  check(lay.w <= lay.vw + 1, T("no sideways scroll (" + lay.w + " of " + lay.vw + ")")); check(lay.hud >= 8 && lay.dock >= 8, T("HUD and dock sit inside the screen"));
  check(lay.vf && /--st:\s*env\(safe-area-inset-top/.test(lay.css) && /--sb:\s*env\(safe-area-inset-bottom/.test(lay.css), T("viewport-fit=cover and top/bottom safe-area padding"));
  // over-budget pause and a stale relay
  telPaused = true; telAge = 300; await page.click('#dock [data-v="floor"]'); await page.click("#sync"); await page.waitForTimeout(1500);
  const tb2 = await page.innerText("#tbar");
  check(/PAUSED — CAP REACHED/.test(tb2) && await page.getAttribute("#t-pause", "data-s") === "alert", T("header bar: PAUSED — CAP REACHED in red when the cap is hit"));
  check(/RELAY STALE · 5 min/.test(tb2), T("header bar: relay STALE when the last heartbeat is over 2 minutes old"));
  if (!(await page.isVisible("#call .btn.warn"))) await page.click("#call [data-fold]");
  const appr = await page.$$eval("#call .btn.go", e => e.map(x => x.disabled)), hold = await page.$$eval("#call .btn.warn", e => e.map(x => x.disabled));
  const safe = await page.evaluate(() => [HQ.blocked({t: "hold", n: 1}), HQ.blocked({t: "focus", mode: "normal"}), HQ.blocked({t: "read", q: "spend"}), HQ.blocked({t: "text", text: "run dev lead now"}), HQ.blocked({t: "budget", op: "resume"}), HQ.blocked({t: "member", act: "reset", uid: "u1"})]);
  check(appr.length && appr.every(Boolean) && hold.every(x => !x) && JSON.stringify(safe) === "[false,false,false,true,false,true]", T("while paused, Tier 2 buttons are switched off in the UI (Hold, focus and reads stay on)"));
  const p0 = cmds.length; await page.evaluate(() => { const b = document.querySelector("#call .btn.go"); b.disabled = false; b.click(); }); await page.waitForTimeout(400);
  check(cmds.length === p0 && /Paused: today's spend cap/.test(await page.innerText("#toasts")), T("a paused Tier 2 command is refused before anything is sent"));
  await shot("8-paused");
  telPaused = false; telAge = 20; await page.click("#sync"); await page.waitForTimeout(1200);
  // 10. smart visibility sync
  await page.click('#dock [data-v="floor"]');
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "hidden"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(600); const r0 = reqs.length; await page.waitForTimeout(7000);
  check(reqs.length === r0, T("hidden tab: polling stops (" + (reqs.length - r0) + " requests in 7 s)"));
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, get: () => "visible"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(1200); check(reqs.length > r0, T("back in view: syncs immediately"));
  // the key never leaves the device; only allowed hosts; writes only to the mailbox
  check(!reqs.some(r => r.u.includes(KEY) || r.body.includes(KEY)), T("the HQ key is never sent anywhere"));
  check(reqs.every(r => /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|hybrid-api\.hybridapp\.workers\.dev)\//.test(r.u)), T("only Vesper's feeds, GitHub and the Mileset API are contacted"));
  check(reqs.filter(r => r.body).every(r => r.u.endsWith("/api/hq/box/" + BOX) && /^\{"d":"in","cid":"[0-9a-f-]{36}","iv":"[\w-]+","ct":"[\w-]+"\}$/.test(r.body)), T("the only writes are sealed envelopes to the HQ mailbox"));
  // fallback when the mailbox isn't deployed yet
  boxOn = false; await page.evaluate(() => { HQ.S.box.on = false; }); await page.click('#focus [data-m="' + (await page.getAttribute('#focus [data-m="normal"]', "aria-pressed") === "true" ? "class" : "normal") + '"]'); await page.waitForTimeout(400);
  check(/Paste it to Vesper in Telegram/.test(await page.innerText("#toasts")), T("before the mailbox is live, a command is copied for Telegram instead of lost"));
  check(cErr.length === 0, T("no console errors" + (cErr.length ? ": " + cErr.slice(0, 3).join(" | ") : "")));
  await ctx.close(); }

await run("phone", {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"}, true);
await run("desktop", {viewport: {width: 1440, height: 900}}, false);
// static: the page keeps the old key bootstrap and a strict content policy
const src = fs.readFileSync(here("../hq/index.html"), "utf8"), js = fs.readFileSync(here("../hq/core.js"), "utf8") + fs.readFileSync(here("../hq/ui.js"), "utf8");
check(/localStorage\.getItem\("hq-k"\)/.test(src) && /start_url: base \+ "#k=" \+ k/.test(src), "static: the home-screen key bootstrap is unchanged");
check(/http-equiv="Content-Security-Policy"/.test(src) && /form-action 'none'/.test(src) && /default-src 'none'/.test(src), "static: strict Content-Security-Policy");
check(!/\beval\s*\(|new Function\s*\(|document\.cookie|sendBeacon|api\.telegram\.org/.test(js), "static: no eval, cookies, beacons or Telegram calls");
await browser.close(); srv.close();
console.log(`hq floor: ${ok.length} checks pass` + (errs.length ? `, ${errs.length} FAILED` : ""));
if (errs.length) process.exit(1);
