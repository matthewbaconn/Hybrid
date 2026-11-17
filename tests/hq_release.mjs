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
const iso = m => new Date(Date.now() - m * 60000).toISOString().slice(0, 19) + 'Z';
const FIX = {v: 1, t: iso(1), o: {streak: [1, 7], working: [], attention: ['audit'], runs_today: 4, ok_today: 2, failed_today: 1, approvals: 1, plan_min_today: 30, spend: null},
  d: [{id: 'audit', s: 'f', last: iso(30), next: iso(-600), sum: 'TEST FIXTURE audit run', art: '', hist: [], jobs: [], runs: 1, min: 12, model: 'claude-opus-5-5', ok7: 0, fail7: 1}],
  f: [[iso(30), 'audit', 'failed', 'TEST FIXTURE failure'], [iso(90), 'worker', 'ok', 'TEST FIXTURE shipped a change']],
  a: [{k: 'pr', repo: 'Hybrid', n: 1, title: 'TEST FIXTURE approval', url: 'https://github.com/matthewbaconn/Hybrid/pull/1', why: 'needs your review'}],
  dec: [['Nov 16', 'TEST FIXTURE verified item', 'Implemented and verified', 'evidence']], done: [['Nov 16', 'TEST FIXTURE verified item', 'Implemented and verified', 'evidence']],
  jobs: [['0', 'PLAN OF RECORD (TEST)', '', ''], ['B1', 'TEST FIXTURE top job', 'product lead', 'building']],
  g: {asof: '2026-11-16', src7: {unknown: 2, ig: 1}, src_all: {unknown: 3, ig: 1}, funnel: {signed_up: 4, plan: 3, workout: 0, d7_eligible: 0, active_d7: 0}, members: [['2026-11-15', 3], ['2026-11-16', 4]]},
  me: null, money: null, fix: ''};
const PRIVJ = await enc(FIX, KEYB);
const feedAt = m => JSON.stringify({v: 1, t: iso(m), ok: true, sk: [1, 7], r: [['audit', 'f', iso(30), iso(-600), 1], ['worker', 'i', iso(90), iso(-30), 3]], tl: [[iso(90), 'worker', 'ok']]});
const b = await chromium.launch();
async function open(opts){
  const ctx = await b.newContext({viewport: {width: 390, height: 844}}), p = await ctx.newPage(), reqs = [], bad = [];
  p.on('pageerror', e => bad.push('script error: ' + e.message)); p.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) bad.push('CSP: ' + m.text()); });
  p.on('request', r => reqs.push(r));
  await p.route(/hq\.json/, r => opts.feed === null ? r.fulfill({status: 404, body: ''}) : r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: feedAt(opts.feed ?? 2)}));
  await p.route(/hq-full\.json/, r => r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: PRIVJ}));
  await p.route(/api\/founding/, r => r.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: '{"left":96,"max":100,"members":4}'}));
  if (opts.key) await p.addInitScript(k => localStorage.setItem('hq-k', k), KEY);
  await p.goto('file://' + here('../' + NEW)); await p.waitForTimeout(1500);
  return {ctx, p, reqs, bad};
}
{ // unlocked, fresh feed
  const {ctx, p, reqs, bad} = await open({key: true, feed: 2});
  errs.push(...bad.map(x => 'unlocked: ' + x));
  for (const r of reqs) { const u = new URL(r.url());
    if (u.protocol === 'file:') continue;
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
  if (/PLAN OF RECORD/.test((await p.textContent('#brief')) + (await p.textContent('#panels')))) errs.push('office: the plan-of-record header is not a backlog item to recommend');
  if (!/^Live/.test(await p.textContent('#fresh'))) errs.push('freshness: a 2-minute-old feed must read Live');
  await p.click('#nav [data-v="growth"]');
  if (!/aren't counted here yet/.test(await p.textContent('#growth'))) errs.push('growth: the funnel must say synced workouts are not counted yet');
  await p.click('#nav [data-v="team"]');
  if ((await p.locator('#roster .dept').count()) !== 4) errs.push('departments: 4 departments expected');
  if ((await p.locator('#roster .p').count()) !== 12) errs.push('departments: every employee (12) must appear exactly once');
  if (!(await p.locator('#rooms .room').count())) errs.push('departments: rooms being built must be listed');
  if (!/min of plan time/.test(await p.textContent('#roster')) || /productivity score|\bscore\b/i.test(await p.textContent('#roster'))) errs.push('departments: minutes are cost, never a score');
  await ctx.close();
}
for (const [m, want] of [[20, /^Delayed/], [90, /^Stale/], [null, /offline/i]]) { // freshness labels
  const {ctx, p, bad} = await open({key: false, feed: m}); errs.push(...bad.map(x => `feed ${m}: ` + x));
  const t = await p.textContent('#fresh'); if (!want.test(t)) errs.push(`freshness: a ${m === null ? 'missing' : m + '-minute-old'} feed must read ${want} (got "${t}")`);
  if (m === 90 && !/old/.test(await p.textContent('#panels [data-p="unknown"]'))) errs.push('freshness: an old feed must be listed under What we don\'t know');
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
await b.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`HQ release OK: ${copies.length} copies pass the HQ regression test; new HQ read-only (GET only, allowed hosts only, key never sent, CSP), 5 labelled panels, honest freshness, private stays private, rollback copy labelled`);
