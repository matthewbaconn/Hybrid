// HQ release checks (no network needed): node tests/hq_release.mjs
// 1) Every HQ copy (current /hq/, the new /hq/next/ and the rollback /hq/classic/) passes the full HQ regression
//    test (tests/hq.mjs): 5 rooms on phone and desktop, private rooms locked without the key, unlock link, refresh.
// 2) The new HQ is read-only by construction: only GET requests, only to Vesper's feeds and the public member count,
//    the key never leaves the device, no forms, no Telegram calls, and a Content-Security-Policy that blocks other hosts.
// 3) Every Executive Office line says where it comes from, freshness is labelled honestly, nothing private shows
//    without the key, and the rollback copy says it is the rollback.
// The private sample below is a TEST-ONLY fixture: it is encrypted here with a throwaway key and never published.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const here = p => fileURLToPath(new URL(p, import.meta.url));
const errs = [], NEW = 'hq/next/index.html';
const copies = ['hq/index.html', 'hq/next/index.html', 'hq/classic/index.html'].filter(p => fs.existsSync(here('../' + p)));
for (const p of copies) {   // one retry: hq.mjs has a few short fixed waits that can miss on a busy machine
  let out = null, last = '';
  for (let i = 0; i < 2 && out === null; i++) {
    try { out = execFileSync('node', [here('hq.mjs')], {env: {...process.env, HQ_PAGE: p}, encoding: 'utf8'}).trim(); }
    catch (e) { last = (e.stdout || '') + (e.stderr || ''); if (i === 0) console.log(`${p}: retrying once after: ${last.trim().split('\n')[0]}`); }
  }
  if (out === null) errs.push(`${p}: regression test failed twice\n${last}`); else console.log(out);
}
// ---- static security checks on the new HQ ----
const src = fs.readFileSync(here('../' + NEW), 'utf8');
const ALLOWED = ['api.github.com', 'raw.githubusercontent.com', 'hybrid-api.hybridapp.workers.dev'];
if (!/http-equiv="Content-Security-Policy"/.test(src)) errs.push('static: Content-Security-Policy meta tag missing');
const csp = (src.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const conn = (csp.match(/connect-src ([^;]+)/) || [])[1] || '';
if (conn.split(/\s+/).filter(h => h.startsWith('https://')).some(h => !ALLOWED.includes(h.slice(8)))) errs.push('static: connect-src allows a host outside Vesper\'s feeds: ' + conn);
if (!/form-action 'none'/.test(csp)) errs.push('static: CSP must forbid form submissions');
for (const [re, why] of [[/method\s*:\s*["'](POST|PUT|PATCH|DELETE)/i, 'a write request'], [/sendData|Telegram\.WebApp|api\.telegram\.org/, 'a Telegram call'],
                         [/<form\b/i, 'a form'], [/\beval\s*\(|new Function\s*\(/, 'eval'], [/navigator\.sendBeacon/, 'a beacon'], [/document\.cookie/, 'cookies']])
  if (re.test(src)) errs.push(`static: the new HQ contains ${why}`);
for (const h of (src.match(/https:\/\/[a-z0-9.-]+/g) || [])) if (!ALLOWED.includes(h.slice(8)) && !/^https:\/\/(app\.hybrdrunning\.com|github\.com)$/.test(h)) errs.push('static: unexpected host ' + h);
// ---- runtime checks on the new HQ ----
const enc = async (obj, key) => { const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('mileset-hq-v1')}, k, new TextEncoder().encode(JSON.stringify(obj))));
  const u = b => Buffer.from(b).toString('base64url'); return JSON.stringify({v: 1, alg: 'A256GCM', iv: u(iv), ct: u(ct)}); };
const KEYB = crypto.getRandomValues(new Uint8Array(32)), KEY = Buffer.from(KEYB).toString('base64url');
const T0 = Date.now(), iso = m => new Date(T0 - m * 60000).toISOString().slice(0, 19) + 'Z';   // fixed timestamps, like a real feed
const FIX = {v: 1, t: iso(1), o: {streak: [1, 7], working: [], attention: ['audit'], runs_today: 4, ok_today: 2, failed_today: 1, approvals: 1, plan_min_today: 30, spend: null},
  d: [{id: 'audit', s: 'f', last: iso(30), next: iso(-600), sum: 'TEST FIXTURE audit run', art: '', hist: [], jobs: [], runs: 1, min: 12, model: 'claude-opus-5-5', ok7: 0, fail7: 1}],
  f: [[iso(30), 'audit', 'failed', 'TEST FIXTURE failure'], [iso(90), 'worker', 'ok', 'TEST FIXTURE shipped a change']],
  a: [{k: 'pr', repo: 'Hybrid', n: 1, title: 'TEST FIXTURE approval', url: 'https://github.com/matthewbaconn/Hybrid/pull/1', why: 'SHIP IT'},
      {k: 'pr', repo: 'Hybrid', n: 2, title: 'TEST FIXTURE gate item', url: 'https://github.com/matthewbaconn/Hybrid/pull/2', why: 'needs your review'},
      {k: 'pr', repo: 'Hybrid', n: 3, title: 'TEST FIXTURE draft item', url: 'https://github.com/matthewbaconn/Hybrid/pull/3', why: 'draft, needs your review'}],
  dec: [['Nov 16', 'TEST FIXTURE verified item', 'Implemented and verified', 'evidence']], done: [['Nov 16', 'TEST FIXTURE verified item', 'Implemented and verified', 'evidence']],
  jobs: [['0', 'PLAN OF RECORD (TEST)', '', ''], ['B1', 'TEST FIXTURE top job', 'product lead', 'building']],
  g: {asof: '2026-11-16', src7: {unknown: 2, ig: 1}, src_all: {unknown: 3, ig: 1}, funnel: {signed_up: 4, plan: 3, workout: 0, d7_eligible: 0, active_d7: 0}, members: [['2026-11-15', 3], ['2026-11-16', 4]]},
  me: null, money: null, fix: '',
  x: {roles: {audit: {name: 'TEST audit schedule', cron: '43 2 * * *', model: 'claude-opus-5-5'}}, work7: {audit: {ok: 1, failed: 1, skipped: 0, min: 20}}, results_say: '', results_at: '',
    health: {at: '2026-11-16 23:00', status: 'TEST FIXTURE health line', services: 'bot=active', code: 'drift=in sync', server: '', connections: '', spend: '', errors_24h: 0},
    verify: [['V9', '2026-11-16', 'audit', 'TEST FIXTURE verified item', 'pass', '2026-11-17 audit: pass']], exps: [['E1', 'running', 'TEST experiment', '>=1 sign-up', 'Nov 30', 'running']],
    partners: [['P1', 'TEST partner', 'awaiting Matthew']], outreach: {total: 1, by_status: {held: 1}, sent_total: 0, paused: false, pause_reason: ''}, overnight: ['2026-11-16 · TEST overnight'], sevenday: null, merged: [], runs: []}};
// Upgrade order fixture (GitHub's public PR list): a feature, a newer bug fix (goes first), a held product PR, a draft, one merged.
const pr = (n, t, ref, o) => ({number: n, title: t, html_url: 'https://github.com/matthewbaconn/Hybrid/pull/' + n, head: {ref}, draft: false, state: 'open', created_at: iso(500 - n), merged_at: null, ...o});
const PULLS = JSON.stringify([pr(2, 'PUBLIC PR feature', 'claude/feature'), pr(4, 'Fix: PUBLIC PR bug', 'claude/fix'), pr(1, 'PUBLIC PR held', 'claude/product-x'),
  pr(3, 'PUBLIC PR draft', 'claude/draft', {draft: true}), pr(5, 'PUBLIC PR shipped', 'claude/done', {state: 'closed', merged_at: iso(20)})]);
const PRIVJ = await enc(FIX, KEYB), PRIVJ0 = await enc({...FIX, x: undefined}, KEYB);   // before and after Vesper's feed update
const feedAt = m => JSON.stringify({v: 1, t: iso(m), ok: true, sk: [1, 7], r: [['audit', 'f', iso(30), iso(-600), 1], ['worker', 'i', iso(90), iso(-30), 3]], tl: [[iso(90), 'worker', 'ok']]});
import http from 'node:http';
const ROOT = here('../'), TYPES = {html: 'text/html', json: 'application/json', png: 'image/png', webmanifest: 'application/manifest+json'};
const srv = http.createServer((q, r) => { const f = ROOT + decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/+/, '').replace(/\/$/, '/index.html');
  if (f.includes('..') || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': TYPES[f.split('.').pop()] || 'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const b = await chromium.launch();
async function open(opts){
  const ctx = await b.newContext({viewport: opts.vp || {width: 390, height: 844}}), p = await ctx.newPage(), reqs = [], bad = [];
  p.on('pageerror', e => bad.push('script error: ' + e.message)); p.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) bad.push('CSP: ' + m.text()); });
  p.on('request', r => reqs.push(r));
  await p.route(/hq\.json/, r => opts.feed === null ? r.fulfill({status: 404, body: ''}) : r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: feedAt(opts.feed ?? 2)}));
  await p.route(/hq-full\.json/, r => r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: opts.oldFeed ? PRIVJ0 : PRIVJ}));
  await p.route(/\/pulls\?/, r => r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: PULLS}));
  await p.route(/api\/founding/, r => r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: '{"left":96,"max":100,"members":4}'}));
  if (opts.key) await p.addInitScript(k => localStorage.setItem('hq-k', k), KEY);
  await p.goto(BASE + NEW); await p.waitForTimeout(1500);
  return {ctx, p, reqs, bad};
}
{ // unlocked, fresh feed
  const {ctx, p, reqs, bad} = await open({key: true, feed: 2});
  errs.push(...bad.map(x => 'unlocked: ' + x));
  for (const r of reqs) { const u = new URL(r.url());
    if (u.protocol === 'file:' || u.host === new URL(BASE).host) continue;   // the page's own files
    if (r.method() !== 'GET') errs.push(`network: ${r.method()} ${u.host} (only GET is allowed)`);
    if (!ALLOWED.includes(u.host)) errs.push('network: request to ' + u.host);
    if (r.url().includes(KEY) || JSON.stringify(r.headers()).includes(KEY)) errs.push('network: the HQ key left the device in a request'); }
  if ((await p.locator('#panels .xp').count()) !== 5) errs.push('office: the Executive Office must show 5 panels');
  for (const [i, t] of ['What happened', 'What was verified', "What we don't know yet", 'Needs your attention', 'Vesper recommends'].entries())
    if (!(await p.locator('#panels .xp h3').nth(i).textContent()).startsWith(t)) errs.push(`office: panel ${i + 1} must be "${t}"`);
  await p.evaluate(() => document.querySelectorAll('[data-pmore]').forEach(b => b.click())); await p.waitForTimeout(200);
  const untagged = await p.$$eval('#panels .ln:not(.w)', ls => ls.filter(l => !l.querySelector('.src') && !l.querySelector('.tag')).map(l => l.textContent.slice(0, 60)));
  if (untagged.length) errs.push('office: lines without a source label: ' + untagged.join(' | '));
  const ver = await p.textContent('#panels [data-p="verified"]');
  if (!/TEST FIXTURE verified item/.test(ver) || !/receipts/i.test(ver)) errs.push('office: verified panel must list ledger-verified items and say receipts are not available yet');
  if (/TEST FIXTURE shipped/.test(ver)) errs.push('office: a self-reported run must never appear as verified');
  const att = await p.textContent('#panels [data-p="attention"]');
  if (!/failed run/.test(att) || !/TEST FIXTURE approval/.test(att) || !/Telegram/.test(att)) errs.push('office: attention panel must show failed runs and waiting approvals (approved only in Telegram)');
  if (/TEST FIXTURE gate item|TEST FIXTURE draft item/.test(att)) errs.push('office: a PR the gate handles (or a draft) is not something Matthew must approve');
  { const ord = await p.$$eval('#order .item', xs => xs.map(x => x.textContent));
    const at = t => ord.findIndex(x => x.includes(t));
    if (!(at('Fix: PUBLIC PR bug') > 0 && at('Fix: PUBLIC PR bug') < at('PUBLIC PR feature'))) errs.push('order: bug fixes must come first in the upgrade order: ' + ord.join(' | '));
    if (!/SHIP IT 1/.test(ord[at('PUBLIC PR held')] || '')) errs.push('order: a held PR must say it waits for SHIP IT');
    if (!/Nothing for you to do/.test(ord[at('PUBLIC PR draft')] || '')) errs.push('order: a draft must say nothing is needed');
    if (!/live /.test(ord[at('PUBLIC PR shipped')] || '')) errs.push('order: a PR merged today must show as live'); }
  if (/PLAN OF RECORD/.test((await p.textContent('#brief')) + (await p.textContent('#panels')))) errs.push('office: the plan-of-record header is not a backlog item to recommend');
  if (!/^Live/.test(await p.textContent('#fresh'))) errs.push('freshness: a 2-minute-old feed must read Live');
  await p.click('#nav [data-v="growth"]');
  if (!/aren't counted here yet/.test(await p.textContent('#growth'))) errs.push('growth: the funnel must say synced workouts are not counted yet');
  // ---- release 2 views ----
  await p.click('#nav [data-v="team"]');
  if ((await p.locator('#roster .emp').count()) !== 12) errs.push('employees: every employee (12) must appear exactly once');
  if (/\bscore\b/i.test(await p.textContent('#roster'))) errs.push('employees: no scores, only verified results');
  await p.click('#roster [data-id="audit"]'); await p.waitForTimeout(200);
  const ws = await p.textContent('#panel');
  for (const w of ['Responsibilities', 'Latest report', 'Time and cost', 'independently verified', 'Current assignments', 'Activity history']) if (!ws.includes(w)) errs.push('workspace: missing ' + w);
  if (!/TEST FIXTURE verified item/.test(ws)) errs.push('workspace: the role\'s verified work must show');
  await p.click('#close');
  await p.click('#nav [data-v="depts"]');
  if ((await p.locator('#depts .dcard').count()) !== 9) errs.push('departments: 9 departments expected');
  if (!(await p.locator('#rooms .room').count())) errs.push('departments: rooms being built must be listed');
  await p.click('.dcard[data-d="security"]'); await p.waitForTimeout(150);
  if (!/Step 5/.test(await p.textContent('#depts'))) errs.push('security workspace: must state the Step 5 status');
  await p.click('#nav [data-v="approvals"]');
  const apv = await p.textContent('#approvals');
  if (!/What approving authorizes/.test(apv) || !/How to approve/.test(apv) || !/TEST FIXTURE approval/.test(apv)) errs.push('approvals: each approval must explain what it authorizes and how to approve');
  if (/TEST FIXTURE gate item|TEST FIXTURE draft item/.test(apv)) errs.push('approvals: PRs the gate merges by itself, and drafts, must not be listed as approvals');
  if (await p.locator('#approvals button').count()) errs.push('approvals: HQ must not have approve buttons');
  await p.click('#nav [data-v="ops"]');
  const ops = await p.textContent('#ops');
  for (const w of ['Active jobs', 'Scheduled work', 'System health', 'Completed in 24 h', 'Failed in 24 h', 'Reliability', 'Deployment history']) if (!ops.includes(w)) errs.push('operations: missing ' + w);
  if (!/TEST FIXTURE health line/.test(ops)) errs.push('operations: Vesper\'s health report must show when the feed has it');
  await p.click('#nav [data-v="growth"]');
  if (!/aren't counted here yet/.test(await p.textContent('#growth'))) errs.push('growth: the funnel must say synced workouts are not counted yet');
  const g2 = await p.textContent('#growth2'); for (const w of ['Customer funnel', 'Partnerships', 'Ambassadors', 'Campaigns and experiments']) if (!g2.includes(w)) errs.push('growth: missing ' + w);
  if (/someone-private/.test(g2)) errs.push('growth: ambassador names must never reach HQ');
  await p.click('#nav [data-v="money"]');
  if (!/Infrastructure costs/.test(await p.textContent('#money2'))) errs.push('finance: infrastructure costs must be listed (as not tracked)');
  // command bar answers from the data and hands the question to Vesper
  await p.keyboard.press('Control+k'); await p.fill('#cmdIn', 'What needs my approval?'); await p.press('#cmdIn', 'Enter');
  const an = await p.textContent('#cmdOut'); if (!/TEST FIXTURE approval/.test(an) || !/ask Vesper in Telegram/i.test(an)) errs.push('command: approval question must list approvals and offer Vesper');
  await p.fill('#cmdIn', 'How many actual active customers do we have?'); await p.press('#cmdIn', 'Enter');
  if (!/Strava or Garmin/.test(await p.textContent('#cmdOut'))) errs.push('command: active-customer answer must say synced workouts are unknown');
  await p.keyboard.press('Escape');
  // alerts: unseen count, mark all seen sticks on this device
  const bn = +(await p.textContent('#belln') || 0); if (bn < 2) errs.push('alerts: the failed run and the approval must raise alerts');
  await p.click('#bell'); await p.click('#seenAll'); await p.waitForTimeout(100);
  if ((await p.textContent('#belln')) !== '0') errs.push('alerts: mark all seen must clear the count');
  // the last view is remembered on this device
  await p.click('#nav [data-v="ops"]'); await p.waitForTimeout(1000);   // let the browser save this device's settings before reloading
  await p.reload(); await p.waitForTimeout(1300);
  if (!(await p.isVisible('#v-ops'))) errs.push('views: HQ must reopen on the last view on this device');
  let bl = ''; for (let i = 0; i < 20 && bl !== '0'; i++) { await p.waitForTimeout(150); bl = await p.textContent('#belln'); }   // feeds load in any order
  if (bl !== '0') errs.push('alerts: seen alerts must stay seen after a reload (unseen: ' + (await p.$$eval('#alerts .al.new b', x => x.map(e => e.textContent).join(' | '))) + ')');
  await ctx.close();
}
for (const [m, want] of [[20, /^Delayed/], [90, /^Stale/], [null, /offline/i]]) { // freshness labels
  const {ctx, p, bad} = await open({key: false, feed: m}); errs.push(...bad.map(x => `feed ${m}: ` + x));
  const t = await p.textContent('#fresh'); if (!want.test(t)) errs.push(`freshness: a ${m === null ? 'missing' : m + '-minute-old'} feed must read ${want} (got "${t}")`);
  if (m === 90 && !/old/.test(await p.textContent('#panels [data-p="unknown"]'))) errs.push('freshness: an old feed must be listed under What we don\'t know');
  await ctx.close(); }
{ // today's feed (before Vesper's feed update is installed): every new room still works and says what's missing
  const {ctx, p, bad} = await open({key: true, feed: 2, oldFeed: true}); errs.push(...bad.map(x => 'old feed: ' + x));
  await p.click('#nav [data-v="ops"]'); if (!/feed update/.test(await p.textContent('#ops'))) errs.push('old feed: operations must say what arrives with the feed update');
  await p.click('#nav [data-v="growth"]'); if (!/feed update/.test(await p.textContent('#growth2'))) errs.push('old feed: growth must say what arrives with the feed update');
  await ctx.close(); }
for (const vp of [{width: 390, height: 844}, {width: 820, height: 1180}, {width: 1366, height: 768}, {width: 1920, height: 1080}]) {   // no sideways scrolling anywhere
  const {ctx, p, bad} = await open({key: true, feed: 2, vp}); errs.push(...bad.map(x => `${vp.width}px: ` + x));
  for (const v of ['hq', 'approvals', 'ops', 'team', 'depts', 'growth', 'money', 'me']) { await p.click(`#nav [data-v="${v}"]`); await p.waitForTimeout(120);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (over > 1) errs.push(`${vp.width}px ${v}: scrolls sideways by ${over}px`); }
  await ctx.close(); }
{ // locked: no private words anywhere
  const {ctx, p} = await open({key: false, feed: 2}); const body = await p.textContent('body');
  if (/TEST FIXTURE/.test(body)) errs.push('locked: private office text visible without the key');
  if (!/Private\. Unlock HQ/.test(await p.textContent('#panels'))) errs.push('locked: private panels must say they are private');
  await ctx.close(); }
{ // the rollback copy says it is the rollback; the current HQ doesn't
  const p = await b.newPage();
  if (fs.existsSync(here('../hq/classic/index.html'))) { await p.goto('file://' + here('../hq/classic/index.html') + '?demo'); if (!(await p.isVisible('#classicNote'))) errs.push('classic: the rollback copy must say it is the rollback'); }
  await p.goto('file://' + here('../hq/index.html') + '?demo'); if (await p.isVisible('#classicNote').catch(() => false)) errs.push('classic note must not show on /hq/');
  await p.close(); }
await b.close(); srv.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`HQ release OK (release 2 views: employees, workspaces, 9 departments, approvals, operations, growth, finance, command bar, alerts, remembered view); ${copies.length} copies pass the HQ regression test; new HQ read-only (GET only, allowed hosts only, key never sent, CSP), 5 labelled panels, honest freshness, private stays private, rollback copy labelled`);
