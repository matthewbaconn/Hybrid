"use strict";
/* Mileset HQ command floor: data, sync and commands (ui.js draws it).
   Reads: Vesper's public snapshot and encrypted office (vesper/hq-data branch), GitHub's public PR list and
   check runs for this repo, the live member count, and on this device only the owner's own Mileset account.
   Writes: only encrypted envelopes to the HQ mailbox (/api/hq/box). They are sealed on this device with the HQ key
   (AES-256-GCM); the key itself is never sent anywhere. Until the mailbox is live, commands are copied for Telegram. */
const HQ = (() => {
const API = "https://hybrid-api.hybridapp.workers.dev", GH = "https://api.github.com/repos/matthewbaconn/Hybrid";
const RAW = "https://raw.githubusercontent.com/matthewbaconn/Hybrid/vesper/hq-data/";
const CAP = 5;                                             // Matthew's daily cap (Nov 20); the feed's own figure wins when present
const S = {pub: null, priv: null, privErr: "", order: null, orderAt: 0, checks: {}, runs: null, live: null, me: null, meErr: "",
           box: {on: null, since: 0, tried: 0}, out: [], opt: {}, at: 0, busy: false, seen: ""};
const subs = [];
const emit = () => { for (const f of subs) try { f(); } catch(e){ console.error(e); } };
const ls = { get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
             set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} } };
S.out = ls.get("hq-out", []).filter(r => Date.now() - r.at < 3 * 864e5).slice(0, 40);
S.opt = ls.get("hq-opt", {});
{ const c = ls.get("hq-order2", null); if (c && Array.isArray(c.list)){ S.order = c.list; S.orderAt = c.at; } }

// ---------- the private key: same flow as before (Vesper's private link carries #k=...; kept on this device only) ----------
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const IOS_BROWSER = !standalone && /iphone|ipad|ipod/i.test(navigator.userAgent);
function takeKey(){ const m = location.hash.match(/k=([A-Za-z0-9_-]{40,})/); if (!m) return false;
  try { localStorage.setItem("hq-k", m[1]); } catch(e){}
  // In iPhone Safari the key stays in the address so "Add to Home Screen" installs an app that opens unlocked
  // (older iPhones install the page address, not the manifest). Everywhere else it is wiped from the address.
  if (!IOS_BROWSER) try { history.replaceState(null, "", location.pathname + location.search); } catch(e){} return true; }
takeKey();
const keyStr = () => { try { return localStorage.getItem("hq-k"); } catch(e){ return null; } };
if (IOS_BROWSER){ const k = keyStr(); if (k && !/k=/.test(location.hash)) try { history.replaceState(null, "", location.pathname + location.search + "#k=" + k); } catch(e){} }
addEventListener("hashchange", () => { if (takeKey()){ ck = null; syncNow(true); } });

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64u = buf => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const enc = new TextEncoder(), dec = new TextDecoder();
let ck = null;
async function keys(){ const k = keyStr(); if (!k || !crypto.subtle) return null;
  if (ck && ck.k === k) return ck;
  const key = await crypto.subtle.importKey("raw", b64(k), "AES-GCM", false, ["encrypt", "decrypt"]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("mileset-hq-box-v1:" + k)));
  return ck = {k, key, box: [...h].map(b => b.toString(16).padStart(2, "0")).join("")}; }
async function unseal(blob, aad){ const K = await keys();
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(blob.iv), additionalData: enc.encode(aad)}, K.key, b64(blob.ct)))); }
async function seal(obj, aad){ const K = await keys(), iv = crypto.getRandomValues(new Uint8Array(12));
  return {iv: b64u(iv), ct: b64u(await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: enc.encode(aad)}, K.key, enc.encode(JSON.stringify(obj))))}; }

// ---------- reading ----------
async function get(url, opt){ const r = await fetch(url, {cache: "no-store", ...opt}); if (!r.ok) throw Object.assign(new Error("http " + r.status), {status: r.status}); return r.json(); }
const bucket = s => Math.floor(Date.now() / (s * 1000));
const rawGH = {headers: {Accept: "application/vnd.github.raw+json"}};
async function loadPub(fresh){
  try { S.pub = fresh ? await get(GH + "/contents/hq.json?ref=vesper/hq-data", rawGH).catch(() => get(RAW + "hq.json?t=" + bucket(30))) : await get(RAW + "hq.json?t=" + bucket(60)); S.pubErr = ""; }
  catch(e){ S.pubErr = "Vesper's snapshot isn't reachable right now."; } }
async function loadPriv(fresh){
  if (!(await keys())){ S.privErr = keyStr() ? "This browser can't unlock the office." : "locked"; return; }
  try { const blob = fresh ? await get(GH + "/contents/hq-full.json?ref=vesper/hq-data", rawGH).catch(() => get(RAW + "hq-full.json?t=" + bucket(30))) : await get(RAW + "hq-full.json?t=" + bucket(60));
    const p = await unseal(blob, "mileset-hq-v1"); if (!S.priv || String(p.t) >= String(S.priv.t)){ S.priv = p; } S.privErr = ""; }
  catch(e){ S.privErr = e.status === 404 ? "Vesper hasn't published the private office yet." : e.status ? "The private office isn't reachable right now." : "This device's key is out of date. Ask Vesper for a new HQ link."; } }
async function loadOrder(){
  try { const L = await get(GH + "/pulls?state=all&sort=updated&direction=desc&per_page=40");
    S.order = L.map(p => ({n: p.number, t: p.title, url: p.html_url, ref: (p.head && p.head.ref) || "", sha: (p.head && p.head.sha) || "", draft: !!p.draft, open: p.state === "open", c: p.created_at, m: p.merged_at, b: String(p.body || "").slice(0, 700)}));
    S.orderAt = Date.now(); S.orderErr = false; ls.set("hq-order2", {at: S.orderAt, list: S.order}); }
  catch(e){ S.orderErr = true; } }
async function loadRuns(){ try { const j = await get(GH + "/actions/runs?branch=main&per_page=30");
    S.runs = (j.workflow_runs || []).map(w => ({name: w.name, st: w.conclusion || w.status, at: w.updated_at || w.created_at, url: w.html_url, title: w.display_title || ""})); } catch(e){} }
async function loadChecks(pr){ if (!pr || !pr.sha) return null; const c = S.checks[pr.sha]; if (c && Date.now() - c.at < 10 * 60e3) return c;
  try { const j = await get(GH + "/commits/" + pr.sha + "/check-runs"); const runs = (j.check_runs || []).map(r => ({name: r.name, st: r.status === "completed" ? r.conclusion : "running"}));
    S.checks[pr.sha] = {at: Date.now(), runs, ok: runs.length ? runs.every(r => ["success", "neutral", "skipped"].includes(r.st)) : null, bad: runs.some(r => ["failure", "timed_out", "cancelled"].includes(r.st))}; emit(); }
  catch(e){} return S.checks[pr.sha] || null; }
async function loadLive(){ try { S.live = await get(API + "/api/founding"); S.liveAt = Date.now(); } catch(e){} }
// The owner's own Mileset account, read on this device only (same browser sign-in as the app). Never sent to Vesper.
async function loadMe(){ let t = null; try { t = localStorage.getItem("hp-token"); } catch(e){}
  if (!t){ S.me = null; S.meErr = "signin"; return; }
  try { S.me = await get(API + "/api/me", {headers: {Authorization: "Bearer " + t}}); S.meErr = ""; } catch(e){ S.meErr = e.status === 401 ? "signin" : "offline"; } }

// ---------- the mailbox: encrypted envelopes both ways ----------
async function boxPoll(){
  if (S.box.on === false && Date.now() - S.box.tried < 10 * 60e3) return;
  const K = await keys(); if (!K) return;
  try { const j = await get(API + "/api/hq/box/" + K.box + "?since=" + S.box.since); S.box.on = true;
    for (const row of j.rows || []){ S.box.since = Math.max(S.box.since, row.id || 0);
      try { if (row.d === "state"){ const p = await unseal(row, "mileset-hq-v1"); if (!S.priv || String(p.t) >= String(S.priv.t)){ S.priv = p; S.privErr = ""; S.privLive = Date.now(); } }
            else if (row.d === "out") gotAck(await unseal(row, "mileset-hq-ack-v1")); } catch(e){} } }
  catch(e){ if (e.status === 404 || e.status === 405){ S.box.on = false; S.box.tried = Date.now(); } }
  for (const r of S.out) if (r.st === "queued") post(r);
}
function gotAck(a){ const r = S.out.find(x => x.id === a.id); if (!r || r.st === "done" || r.st === "failed") return;
  r.st = a.ok === false ? "failed" : "done"; r.say = String(a.say || ""); r.ackAt = Date.now(); ls.set("hq-out", S.out);
  if (a.confirm) r.confirm = true;
  toast((a.ok === false ? "Vesper couldn't do that: " : "Vesper: ") + (r.say || "done."), a.ok === false ? "warn" : "ok"); }
const phrase = c => c.t === "ship" ? "SHIP IT " + c.n : c.t === "hold" ? "hold " + c.n : c.t === "unhold" ? "release hold " + c.n : c.t === "install" ? "install " + c.n
  : c.t === "greenlight" ? "greenlight " + c.n : c.t === "focus" ? ({normal: "resume", class: "ghost protocol 3 hours", paused: "pause"})[c.mode] : c.t === "defer" ? "remind me tomorrow: " + c.title : String(c.text || "");
async function post(rec){
  const K = await keys(); if (!K){ rec.st = "locked"; return; }
  if (S.box.on === false){ rec.st = "manual"; copy(phrase(rec.cmd)); return; }
  try { const env = await seal(rec.cmd, "mileset-hq-cmd-v1");
    const r = await fetch(API + "/api/hq/box/" + K.box, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({d: "in", ...env})});
    if (r.status === 404 || r.status === 405){ S.box.on = false; S.box.tried = Date.now(); rec.st = "manual"; copy(phrase(rec.cmd)); }
    else if (!r.ok) throw new Error("http " + r.status); else { rec.st = "sent"; S.box.on = true; fastUntil = Date.now() + 90e3; } }
  catch(e){ rec.st = "queued"; } }
/** Send Vesper a command. The screen updates at once (optimistic); Vesper's confirmation follows. */
async function send(cmd, label){
  const rec = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), at: Date.now(), label: label || phrase(cmd), st: "sending"};
  rec.cmd = {id: rec.id, ts: rec.at, ...cmd}; S.out.unshift(rec); S.out = S.out.slice(0, 40);
  if (cmd.t === "focus") opt("mode", cmd.mode); if (cmd.t === "ship") opt("ship:" + cmd.n, 1); if (cmd.t === "hold") opt("hold:" + cmd.n, 1); if (cmd.t === "unhold") opt("hold:" + cmd.n, 0);
  if (cmd.t === "defer") opt("defer:" + cmd.key, Date.now() + 864e5); if (cmd.t === "greenlight") opt("green:" + cmd.n, 1);
  emit(); await post(rec); ls.set("hq-out", S.out); emit();
  if (rec.st === "manual") toast("Copied \"" + phrase(rec.cmd) + "\". Paste it to Vesper in Telegram: HQ's command link isn't switched on yet.", "warn");
  else if (rec.st === "queued") toast("You're offline. I'll send it the moment you're back.", "warn");
  else if (rec.st === "locked") toast("Open HQ from Vesper's private link first.", "warn");
  tick(); return rec; }
function opt(k, v){ S.opt[k] = {v, at: Date.now()}; ls.set("hq-opt", S.opt); }
const optv = k => { const o = S.opt[k]; return o && Date.now() - o.at < 30 * 60e3 ? o.v : undefined; };
function copy(t){ try { navigator.clipboard.writeText(t).catch(() => {}); } catch(e){} }
let toastFn = () => {}; const toast = (t, kind) => toastFn(t, kind);

// ---------- sync engine: fast while you're looking, silent when you're not ----------
const due = {}, every = (k, ms) => { if (Date.now() - (due[k] || 0) >= ms){ due[k] = Date.now(); return true; } return false; };
let timer = null, fastUntil = 0;
async function tick(force){
  if (document.visibilityState !== "visible" && !force) return;
  if (S.busy) return; S.busy = true; emit();
  const jobs = [];
  if (force || every("box", Date.now() < fastUntil ? 3e3 : 10e3)) jobs.push(boxPoll());
  if (force || every("live", 15e3)) jobs.push(loadLive());
  if (force || every("pub", 60e3)) jobs.push(loadPub(force === "user"));
  if (force || every("priv", S.privLive && Date.now() - S.privLive < 3 * 60e3 ? 5 * 60e3 : 60e3)) jobs.push(loadPriv(force === "user"));
  if (force === "user" || every("order", 5 * 60e3)) jobs.push(loadOrder());
  if (force === "user" || every("runs", 10 * 60e3)) jobs.push(loadRuns());
  if (force || every("me", 5 * 60e3)) jobs.push(loadMe());
  await Promise.allSettled(jobs);
  if (jobs.length && (S.pub || S.priv || S.live)) S.at = Date.now();
  S.busy = false; emit(); }
function start(){ stop(); timer = setInterval(tick, 3000); }
function stop(){ if (timer){ clearInterval(timer); timer = null; } }
function syncNow(user){ for (const k in due) if (user || k === "box" || k === "live" || k === "pub" || k === "priv") due[k] = 0; start(); return tick(user ? "user" : true); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); else stop(); });
addEventListener("focus", () => { if (!timer) syncNow(); }); addEventListener("pageshow", e => { if (e.persisted) syncNow(); }); addEventListener("online", () => syncNow());
addEventListener("pagehide", stop);

// ---------- plain words ----------
const ROLE = {"ceo-shift": "CEO Shift", "dev-lead": "Dev Lead", "growth-sprint": "Growth Sprint", "product-lead": "Product Lead", instagram: "Social", audit: "Nightly audit",
  worker: "Ship gate", graphics: "Sunday Graphics", "friday-review": "Friday review", scorecard: "Scorecard", "monday-email": "Monday member email", drill: "Recovery drill"};
function plain(s){ let t = String(s || "");
  for (const k in ROLE) t = t.replace(new RegExp("\\b" + k + "\\b", "g"), ROLE[k]);
  return t.replace(/\b(?:https?:\/\/)\S+/g, "").replace(/\b[\w.-]+\/[\w./-]+\.(?:json|md|py|js|mjs|yml|html|jsonl|csv)\b/g, "").replace(/\b[\w-]+\.(?:json|md|py|mjs|yml|jsonl)\b/g, "")
    .replace(/\b(?:claude|upgrade|vesper|fix)\/[\w./-]+/g, "").replace(/\b[0-9a-f]{7,40}\b/g, "").replace(/\bvesper-relay #(\d+)/gi, "Vesper upgrade #$1").replace(/\b(?:Hybrid|PR) ?#(\d+)/g, "app change #$1")
    .replace(/\be2e\b/gi, "phone test").replace(/\bselftest\b/gi, "self-check").replace(/\bCI\b/g, "automatic checks").replace(/\bmay-run\b/g, "start check").replace(/\brunlog\b/gi, "run log")
    .replace(/\bPRs?\b/g, m => m === "PRs" ? "changes" : "change").replace(/\bmerged\b/gi, "shipped").replace(/\(\s*\)/g, "").replace(/\s+([,.;:])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/^[\s,;:·-]+|[\s,;:·-]+$/g, ""); }
function ago(t){ const ms = Date.now() - (typeof t === "number" ? t : Date.parse(t)); if (!isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : s < 172800 ? "yesterday" : Math.round(s / 86400) + " days ago"; }
function when(t){ const d = new Date(t); if (isNaN(d)) return ""; const now = new Date(), day = d.toDateString() === now.toDateString() ? "" : d.toDateString() === new Date(Date.now() + 864e5).toDateString() ? "tomorrow " : d.toLocaleDateString([], {weekday: "short"}) + " ";
  return day + d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}).toLowerCase().replace(" ", ""); }
const money = n => "$" + (Math.round((+n || 0) * 100) / 100).toFixed(2);

// ---------- the model the screen draws ----------
const isHeld = p => !/^claude\//.test(p.ref) || /^\s*NEEDS MATTHEW/i.test(p.b || "");   // the ship gate takes every claude/ change except ones marked for his OK
const isFix = p => /^fix\b/i.test(p.t);
function model(){
  const P = S.priv || {}, pub = S.pub || {}, h2 = P.hq2 || {}, o = P.o || {}, x = P.x || {};
  const desks = {}; for (const d of P.d || []) desks[d.id] = d;
  for (const r of pub.r || []) if (!desks[r[0]]) desks[r[0]] = {id: r[0], s: r[1], last: r[2], next: r[3], runs: r[4], sum: "", pubOnly: true};
  const mode = optv("mode") || h2.mode || "normal";
  // pull requests and the ship gate's order
  const L = S.order || [], open = L.filter(p => p.open), mine = new Set((h2.holds || []).map(Number));
  const heldByYou = p => optv("hold:" + p.n) === 1 || (mine.has(p.n) && optv("hold:" + p.n) !== 0);
  const approved = p => optv("ship:" + p.n) === 1 || (h2.approved || []).map(Number).includes(p.n);
  const queue = open.filter(p => !p.draft && !heldByYou(p) && (!isHeld(p) || approved(p))).sort((a, b) => (isFix(b) - isFix(a)) || (a.c < b.c ? -1 : 1));
  const needs = open.filter(p => !p.draft && isHeld(p) && !approved(p) && !heldByYou(p));
  const yours = open.filter(p => !p.draft && heldByYou(p)), drafts = open.filter(p => p.draft);
  const shipped = L.filter(p => p.m && Date.now() - Date.parse(p.m) < 2 * 864e5).sort((a, b) => a.m < b.m ? 1 : -1).slice(0, 8);
  const gate = desks.worker || {}, nextRun = gate.next && Date.parse(gate.next) > Date.now() - 60e3 ? Date.parse(gate.next) : null;
  // what needs his call
  const calls = [];
  for (const p of needs) calls.push({key: "pr:" + p.n, kind: "pr", n: p.n, title: plain(p.t), why: plain(String(p.b).replace(/^\s*NEEDS MATTHEW:?\s*/i, "").split(/\n\s*\n/)[0]).slice(0, 220), url: p.url});
  for (const a of P.a || []){ if (a.k === "pr" && a.repo === "Hybrid"){ if (calls.some(c => c.n === a.n) || !needs.some(p => p.n === a.n)) continue; }
    calls.push({key: (a.k || "x") + ":" + (a.repo || "") + (a.n || a.title), kind: a.k === "pr" ? (a.repo === "Hybrid" ? "pr" : "upgrade") : "ask", n: a.n, title: plain(a.title), why: plain(a.why || ""), url: a.url}); }
  const live = calls.filter(c => !(optv("defer:" + c.key) > Date.now()) && optv("ship:" + c.n) !== 1 && optv("hold:" + c.n) !== 1);
  // spend
  const m = P.money || {}, sp = o.spend || {}, capDay = +(h2.spend && h2.spend.daily_cap) || CAP, today = m.today != null ? +m.today : sp.spent != null ? +sp.spent : null;
  const spend = {known: today != null, today, cap: capDay, limit: m.today_cap != null ? +m.today_cap : sp.cap != null ? +sp.cap : null, month: m.month, monthCap: m.month_cap, from: m.from,
    byModel: sp.by_model || null, byJob: sp.by_job || null, runs: sp.runs, hold: !!(h2.spend && h2.spend.throttled), critical: !!(h2.spend && h2.spend.critical)};
  spend.pct = spend.known ? Math.min(100, Math.round(100 * today / capDay)) : 0;
  const quiet = h2.quiet || null, health = x.health || null;
  const incidents = ((P.inc || {}).rows || []).filter(r => r[2] !== "closed");
  const ok = pub.ok !== false && !incidents.some(r => r[1] === "critical");
  return {P, pub, h2, o, x, desks, mode, queue, needs, yours, drafts, shipped, nextRun, calls: live, spend, quiet, health, incidents, ok, locked: !S.priv,
          feed: (P.f || []).slice(0, 60), me: P.me || null}; }

return {S, API, CAP, ROLE, IOS_BROWSER, keyStr, model, send, phrase, plain, ago, when, money, syncNow, loadChecks, ls, optv,
        on: f => subs.push(f), setToast: f => { toastFn = f; }, start: () => { start(); return tick(true); }, isFix, isHeld};
})();
