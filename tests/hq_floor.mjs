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
  const ctx = await browser.newContext(ctxOpt), page = await ctx.newPage(), reqs = [], cmds = [], box = [], seenCid = new Map(), pend = []; let boxOn = true, cErr = [], telAge = 20, telPaused = false, dropNext = "";
  // a stand-in for Vesper's server: Tier 1 reads answer at once; anything else waits for a (simulated) Telegram Approve
  const say = (c, st, extra) => { const seq = (c._seq = (c._seq || 0) + 1); box.push({id: box.length + 1, d: "out", cid: c.command_id + ":" + seq, ...seal({command_id: c.command_id, status: st, ...extra}, "mileset-hq-ack-v1")}); };
  const t1 = c => c.t === "read" || c.t === "defer" || (c.t === "text" && /^(status|spend|health|queue)$/i.test(c.text || ""));
  const vesper = c => { if (t1(c)){ say(c, "running"); say(c, "completed", {ok: true, say: "read " + (c.q || c.t), result: c.t === "defer" ? null : {title: "Spend", lines: ["Today: $0.67 of the $5.00 daily cap ($4.33 left).", "Over-budget pause: armed"]}}); return; }
    say(c, "awaiting_telegram_approval", {say: "Waiting for your Approve in Telegram.", cost: c.t === "text" ? 0.15 : 0, tier: 2});
    const tap = () => { if (/reject/.test(c.text || "")) return say(c, "rejected", {say: "Rejected in Telegram. Nothing ran."}); say(c, "running", {say: "Approved in Telegram."});
      say(c, "completed", {ok: true, say: c.t === "text" ? "TEST reply: all steady, Sir." : "Done."}); };
    if (/sign-ups|reject/.test(c.text || "")) pend.push(tap); else setTimeout(tap, 1500); };   // these two wait until the test taps Approve/Reject
  const telegram = () => pend.splice(0).forEach(f => f());
  const tel = () => ({at: Math.round(Date.now() / 1000) - telAge, spend: {today: telPaused ? 0.86 : 0.67, cap: 5, limit: 0.86, left: telPaused ? 0 : 0.19, pct: telPaused ? 17 : 13, paused: telPaused, reason: telPaused ? "cap reached" : "", month: 8.27, month_cap: 17},
    gate: {next_n: 4, next_title: "Fix: TEST bug fix", queue: 2, next_run: new Date(Date.now() + 37 * 60000).toISOString()}, relay: {mode: "normal"}});
  page.on("console", m => { if (m.type() === "error" && !/favicon|404|ERR_FAILED/.test(m.text())) cErr.push(m.text()); }); page.on("pageerror", e => cErr.push(String(e)));
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
        if (dropNext && c.t === dropNext){ dropNext = ""; return route.abort(); }                       // a network failure on the first try
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
  // 2. unlock with the private link
  await page.goto(BASE + "#k=" + KEY); await page.reload(); await page.waitForFunction(() => /\$0\.67/.test(document.querySelector("#t-amt").textContent), null, {timeout: 8000});
  const url = page.url(); check(phone ? /#k=/.test(url) : !/k=/.test(url), T(phone ? "iPhone Safari keeps the key in the address for Add to Home Screen (unchanged)" : "the key is wiped from the address after unlocking (unchanged)"));
  check((await page.evaluate(() => localStorage.getItem("hq-k"))) === KEY, T("the key is kept on this device only (localStorage hq-k, unchanged)"));
  await page.waitForFunction(() => /RELAY ONLINE/.test(document.querySelector("#t-relay").textContent), null, {timeout: 12000}).catch(() => {});
  const tb = await page.innerText("#tbar");
  check(/\$0\.67 \/ \$5\.00/.test(tb) && /\$0\.19 left today/.test(tb) && await page.evaluate(() => document.querySelector("#t-spend .meter u").style.width) === "13%", T("header bar: $0.67 / $5.00, percentage bar, headroom ($0.19 left today, under the monthly limit)"));
  check(/PAUSE ARMED/.test(tb) && await page.getAttribute("#t-pause", "data-s") === "ok", T("header bar: over-budget pause shows ARMED"));
  check(/RELAY ONLINE · \d+s/.test(tb), T("header bar: relay ONLINE with a relative time (" + (tb.match(/RELAY[^\n]*/) || [""])[0] + ")"));
  check(/NEXT #4 · \d/.test(tb), T("header bar: next queued change and the next hourly run"));
  check(/2 quiet failures today/.test(await page.innerText("#p-quiet")), T("HUD quiet-failure badge"));
  check(/All systems go/.test(await page.innerText("#p-health")) && /Vesper/.test(await page.innerText("#p-vesper")), T("HUD health and Vesper status"));
  await page.waitForFunction(() => /Synced/.test(document.querySelector("#sync").textContent), null, {timeout: 5000}).catch(() => {});
  check(/Synced \d+s ago/.test(await page.innerText("#sync")), T("live 'Synced Xs ago' pulse"));
  const bub = await page.innerText('.stn[data-id="dev"] .bub'); check(/fixing the reminder ask/.test(bub) && !/tools\/x\.py|Hybrid #120/.test(bub) && /app change #120/.test(bub), T("activity bubble is plain words (no file names or repo slugs): " + bub));
  check(await page.locator('#b-dev:not([hidden])').count() === 1, T("an energy beam runs to the working station"));
  check(await page.locator('.stn[data-id="qa"][data-s="waiting"]').count() === 1 && await page.locator('.stn[data-id="stark"][data-s="idle"]').count() === 1 && await page.locator('.stn[data-id="personal"][data-s="ok"]').count() === 1, T("status halos: waiting on approval, idle, on track"));
  if (phone) await page.click("#call [data-fold]").catch(() => {});
  const call = await page.innerText("#call"); check(/Needs your call · 2/i.test(call) && /TEST held change/.test(call) && /Approve/.test(call) && /Hold/.test(call) && /Defer/.test(call) && !/dock key/.test(call), T("Needs Your Call banner with Approve / Hold / Defer; a change held by you is not nagged"));
  if (phone) await page.click("#recap [data-fold]").catch(() => {});
  check(await page.locator("#recap li").count() === 3, T("recap card has 3 plain bullets")); await shot("2-floor");
  if (phone){ await page.click("#recap [data-fold]"); await page.click("#call [data-fold]"); }
  await page.waitForTimeout(900); await shot("2b-floor-clear");
  // 3. station inspector
  await page.evaluate(() => document.querySelector('.stn[data-id="dev"]').click()); await page.waitForSelector("#drawer.on"); await page.waitForTimeout(700);
  const dr = await page.innerText("#drawer"); check(/Current task/i.test(dr) && /Recently finished/i.test(dr) && /Reliability and speed/i.test(dr) && /90%/.test(dr) && /Activity/i.test(dr) && /Technical log/.test(dr), T("station inspector: task, progress, recent work, reliability, activity, raw log on demand"));
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
  const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check(cmds.length === n0 + 1 && cmds[n0].t === "ship" && cmds[n0].n === 1 && UUIDRE.test(cmds[n0].command_id) && cmds[n0]._cid === cmds[n0].command_id && Math.abs(cmds[n0].ts - Date.now()) < 60000,
        T("Approve sends a sealed 'ship #1' command with a UUID command_id (also the mailbox cid) and a timestamp"));
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
  check(/Pull requests and code changes/.test(ship) && /Plain summary of change 2/.test(ship) && /Vesper #77/.test(ship), T("PR cards with plain summaries, incl. Vesper upgrades"));
  await page.waitForFunction(() => /Checks passing/.test(document.querySelector("#views").textContent), null, {timeout: 6000}).catch(() => {}); check(/Checks passing/.test(await page.innerText("#views")), T("PR check status shows"));
  await page.click('.row[data-pr="2"]'); await page.waitForSelector("#drawer.on"); check(/Checks/i.test(await page.innerText("#drawer")) && /Open on GitHub/.test(await page.innerText("#drawer")), T("PR click-to-inspect drawer")); await shot("5-ship"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  // 8. company
  await page.click('#dock [data-v="company"]'); await page.waitForSelector("#c-spend"); const co = await page.innerText("#views");
  check(/\$0\.67/.test(co) && /of \$5\.00 today/.test(co) && /real limit is \$0\.86/.test(co) && /Where it went/i.test(co) && /Everyday model/.test(co) && /going over budget/i.test(co), T("spend tracker: today vs $5 cap, monthly limit, breakdown, over-budget trigger"));
  check(/17 members/.test(co) && /83 Founding spots left/.test(co) && /Built a plan/.test(co) && /76%/.test(co) && /All sending/.test(co) && /Nightly full phone test/.test(co) && /Fix in progress/.test(co), T("members and app health: live count, funnel, member emails, phone tests, open incident"));
  check(/Instagram followers/.test(co) && /Ready to connect: Meta Ads/.test(co) && /Ready to connect: the scheduled post queue/.test(co), T("social and ads: real counts where they exist, clean 'Ready to connect' where the feed isn't wired"));
  check(/Ready · 1/i.test(co) && /Exploring · 1/i.test(co) && /In progress · 0/i.test(co), T("ideas board columns"));
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
  const safe = await page.evaluate(() => [HQ.blocked({t: "hold", n: 1}), HQ.blocked({t: "focus", mode: "normal"}), HQ.blocked({t: "read", q: "spend"}), HQ.blocked({t: "text", text: "run dev lead now"})]);
  check(appr.length && appr.every(Boolean) && hold.every(x => !x) && JSON.stringify(safe) === "[false,false,false,true]", T("while paused, Tier 2 buttons are switched off in the UI (Hold, focus and reads stay on)"));
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
