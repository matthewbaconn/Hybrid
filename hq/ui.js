"use strict";
/* Mileset HQ command floor: everything you see. Data comes from core.js (HQ.model()); nothing here invents a number:
   a feed that isn't connected yet shows a "Ready to connect" card that fills in by itself once it is. */
(() => {
const {S, model, send, plain, ago, when, money, ROLE} = HQ;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const cut = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const phone = () => innerWidth < 900;
const empty = (title, how) => `<div class="empty"><div><b>Ready to connect:</b> ${esc(title)}${how ? `<br>${esc(how)}` : ""}</div></div>`;
const chip = (s, label) => `<span class="chip" data-s="${s}"><i></i>${esc(label)}</span>`;
const LABEL = {working: "Working", idle: "Idle", waiting: "Waiting on approval", paused: "Paused", alert: "Needs attention", offline: "Offline", ok: "On track"};
const setHTML = (el, h) => { if (el._h !== h){ el._h = h; el.innerHTML = h; return true; } return false; };   // redraw only what changed: no flicker, no replayed animations
let M = model(), view = "floor";

// ---------- toasts ----------
HQ.setToast((t, kind) => { const el = document.createElement("div"); el.className = "toast glass solid"; el.textContent = t;
  if (kind === "warn") el.style.borderColor = "rgba(255,193,94,.5)"; if (kind === "ok") el.style.borderColor = "rgba(70,227,161,.5)";
  $("#toasts").appendChild(el); setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, kind === "warn" ? 5200 : 3200); });

// ---------- stations ----------
const IC = {vesper: '<circle cx="12" cy="12" r="9"/><path d="M12 5.5l5.6 9.7H6.4z"/><circle cx="12" cy="12" r="1.8"/>', stark: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19.5h20"/>',
  dev: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>', product: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>', growth: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  qa: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M9.5 12l2 2 3.5-4"/>', personal: '<path d="M12 20.5s-7.5-4.6-7.5-10.2a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.600-7.5 10.200-7.500 10.200z"/><path d="M8 11.500h2l1.500-2.500 1.800 4.500 1.200-2h1.500"/>'};
const STN = [
  {id: "vesper", name: "VESPER", sub: "CEO helm", x: 700, y: 700, desks: ["ceo-shift", "scorecard", "friday-review", "monday-email"], helm: true},
  {id: "dev", name: "Dev Lead", sub: "Builds and fixes the app", x: 700, y: 250, desks: ["dev-lead"]},
  {id: "product", name: "Product Lead", sub: "Decides what to build next", x: 1090, y: 475, desks: ["product-lead"]},
  {id: "growth", name: "Growth", sub: "Sign-ups, social and content", x: 1090, y: 925, desks: ["growth-sprint", "instagram", "graphics"]},
  {id: "qa", name: "QA / Phone Test", sub: "Tests and ships every change", x: 700, y: 1150, desks: ["worker", "audit"]},
  {id: "personal", name: "Personal Ops", sub: "Your day, school and training", x: 310, y: 925, desks: []},
  {id: "stark", name: "Stark", sub: "The laptop: browser and hands", x: 310, y: 475, desks: []}];
const byId = Object.fromEntries(STN.map(s => [s.id, s]));
const stationOf = role => (STN.find(s => s.desks.includes(role)) || {}).id;
function runOf(re){ return (S.runs || []).find(r => re.test(r.name) && r.st !== "in_progress" && r.st !== "queued"); }
function info(st){
  const ds = st.desks.map(i => M.desks[i]).filter(Boolean), w = ds.find(d => d.s === "w"), bad = ds.find(d => d.s === "f" || d.s === "x");
  const last = ds.filter(d => d.last).sort((a, b) => a.last < b.last ? 1 : -1)[0], next = ds.filter(d => d.next && Date.parse(d.next) > Date.now()).sort((a, b) => a.next < b.next ? -1 : 1)[0];
  let s = w ? "working" : bad ? "alert" : "idle", bub = "";
  if (w) bub = (ds.length > 1 ? ROLE[w.id] + ": " : "") + (plain(w.sum) || "working right now");
  else if (bad) bub = ROLE[bad.id] + " hit a problem " + ago(bad.last) + ". Logged quietly; the team is on it.";
  else if (last) bub = (last.sum ? "Last: " + cut(plain(last.sum), 70) + " · " : "Finished ") + ago(last.last) + (next ? " · next " + when(next.next) : "");
  else if (next) bub = "Next run " + when(next.next);
  if (st.id === "vesper"){ const busy = STN.filter(x => !x.helm && x._i && x._i.s === "working").length;
    s = M.mode === "paused" ? "paused" : M.calls.length ? "waiting" : busy ? "working" : M.ok ? "ok" : "alert";
    bub = M.mode === "paused" ? "Paused: only outage and member-email fixes run." : M.calls.length ? M.calls.length + " thing" + (M.calls.length > 1 ? "s" : "") + " waiting on your call."
      : busy ? "Directing " + busy + " worker" + (busy > 1 ? "s" : "") + " right now." : M.ok ? "All steady." + (M.nextRun ? " Next ship run " + when(M.nextRun) + "." : "") : "Something's off: open me for details.";
    if (M.mode === "class" && s !== "paused") bub = "In-class mode: I'm holding non-urgent messages. " + bub; }
  if (st.id === "qa"){ const smoke = runOf(/Post-deploy phone smoke test/), night = runOf(/Nightly check/), red = [smoke, night].find(r => r && /fail|timed_out/.test(r.st));
    if (!w && red){ s = "alert"; bub = red.name + " failed " + ago(red.at) + "."; }
    else if (!w && M.needs.length){ s = "waiting"; bub = "Holding " + M.needs.map(p => "#" + p.n).join(", ") + " for your OK."; }
    else if (!w && M.queue.length) bub = "Next to ship: #" + M.queue[0].n + (M.nextRun ? " at " + when(M.nextRun) : "") + "."; }
  if (st.id === "stark"){ const d = (M.h2.dev || {}).stark;
    if (!d){ s = M.locked ? "idle" : "offline"; bub = M.locked ? "" : "Stark's heartbeat isn't in the feed yet."; }
    else { const age = Date.now() / 1000 - (+d.ts || 0); s = age > 45 * 60 ? "offline" : d.busy ? "working" : "idle";
      bub = s === "offline" ? "Last checked in " + ago(d.ts * 1000) + "." : d.busy ? "Doing a hands-on job right now." : "Standing by. Checked in " + ago(d.ts * 1000) + (d.mic_ok ? " · mic on" : "") + "."; } }
  if (st.id === "personal"){ const today = M.me && M.me.days && M.me.days[0] ? M.me.days[0][1] : null;
    s = today ? "ok" : "idle"; bub = !M.me ? (M.locked ? "" : "Your agenda isn't in the feed yet.") : today && today.length ? today.length + " thing" + (today.length > 1 ? "s" : "") + " on your day. Next: " + cut(today[0][1], 40) + (today[0][2] ? " at " + today[0][2] : "") + "." : "Nothing on your agenda today."; }
  if (M.mode === "paused" && s === "idle" && st.desks.length) s = "paused";
  if (M.locked && !bub && last) bub = "Finished " + ago(last.last) + (next ? " · next " + when(next.next) : "");
  return {s, bub: cut(bub, 120), ds, w, bad, last, next}; }

const world = $("#world"), floor = $("#floor"), wires = $("#wires"), stEl = $("#stations");
// a phone gets a narrower hexagon so the whole floor fits a 390-wide screen
const WIDE = {dev: [700, 250], product: [1090, 475], growth: [1090, 925], qa: [700, 1150], personal: [310, 925], stark: [310, 475]}, TALL = {dev: [700, 210], product: [1005, 465], growth: [1005, 935], qa: [700, 1190], personal: [395, 935], stark: [395, 465]};
let laid = null;
function layout(){ const k = phone() ? "tall" : "wide"; if (laid === k) return false; laid = k; for (const s of STN) if (!s.helm) [s.x, s.y] = (k === "tall" ? TALL : WIDE)[s.id]; return true; }
function buildFloor(){
  layout();
  wires.innerHTML = [150, 300, 450].map((r, i) => `<circle class="ring${i === 1 ? " d" : ""}" cx="700" cy="700" r="${r}"/>`).join("") +
    STN.filter(s => !s.helm).map(s => `<path class="wire" d="M700 700L${s.x} ${s.y}"/><path class="beam" id="b-${s.id}" d="M700 700L${s.x} ${s.y}" hidden/>`).join("");
  stEl.innerHTML = STN.map(s => `<div class="stn${s.helm ? " helm" : ""}" id="s-${s.id}" data-id="${s.id}" data-s="idle" style="left:${s.x}px;top:${s.y}px" role="button" tabindex="0" aria-label="${esc(s.name)}">
    <div class="pod"><svg viewBox="0 0 24 24">${IC[s.id]}</svg></div><b>${esc(s.name)}</b><span class="chip"><i></i><span class="lb">Idle</span></span></div>`).join(""); }
function drawFloor(){
  for (const st of STN.filter(s => !s.helm).concat(STN.filter(s => s.helm))){ const i = st._i = info(st), el = $("#s-" + st.id);
    if (el.dataset.s !== i.s){ el.dataset.s = i.s; $(".lb", el).textContent = LABEL[i.s]; }
    let b = $(".bub", el); if (i.bub !== (b ? b.textContent : "")){ if (b) b.remove(); if (i.bub){ b = document.createElement("div"); b.className = "bub"; b.textContent = i.bub; el.prepend(b); } }
    const beam = $("#b-" + st.id); if (beam){ const on = i.s === "working" || i.s === "waiting" || (i.last && Date.now() - Date.parse(i.last.last) < 10 * 60e3 && i.s !== "alert");
      beam.toggleAttribute("hidden", !on); beam.style.setProperty("--c", i.s === "waiting" ? "var(--am)" : i.s === "working" ? "var(--cy)" : "var(--em)"); beam.classList.toggle("back", i.s !== "working"); } }
  // a spark runs along the wire whenever a worker reports in (new line in the activity feed)
  const top = M.feed[0] && M.feed[0][0]; if (top && S.seen && top > S.seen) for (const f of M.feed.filter(f => f[0] > S.seen).slice(0, 4)) spark(stationOf(f[1]), f[2] === "failed");
  if (top) S.seen = top; }
function spark(id, bad){ const st = byId[id]; if (!st || st.helm) return; const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("r", 5); c.setAttribute("class", "spark"); c.style.setProperty("--c", bad ? "var(--rd)" : "var(--em)"); wires.appendChild(c);
  const t0 = performance.now(); (function f(t){ const k = Math.min(1, (t - t0) / 1300), e = 1 - Math.pow(1 - k, 3); c.setAttribute("cx", st.x + (700 - st.x) * e); c.setAttribute("cy", st.y + (700 - st.y) * e); if (k < 1) requestAnimationFrame(f); else c.remove(); })(t0); }

// ---------- camera: drag to pan, pinch / wheel to zoom, spring to focus ----------
const cam = {x: 0, y: 0, s: 1}, tgt = {x: 0, y: 0, s: 1}, vel = {x: 0, y: 0, s: 0}; let raf = 0;
// zoomed out, stations keep a readable size (distances shrink, labels don't) and only the stations with news keep their bubble
const paint = () => { world.style.transform = `translate3d(${cam.x}px,${cam.y}px,0) scale(${cam.s})`; world.style.setProperty("--inv", Math.min(2.3, Math.max(1, (phone() ? .78 : .9) / cam.s)).toFixed(3)); floor.classList.toggle("far", cam.s < .7); };
function stepCam(){ let moving = false; for (const k of ["x", "y", "s"]){ const eps = k === "s" ? .0004 : .25; vel[k] = (vel[k] + (tgt[k] - cam[k]) * .13) * .74; cam[k] += vel[k]; if (Math.abs(tgt[k] - cam[k]) > eps || Math.abs(vel[k]) > eps) moving = true; }
  paint(); raf = moving ? requestAnimationFrame(stepCam) : 0; if (!moving){ Object.assign(cam, tgt); paint(); } }
function fly(t, snap){ Object.assign(tgt, t); if (snap){ Object.assign(cam, tgt); vel.x = vel.y = vel.s = 0; paint(); } else if (!raf) raf = requestAnimationFrame(stepCam); }
const insets = () => { const sb = $("#stack").hidden ? 0 : $("#stack").getBoundingClientRect(), hud = $("#hud").getBoundingClientRect().bottom || 70;
  return {top: (phone() && sb && sb.height < 170 ? Math.max(hud, sb.bottom) : hud) + 14, bot: phone() ? 156 : 110}; };
function fit(snap){ const {top, bot} = insets(), ph = phone(), left = !ph && [...$("#stack").children].some(c => !c.hidden) ? 440 : 0, W = innerWidth - left, H = innerHeight - top - bot;
  const s = Math.max(.26, Math.min(1.05, (W - (ph ? 120 : 200)) / (ph ? 610 : 780), (H - (ph ? 190 : 230)) / (ph ? 980 : 900)));   // leave room for the pods and labels themselves
  fly({s, x: left + W / 2 - 700 * s, y: top + H / 2 - 700 * s + 6}, snap); }
function focusOn(st){ const s = phone() ? .95 : 1.12, W = innerWidth - (phone() ? 0 : 440), cy = phone() ? innerHeight * .2 + 60 : innerHeight / 2; fly({s, x: W / 2 - st.x * s, y: cy - st.y * s}); }
const pts = new Map(); let moved = 0, pinch = 0;
floor.addEventListener("pointerdown", e => { pts.set(e.pointerId, {x: e.clientX, y: e.clientY}); moved = 0; if (pts.size === 2){ const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } floor.classList.add("drag"); });
addEventListener("pointermove", e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (pts.size === 1){ moved += Math.abs(dx) + Math.abs(dy); if (moved > 6) fly({x: tgt.x + dx, y: tgt.y + dy, s: tgt.s}, true); }
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2){ moved = 99; const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (pinch) zoomAt(mx, my, d / pinch, true); pinch = d; } });
const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) floor.classList.remove("drag"); };
addEventListener("pointerup", up); addEventListener("pointercancel", up);
function zoomAt(cx, cy, f, snap){ const s = Math.max(.32, Math.min(2.2, tgt.s * f)), k = s / tgt.s; fly({s, x: cx - (cx - tgt.x) * k, y: cy - (cy - tgt.y) * k}, snap); }
floor.addEventListener("wheel", e => { e.preventDefault(); if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0022)));
  else fly({x: tgt.x - e.deltaX, y: tgt.y - e.deltaY, s: tgt.s}, true); }, {passive: false});
stEl.addEventListener("click", e => { const el = e.target.closest(".stn"); if (el && moved < 8) openStation(byId[el.dataset.id]); });
stEl.addEventListener("keydown", e => { const el = e.target.closest(".stn"); if (el && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openStation(byId[el.dataset.id]); } });
$("#fit").onclick = () => fit();

// ---------- drawer (slide-over on desktop, swipeable bottom sheet on a phone) ----------
const drawer = $("#drawer"), scrim = $("#scrim"); let drawerKey = null;
function openDrawer(key, title, sub, body){ drawerKey = key; $(".dh", drawer).innerHTML = `<div><h2>${esc(title)}</h2>${sub ? `<div class="mut sm">${sub}</div>` : ""}</div><button class="x" type="button" aria-label="Close">✕</button>`;
  $(".db", drawer).innerHTML = body; drawer.style.removeProperty("--dy"); drawer.classList.add("on"); drawer.setAttribute("aria-hidden", "false"); scrim.classList.add("on"); }
function closeDrawer(){ if (!drawerKey) return; drawerKey = null; drawer.classList.remove("on"); drawer.setAttribute("aria-hidden", "true"); scrim.classList.remove("on"); if (view === "floor") fit(); }
scrim.onclick = closeDrawer; drawer.addEventListener("click", e => { if (e.target.closest(".x")) closeDrawer(); });
{ let y0 = null, dy = 0; const dh = $(".dh", drawer), grab = $(".grab", drawer);
  const dn = e => { if (!phone() || e.target.closest(".x")) return; y0 = e.clientY; dy = 0; drawer.style.transition = "none"; };
  dh.addEventListener("pointerdown", dn); grab.addEventListener("pointerdown", dn);
  addEventListener("pointermove", e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); drawer.style.setProperty("--dy", dy + "px"); });
  const end = () => { if (y0 == null) return; y0 = null; drawer.style.transition = ""; if (dy > 90) closeDrawer(); else drawer.style.setProperty("--dy", "0px"); };
  addEventListener("pointerup", end); addEventListener("pointercancel", end); }
const hist = h => Array.isArray(h) ? {t: h[0], r: h[1], s: h[2]} : {t: h.t || h.ts || h.at, r: h.r || h.result, s: h.s || h.sum || h.summary};
const rword = r => ({ok: "Done", failed: "Failed", skipped: "Nothing to do", timeout: "Ran out of time", retry: "Retried"})[r] || plain(r || "");
function openStation(st){ const i = st._i || info(st); focusOn(st);
  const feed = M.feed.filter(f => st.desks.includes(f[1])).slice(0, 12), d0 = i.w || i.last || i.ds[0];
  let h = `<section>${chip(i.s, LABEL[i.s])}<p style="margin:10px 0 0">${esc(i.bub || st.sub)}</p></section>`;
  if (st.id === "personal") h += personalBrief();
  else if (st.id === "stark"){ const d = (M.h2.dev || {}).stark; h += d ? `<section><h3>Right now</h3><div class="kpis"><div class="kpi"><span>Last check-in</span><b>${esc(ago(d.ts * 1000))}</b></div><div class="kpi"><span>Hands</span><b>${d.hands ? "On" : "Off"}</b></div><div class="kpi"><span>Microphone</span><b>${d.mic_ok ? "On" : "Off"}</b></div></div>${d.outreach ? `<p class="mut sm">Messages: ${esc(plain(d.outreach))}</p>` : ""}</section>` : `<section>${empty("Stark's heartbeat", "It appears here after Vesper's next feed update.")}</section>`; }
  else {
    const obj = (M.h2.obj || {})[(i.ds[0] || {}).id] || (st.desks.map(k => (M.h2.obj || {})[k]).filter(Boolean)[0]);
    h += `<section><h3>Current task</h3>`;
    if (i.w){ const w7 = (M.x.work7 || {})[i.w.id] || {}, n = (w7.ok || 0) + (w7.failed || 0), avg = n && w7.min ? Math.max(2, w7.min / n) : 12, el = (Date.now() - Date.parse(i.w.last)) / 60e3;
      h += `<p style="margin:0 0 8px">${esc(plain(i.w.sum) || ROLE[i.w.id] + " is working right now.")}</p><div class="prog live"><u style="width:${Math.max(6, Math.min(95, Math.round(100 * el / avg)))}%"></u></div><p class="mut sm" style="margin:6px 0 0">Started ${esc(ago(i.w.last))} · usually takes about ${Math.round(avg)} min</p>`; }
    else h += `<p style="margin:0">${obj ? "Standing order: " + esc(cut(plain(obj), 260)) : "Nothing running right now."}</p><p class="mut sm" style="margin:6px 0 0">${i.next ? "Next run " + esc(when(i.next.next)) : "Runs when Vesper gives it a job."}</p>`;
    h += `</section>`;
    const done = (d0 && d0.hist && d0.hist.length ? d0.hist.map(hist) : feed.map(f => ({t: f[0], r: f[2], s: f[3], role: f[1]}))).slice(0, 6);
    h += `<section><h3>Recently finished</h3>${done.length ? `<div class="log">${done.map(x => `<div><time>${esc(when(x.t))}</time><span><b>${esc(rword(x.r))}.</b> ${esc(cut(plain(x.s), 200))}</span></div>`).join("")}</div>` : M.locked ? `<p class="mut sm">Unlock HQ to read what each worker did.</p>` : `<p class="mut sm">No finished runs in the log yet.</p>`}</section>`;
    const tot = i.ds.reduce((a, d) => ({ok: a.ok + (d.ok7 || 0), fail: a.fail + (d.fail7 || 0), runs: a.runs + (d.runs || 0), min: a.min + (d.min || 0)}), {ok: 0, fail: 0, runs: 0, min: 0}), n7 = tot.ok + tot.fail;
    h += `<section><h3>Reliability and speed</h3><div class="kpis"><div class="kpi"><span>Success, last 7 days</span><b>${n7 ? Math.round(100 * tot.ok / n7) + "%" : "–"}</b><em>${n7 ? tot.ok + " of " + n7 + " runs" : "no runs logged"}</em></div><div class="kpi"><span>Runs today</span><b>${tot.runs}</b><em>${tot.min ? tot.min + " min of work" : ""}</em></div></div></section>`;
    h += `<section><h3>Activity</h3>${feed.length ? `<div class="log">${feed.map(f => `<div><time>${esc(when(f[0]))}</time><span>${esc(ROLE[f[1]] || f[1])}: ${esc(rword(f[2]).toLowerCase())}${f[3] ? ". " + esc(cut(plain(f[3]), 160)) : ""}</span></div>`).join("")}</div>` : `<p class="mut sm">Quiet so far today.</p>`}
      <details class="raw"><summary>Technical log</summary><pre>${esc(JSON.stringify(i.ds, null, 1))}</pre></details></section>`;
    if (st.desks.length && !M.locked) h += `<section class="acts">${st.desks.filter(k => ["dev-lead", "growth-sprint", "product-lead", "instagram", "ceo-shift", "audit"].includes(k)).slice(0, 2).map(k => `<button class="btn" data-say="run ${esc(ROLE[k].toLowerCase())} now" data-label="Run ${esc(ROLE[k])} now">Run ${esc(ROLE[k])} now</button>`).join("")}<button class="btn" data-pal="assign ${esc((ROLE[st.desks[0]] || "").toLowerCase())}: ">Give a new objective</button></section>`; }
  openDrawer("stn:" + st.id, st.name === "VESPER" ? "Vesper" : st.name, esc(st.sub), h); }

// ---------- HUD ----------
function drawHud(){
  const hp = $("#p-health"), ok = M.ok, crit = M.incidents.filter(r => r[1] === "critical").length;
  hp.firstElementChild.style.setProperty("--c", !S.pub && !S.priv ? "var(--mut)" : ok ? "var(--em)" : "var(--rd)");
  hp.lastElementChild.textContent = !S.pub && !S.priv ? "Checking systems" : ok ? "All systems go" : crit ? crit + " critical problem" + (crit > 1 ? "s" : "") : "Site or app needs attention";
  const vs = byId.vesper._i || {s: "idle"}, vp = $("#p-vesper"); vp.firstElementChild.style.setProperty("--c", ({working: "var(--cy)", waiting: "var(--am)", paused: "#77839a", alert: "var(--rd)", ok: "var(--em)"})[vs.s] || "var(--mut)");
  vp.lastElementChild.textContent = "Vesper · " + ({working: "directing work", waiting: "waiting on you", paused: "paused", alert: "needs attention", ok: "on watch", idle: "on watch"})[vs.s];
  const q = M.quiet, pq = $("#p-quiet"), n = q ? (q.today != null ? q.today : (q.items || []).length) : null;
  pq.firstElementChild.style.setProperty("--c", n ? "var(--am)" : n === 0 ? "var(--em)" : "var(--mut)");
  pq.lastElementChild.textContent = n == null ? "Quiet log" : n ? n + " quiet failure" + (n > 1 ? "s" : "") + " today" : "No quiet failures";
  for (const b of $$("#focus button")) b.setAttribute("aria-pressed", String(b.dataset.m === M.mode));
  document.documentElement.style.setProperty("--hudh", $("#hud").offsetHeight + "px");
  const nd = M.calls.length + M.needs.filter(p => !M.calls.some(c => c.n === p.n)).length, dot = $("#d-ship"); dot.hidden = !M.needs.length; dot.textContent = M.needs.length; }
// ---------- telemetry header bar ($0: it reads Vesper's sealed heartbeat and GitHub's public list, never the AI) ----------
function drawTbar(){
  const sp = M.spend, ps = HQ.pauseState(), age = HQ.relayAge(), T = S.tel;
  const set = (id, st, txt, title) => { const el = $("#" + id); el.dataset.s = st; el.lastElementChild.textContent = txt; if (title) el.title = title; };
  $("#t-amt").textContent = (sp.known ? money(sp.today) : "$–.––") + " / " + money(sp.cap);
  const me = $("#t-spend .meter"); me.className = "meter" + (ps.paused || sp.pct >= 100 ? " over" : sp.pct >= 80 ? " warn" : ""); me.firstElementChild.style.width = sp.pct + "%";
  const left = sp.known ? Math.max(0, Math.min(sp.cap, sp.limit != null ? sp.limit : sp.cap) - sp.today) : null;
  $("#t-left").textContent = left == null ? "headroom –" : money(left) + " left" + (sp.limit != null && sp.limit < sp.cap ? " today" : "");
  $("#t-spend").title = sp.known ? `${money(sp.today)} of the ${money(sp.cap)} daily cap (${sp.pct}%)` + (sp.limit != null && sp.limit < sp.cap ? `; today's real limit is ${money(sp.limit)} because the monthly budget is tighter` : "") : "Spend appears once HQ is unlocked";
  set("t-pause", ps.paused ? "alert" : sp.known ? "ok" : "idle", ps.paused ? "PAUSED — " + (ps.reason === "cap reached" || !ps.reason ? "CAP REACHED" : ps.reason.toUpperCase()) : "PAUSE ARMED",
      ps.paused ? "Over-budget pause is on: changes from HQ are switched off (Hold still works). Lift it in Telegram." : "Over-budget pause is armed: it switches on by itself at the cap, or when you say \"going over budget\".");
  set("t-relay", age == null ? "idle" : age <= 120 ? "ok" : "alert", age == null ? (S.telOn === false || !HQ.keyStr() ? "RELAY —" : "RELAY …") : (age <= 120 ? "RELAY ONLINE · " : "RELAY STALE · ") + ago(Date.now() - age * 1000).replace(" ago", ""),
      age == null ? (S.telOn === false ? "No heartbeat yet: it starts once the mailbox update is live." : "Waiting for Vesper's first heartbeat.") : "Vesper's last heartbeat: " + ago(Date.now() - age * 1000) + " (stale after 2 minutes)");
  const G = T && T.gate, q0 = M.queue[0], nextN = G ? G.next_n : q0 ? q0.n : null, nextRun = G && G.next_run ? Date.parse(G.next_run) : M.nextRun;
  set("t-gate", nextN ? "working" : "idle", (nextN ? "NEXT #" + nextN : "GATE CLEAR") + (nextRun ? " · " + when(nextRun).toUpperCase() : ""),
      nextN ? "Next to ship: #" + nextN + (G && G.next_title ? " " + G.next_title : q0 ? " " + q0.t : "") + (nextRun ? ", at the " + when(nextRun) + " run" : "") : "Nothing queued for the ship gate"); }
function drawSync(){ const el = $("#sync"), t = $("#synct"); el.classList.toggle("busy", S.busy);
  t.textContent = S.at ? "Synced " + ago(S.at) : navigator.onLine === false ? "Offline" : "Connecting…"; el.firstElementChild.style.setProperty("--c", S.at && Date.now() - S.at < 90e3 ? "var(--em)" : "var(--am)"); }
setInterval(drawSync, 1000);
$("#sync").onclick = () => { HQ.syncNow(true); };
$("#focus").onclick = e => { const b = e.target.closest("button"); if (!b || b.dataset.m === M.mode) return; const m = b.dataset.m;
  send({t: "focus", mode: m}, ({normal: "Back to normal alerts", class: "In-class mode: hold non-urgent messages", paused: "Pause workers and spend"})[m]); };
$("#t-gate").onclick = () => show("ship");
$("#t-spend").onclick = () => { show("company"); setTimeout(() => { const c = $("#c-spend"); if (c) c.scrollIntoView({behavior: "smooth", block: "start"}); }, 60); };
$("#p-quiet").onclick = () => { const q = M.quiet, items = q ? q.items || [] : [];
  openDrawer("quiet", "Quiet failure log", "Routine hiccups Vesper logged instead of pinging you", !q ? empty("the quiet failure log", "It arrives with Vesper's next feed update.") : !items.length ? `<p>Nothing failed quietly. Clean run so far.</p>` :
    `<div class="log">${items.slice().reverse().map(x => `<div><time>${esc(when(x.at))}</time><span>${esc(cut(plain(x.text), 240))}</span></div>`).join("")}</div><details class="raw"><summary>Technical log</summary><pre>${esc(JSON.stringify(items, null, 1))}</pre></details>`); };

// ---------- needs your call + recap ----------
function drawCall(){ const el = $("#call"), C = M.calls; el.hidden = !C.length; if (!C.length) return; const wasOpen = el.dataset.touched ? el.classList.contains("open") : !phone() || C.length === 1;
  el.classList.toggle("open", wasOpen);
  setHTML(el, `<div class="cardh fold" data-fold>Needs your call · ${C.length}</div><div class="foldb">${C.map(c => `<div class="ask"><p><b>${esc(c.title)}</b></p>${c.why ? `<p class="why">${esc(c.why)}</p>` : ""}
    <div class="acts">${c.kind === "pr" ? `<button class="btn go" data-cmd='${esc(JSON.stringify({t: "ship", n: c.n}))}' data-label="Approve #${c.n}">Approve</button><button class="btn warn" data-cmd='${esc(JSON.stringify({t: "hold", n: c.n}))}' data-label="Hold #${c.n}">Hold</button>`
      : c.kind === "upgrade" ? `<button class="btn go" data-cmd='${esc(JSON.stringify({t: "install", n: c.n}))}' data-label="Approve Vesper upgrade #${c.n}">Approve</button>` : `<button class="btn cy" data-pal="">Reply</button>`}
      <button class="btn" data-cmd='${esc(JSON.stringify({t: "defer", key: c.key, title: c.title}))}' data-label="Deferred: ${esc(cut(c.title, 40))}">Defer a day</button>${c.url ? `<a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">Details</a>` : ""}</div></div>`).join("")}</div>`); }
function recapLines(){ const b = M.h2.brief; if (b && Array.isArray(b.lines) && b.lines.length) return b.lines.slice(0, 3).map(plain);
  if (M.locked && !S.order) return null; const out = [], sh = M.shipped.filter(p => Date.now() - Date.parse(p.m) < 864e5);
  const lv = M.h2.live || [];
  out.push(lv.length ? "Went live today: " + lv.slice(-3).map(x => cut(plain(x.replace(/\s*·\s*undo:.*$/i, "")), 70)).join("; ") + "." : sh.length ? sh.length + " change" + (sh.length > 1 ? "s" : "") + " went live in the last day: " + sh.slice(0, 3).map(p => cut(plain(p.t), 46)).join("; ") + "." : "Nothing new went live in the last day.");
  out.push(M.queue.length ? "Next to ship: " + cut(plain(M.queue[0].t), 60) + (M.nextRun ? ", around " + when(M.nextRun) : "") + (M.queue.length > 1 ? " (" + (M.queue.length - 1) + " more behind it)" : "") + "." : "Nothing is queued to ship right now.");
  out.push(M.calls.length ? M.calls.length + " thing" + (M.calls.length > 1 ? "s need" : " needs") + " your call (top of this screen)." : M.ok ? "Nothing needs you. Everything's running." : "The site or app needs attention: tap the health light.");
  return out; }
function drawRecap(){ const el = $("#recap"), L = recapLines(); el.hidden = !L || view !== "floor"; if (!L) return; const hr = new Date().getHours(), open = el.dataset.touched ? el.classList.contains("open") : !phone();
  el.classList.toggle("open", open); setHTML(el, `<div class="cardh fold" data-fold style="margin:0">${hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening"} recap<span class="r mut">${M.P.t ? "as of " + esc(when(M.P.t)) : ""}</span></div><div class="foldb" style="margin-top:10px"><ul>${L.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`); }
$("#stack").addEventListener("click", e => { const f = e.target.closest("[data-fold]"); if (f){ const c = f.parentElement; c.classList.toggle("open"); c.dataset.touched = 1; } });

// ---------- views ----------
const views = $("#views");
function show(v){ view = v; for (const b of $$("#dock button")) b[b.dataset.v === v ? "setAttribute" : "removeAttribute"]("aria-current", "page");
  if (v === "members") loadRoster();
  views.hidden = v === "floor"; document.body.classList.toggle("inview", v !== "floor"); $("#floorctl").hidden = $("#stack").hidden = v !== "floor"; if (v !== "floor"){ views.scrollTop = 0; drawView(true); } else { drawRecap(); fit(); } }
$("#dock").onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.v); };
const prState = p => p.m ? ["ok", "Shipped " + ago(p.m)] : p.draft ? ["paused", "Not ready"] : M.yours.includes(p) ? ["waiting", "Held by you"] : M.needs.includes(p) ? ["waiting", "Waiting for your OK"] : ["working", "Queued"];
const prSum = p => { const b = String(p.b || "").replace(/^\s*NEEDS MATTHEW:?[^\n]*\n*/i, "").replace(/[*_`#>|]/g, "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)[0] || ""; return cut(plain(b), 190); };
const chk = p => { const c = S.checks[p.sha]; return !c ? "" : c.bad ? chip("alert", "Checks failing") : c.ok ? chip("ok", "Checks passing") : c.ok === null && !c.runs.length ? "" : chip("working", "Checks running"); };
function vShip(){
  const step = (p, n, cls, extra) => `<div class="step ${cls}" data-n="${n}" data-pr="${p.n}"><b>${esc(plain(p.t))} <span class="dim num">#${p.n}</span></b><div class="meta">${extra || ""}${chk(p)}</div></div>`;
  const cmds = S.out.slice(0, 8);
  let n = 0, h = cmds.length ? `<section class="card glass wide" id="c-cmds"><h2>Commands you sent</h2><p class="sub">Instant reads run at once; changes wait for your Approve in Telegram.</p><div class="rows">${cmds.map(r => `<div class="row"><div class="g"><b>${esc(r.label)}</b><span>${esc(ago(r.at))}${r.cost ? " · about " + money(r.cost) : ""}${r.say && !r.result ? " · " + esc(cut(plain(r.say), 120)) : ""}</span>${result(r)}</div>${badge(r.st)}</div>`).join("")}</div></section>` : "";
  h += vPipe();
  h += `<section class="card glass wide"><h2>Ship gate</h2><p class="sub">In the exact order changes go live. One per hourly run, bug fixes first, then oldest first.${M.nextRun ? " Next run " + esc(when(M.nextRun)) + "." : ""}${S.orderErr ? " (GitHub is busy: showing the list from " + esc(ago(S.orderAt)) + ".)" : ""}</p>`;
  if (!S.order) h += empty("the release queue", "Loading the public change list from GitHub.");
  else { h += `<div class="tl">` + (M.queue.length ? M.queue.map((p, i) => step(p, ++n, "", `<span>${M.nextRun ? "Goes live around " + esc(when(M.nextRun + i * 3600e3)) : "Next in line"}</span><button class="btn sm warn" data-cmd='${JSON.stringify({t: "hold", n: p.n})}' data-label="Hold #${p.n}">Hold</button>`)).join("") : `<p class="mut" style="margin:0">Nothing is queued. The gate is clear.</p>`)
    + M.needs.map(p => step(p, "!", "held", `<span class="tag" style="--c:var(--am)">Waiting for your OK</span><button class="btn sm go" data-cmd='${JSON.stringify({t: "ship", n: p.n})}' data-label="Approve #${p.n}">Approve</button><button class="btn sm warn" data-cmd='${JSON.stringify({t: "hold", n: p.n})}' data-label="Hold #${p.n}">Hold</button>`)).join("")
    + M.yours.map(p => step(p, "‖", "held", `<span class="tag" style="--c:var(--am)">Held by you</span><button class="btn sm" data-cmd='${JSON.stringify({t: "unhold", n: p.n})}' data-label="Release hold on #${p.n}">Release hold</button>`)).join("")
    + M.drafts.map(p => step(p, "·", "draft", `<span>Still being built</span>`)).join("")
    + M.shipped.map(p => step(p, "✓", "live", `<span>Went live ${esc(ago(p.m))}</span>`)).join("") + `</div>`; }
  if (pipeItems()) return h + `</section>`;
  h += `</section><section class="card glass wide"><h2>Pull requests and code changes</h2><p class="sub">Every open or recent change, in plain words. Tap one for details and its checks.</p><div class="rows">`;
  const all = [...M.needs, ...M.queue, ...M.yours, ...M.drafts, ...M.shipped], ups = (M.P.a || []).filter(a => a.k === "pr" && a.repo && a.repo !== "Hybrid");
  h += all.map(p => { const [s, l] = prState(p); return `<div class="row" data-pr="${p.n}" style="cursor:pointer"><div class="g"><b>${esc(plain(p.t))} <span class="dim num">#${p.n}</span></b><span>${esc(prSum(p) || "Mileset app change")}</span></div><div style="display:grid;gap:5px;justify-items:end">${chip(s, l)}${chk(p)}</div></div>`; }).join("")
    + ups.map(a => `<div class="row"><div class="g"><b>${esc(plain(a.title))} <span class="dim num">Vesper #${a.n}</span></b><span>${esc(plain(a.why || "Vesper upgrade"))}</span></div>${chip("waiting", "Waiting for your OK")}</div>`).join("");
  if (!all.length && !ups.length) h += S.order ? `<p class="mut">No open changes.</p>` : empty("pull requests", "Loading from GitHub.");
  return h + `</div></section>`; }
function openPR(n){ const p = (S.order || []).find(x => x.n === n); if (!p) return; const [s, l] = prState(p);
  const body = () => { const c = S.checks[p.sha]; return `<section>${chip(s, l)}<p style="margin:10px 0 0">${esc(prSum(p) || "No description yet.")}</p></section>
    <section><h3>Checks</h3>${!c ? `<p class="mut sm">Loading check results…</p>` : c.runs.length ? `<div class="rows">${c.runs.map(r => `<div class="row"><div class="g"><b>${esc(plain(r.name))}</b></div>${chip(r.st === "success" ? "ok" : r.st === "running" ? "working" : /fail|timed/.test(r.st) ? "alert" : "idle", r.st === "success" ? "Passed" : r.st === "running" ? "Running" : /fail|timed/.test(r.st) ? "Failed" : plain(r.st))}</div>`).join("")}</div>` : `<p class="mut sm">No checks have run on this change.</p>`}</section>
    <section class="acts">${p.open && !p.draft ? (M.needs.includes(p) ? `<button class="btn go" data-cmd='${JSON.stringify({t: "ship", n})}' data-label="Approve #${n}">Approve</button>` : "") + (M.yours.includes(p) ? `<button class="btn" data-cmd='${JSON.stringify({t: "unhold", n})}' data-label="Release hold on #${n}">Release hold</button>` : `<button class="btn warn" data-cmd='${JSON.stringify({t: "hold", n})}' data-label="Hold #${n}">Hold</button>`) : ""}<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open on GitHub</a></section>
    <details class="raw"><summary>Technical details</summary><pre>${esc("branch " + p.ref + "\n" + p.b)}</pre></details>`; };
  openDrawer("pr:" + n, plain(p.t), "App change #" + n + " · opened " + esc(ago(p.c)), body());
  HQ.loadChecks(p).then(() => { if (drawerKey === "pr:" + n) $(".db", drawer).innerHTML = body(); }); }
const sline = (vals) => { if (!vals || vals.length < 2) return ""; const mx = Math.max(...vals), mn = Math.min(...vals), W = 300, H = 56, pt = vals.map((v, i) => [i * W / (vals.length - 1), H - 6 - (mx === mn ? .5 : (v - mn) / (mx - mn)) * (H - 12)]), d = "M" + pt.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${d}L${W} ${H}L0 ${H}Z"/><path d="${d}"/></svg>`; };
const pctOf = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
function vCompany(){ const sp = M.spend, g = M.P.g || {}, f = g.funnel || {}, live = S.live, h2 = M.h2, so = h2.social || null;
  // spend
  let h = `<section class="card glass" id="c-spend"><h2>Spend and budget</h2><p class="sub">Vesper's own AI spend. Workers on your Claude plan aren't counted here.</p>`;
  if (!sp.known) h += empty("today's spend", M.locked ? "Unlock HQ to see it." : "Arrives with Vesper's next feed update.");
  else { h += `<div class="big">${money(sp.today)} <span class="mut" style="font-size:15px">of ${money(sp.cap)} today</span></div><div class="bar" style="margin:12px 0 8px"><u style="width:${sp.pct}%"></u></div>
    <p class="sm mut" style="margin:0 0 10px">${sp.limit != null && sp.limit < sp.cap ? "Today's real limit is " + money(sp.limit) + ", because the monthly budget is tighter than the daily cap. " : ""}${sp.hold ? "<b style=\"color:var(--am)\">Spend hold is on</b>: background AI work is paused until midnight." : sp.critical ? "<b style=\"color:var(--am)\">Critical-only</b> until midnight." : "\"Going over budget\" safety is armed."}</p>
    <div class="kpis"><div class="kpi"><span>This month</span><b>${sp.month != null ? money(sp.month) : "–"}</b><em>${sp.monthCap != null ? "of " + money(sp.monthCap) : ""}</em></div><div class="kpi"><span>Month pace</span><b>${sp.month != null && sp.from ? money(sp.month / Math.max(1, (Date.now() - Date.parse(sp.from)) / 864e5) * 30) : "–"}</b><em>if every day looked like this</em></div><div class="kpi"><span>AI runs today</span><b>${sp.runs != null ? sp.runs : "–"}</b></div></div>`;
    const br = (o, names) => o && Object.keys(o).length ? `<div class="rows">${Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<div class="row"><div class="g"><b>${esc(names(k))}</b></div><span class="num">${money(v)}</span></div>`).join("")}</div>` : "";
    h += `<h3 class="cardh" style="margin:14px 0 4px">Where it went</h3>` + (br(sp.byJob, k => cut(plain(k).replace(/^system:\s*/i, ""), 44)) || `<p class="mut sm">No AI spend logged yet today.</p>`) + br(sp.byModel, k => /haiku/.test(k) ? "Fast model (cheapest)" : /sonnet/.test(k) ? "Everyday model" : /opus|fable/.test(k) ? "Heavy model" : k);
    h += `<div class="acts" style="margin-top:12px">${sp.hold ? `<button class="btn" data-say="resume spend">Lift the spend hold</button>` : `<button class="btn warn" data-say="going over budget" data-label="Going over budget: hold spend">I'm going over budget</button>`}</div>`; }
  // members and app health
  const series = (g.members || []).map(r => r[1]), mem = live ? live.members : f.signed_up, mail = M.incidents.filter(r => /mail/.test(r[0])), smoke = runOf(/Post-deploy phone smoke test/), night = runOf(/Nightly check|Browser test/);
  h += `</section><section class="card glass"><h2>Members and app health</h2><p class="sub">Real members only. ${live ? "Count is live." : ""}</p><div class="big">${mem != null ? mem : "–"} <span class="mut" style="font-size:15px">members${live ? " · " + live.left + " Founding spots left" : ""}</span></div>${sline(series)}
    <div class="kpis"><div class="kpi"><span>Built a plan</span><b>${f.plan != null ? pctOf(f.plan, f.signed_up) : "–"}</b><em>${f.plan != null ? f.plan + " of " + f.signed_up : ""}</em></div><div class="kpi"><span>Logged a workout</span><b>${f.plan ? pctOf(f.trained != null ? f.trained : f.workout, f.plan) : "–"}</b><em>${f.plan ? (f.trained != null ? f.trained : f.workout) + " of " + f.plan + " with a plan" : ""}</em></div><div class="kpi"><span>Active after a week</span><b>${f.d7_eligible ? pctOf(f.active_d7, f.d7_eligible) : "–"}</b><em>${f.d7_eligible ? f.active_d7 + " of " + f.d7_eligible : "too early to tell"}</em></div><div class="kpi"><span>Trained this week</span><b>${f.trained_7d != null ? f.trained_7d : "–"}</b></div></div>
    <div class="rows"><div class="row"><div class="g"><b>Site, app and API</b><span>Checked every 5 minutes</span></div>${S.pub ? chip(M.pub.ok === false ? "alert" : "ok", M.pub.ok === false ? "Something is down" : "All up") : chip("idle", "Checking")}</div>
    <div class="row"><div class="g"><b>Member emails</b><span>Welcome, password reset, weekly email</span></div>${M.locked ? chip("idle", "Unlock to see") : chip(mail.length ? "alert" : "ok", mail.length ? cut(plain(mail[0][5]), 30) : "All sending")}</div>
    <div class="row"><div class="g"><b>iPhone test after each release</b><span>390×844 phone-size run${smoke ? " · " + esc(ago(smoke.at)) : ""}</span></div>${smoke ? chip(smoke.st === "success" ? "ok" : "alert", smoke.st === "success" ? "Passed" : "Failed") : chip("idle", "Ready to connect")}</div>
    <div class="row"><div class="g"><b>Nightly full phone test</b><span>${night ? esc(ago(night.at)) : "Every night around 1:30am"}</span></div>${night ? chip(night.st === "success" ? "ok" : "alert", night.st === "success" ? "Passed" : "Failed") : chip("idle", "Loading")}</div>
    ${M.incidents.map(r => `<div class="row"><div class="g"><b>${esc(plain(r[5]))}</b><span>${esc(plain(r[6]))} · ${esc(plain(r[12] || r[2]))}</span></div>${chip(r[1] === "critical" ? "alert" : "waiting", r[2] === "fixing" ? "Fix in progress" : r[2] === "verifying" ? "Checking the fix" : "Open")}</div>`).join("")}</div>`;
  // social and ads
  h += `</section><section class="card glass"><h2>Instagram, Facebook and ads</h2><p class="sub">Mileset's own accounts only.</p>`;
  const fol = so && so.ig_followers;
  h += `<div class="kpis"><div class="kpi"><span>Instagram followers</span><b>${fol ? fol[0] : "–"}</b><em>${fol ? "counted " + esc(fol[1]) : "not counted yet"}</em></div><div class="kpi"><span>Sign-ups from Instagram, 7 days</span><b>${g.src7 && g.src7.ig != null ? g.src7.ig : "–"}</b></div><div class="kpi"><span>From Facebook, 7 days</span><b>${g.src7 && g.src7.fb != null ? g.src7.fb : "–"}</b></div></div>`;
  h += so && so.queue && so.queue.length ? `<h3 class="cardh" style="margin:10px 0 4px">Scheduled posts</h3><div class="rows">${so.queue.slice(0, 8).map(q => `<div class="row"><div class="g"><b>${esc(cut(q[2], 80))}</b><span>${esc(q[1])} · ${esc(when(q[0]))}</span></div></div>`).join("")}</div>` : empty("the scheduled post queue (through Nov 30)", "The Social worker saves it at its next run; it shows here by itself.");
  h += so && so.founder && so.founder.length ? `<h3 class="cardh" style="margin:14px 0 4px">Founder-hour items for you</h3><div class="rows">${so.founder.slice(0, 5).map(t => `<div class="row"><div class="g"><b>${esc(cut(plain(t), 120))}</b></div></div>`).join("")}</div>` : "";
  h += `<h3 class="cardh" style="margin:14px 0 6px">Meta ads</h3>` + (so && so.ads ? `<div class="kpis"><div class="kpi"><span>Spend</span><b>${money(so.ads.spend)}</b></div><div class="kpi"><span>Clicks</span><b>${so.ads.clicks}</b></div><div class="kpi"><span>Sign-ups</span><b>${so.ads.conv}</b></div></div>` : empty("Meta Ads spend, clicks and conversions", "Vesper's server has no Meta access yet (Meta's security hold). No ads are running through Vesper."));
  // ideas board
  const cols = {ready: ["Ready", "var(--em)"], exploring: ["Exploring", "var(--cy)"], progress: ["In progress", "var(--am)"], shipped: ["Shipped", "#93a4ba"]};
  let ideas = (h2.ideas || []).slice();
  if (!h2.ideas){ for (const e of M.x.exps || []) ideas.push({col: /done|won|lost|stopp|shipp/i.test(e[1]) ? "shipped" : /run/i.test(e[1]) ? "progress" : "exploring", title: e[2], why: "Experiment · target " + e[3], src: "experiment"});
    for (const j of (M.P.jobs || []).slice(1)) ideas.push({col: /build|progress|doing/i.test(j[3]) ? "progress" : /done|ship/i.test(j[3]) ? "shipped" : "exploring", title: j[1], why: j[2] ? "Owner: " + j[2] : "", src: "backlog"}); }
  h += `</section><section class="card glass wide"><h2>Ideas, experiments and founder queue</h2><p class="sub">Tap any card to read it. Greenlight sends it to the right worker.</p>`;
  h += ideas.length ? `<div class="cols">${Object.entries(cols).map(([k, [name, c]]) => { const L = ideas.filter(i => i.col === k); return `<div class="col" style="--c:${c}"><h3><i style="width:7px;height:7px;border-radius:50%;background:${c}"></i>${name} · ${L.length}</h3>${L.slice(0, 12).map(i => `<div class="idea" data-idea="${ideas.indexOf(i)}"><b>${esc(cut(plain(i.title), 90))}</b>${i.why ? `<span>${esc(cut(plain(i.why), 90))}</span>` : ""}</div>`).join("") || `<p class="dim sm" style="margin:0">Nothing here yet.</p>`}</div>`; }).join("")}</div>` : empty("the ideas board", M.locked ? "Unlock HQ to see it." : "Fills from the research logs and the Friday Demo Day list.");
  vCompany.ideas = ideas; return h + `</section>`; }
function openIdea(i){ const it = (vCompany.ideas || [])[i]; if (!it) return; const g = it.green && HQ.optv("green:" + it.green) !== 1;
  openDrawer("idea", cut(plain(it.title), 80), esc(({ready: "Ready to build", exploring: "Exploring", progress: "In progress", shipped: "Shipped"})[it.col]), `<section><p style="margin:0">${esc(plain(it.title))}</p>${it.why ? `<p class="mut" style="margin:8px 0 0">${esc(plain(it.why))}</p>` : ""}${it.metric ? `<p class="mut sm" style="margin:8px 0 0">Moves: ${esc(plain(it.metric))}</p>` : ""}</section>
    <section class="acts">${it.col === "shipped" ? "" : g ? `<button class="btn go" data-cmd='${JSON.stringify({t: "greenlight", n: it.green})}' data-label="Greenlight: ${esc(cut(it.title, 40))}">Greenlight</button>` : it.green ? `<span class="sent">✓ Greenlit</span>` : `<button class="btn cy" data-say="prioritize this idea: ${esc(cut(plain(it.title), 140))}" data-label="Prioritize: ${esc(cut(it.title, 40))}">Prioritize</button>`}${it.link ? `<a class="btn" href="${esc(it.link)}" target="_blank" rel="noopener">Source</a>` : ""}</section>${it.src ? `<p class="dim sm">From the ${esc(it.src)} log.</p>` : ""}`); }

// ---------- the personal wing ----------
const KIND = t => /shift|work\b/i.test(t) ? "work" : /class|exam|quiz|clinical|lab|nurs|pharm|nclex|study|school|irsc|ati|hesi|test\b/i.test(t) ? "school" : /run|race|marathon|lift|gym|train|5k|10k/i.test(t) ? "run" : "build";
const KNAME = {work: "Work", school: "School", run: "Training", build: "Mileset", vesper: "Vesper"};
const dayName = iso => { const d = new Date(iso + "T12:00:00"), t = new Date(); return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === new Date(Date.now() + 864e5).toDateString() ? "Tomorrow" : d.toLocaleDateString([], {weekday: "short", month: "short", day: "numeric"}); };
const until = iso => Math.round((Date.parse(iso + "T12:00:00") - Date.now()) / 864e5);
function personalBrief(){ const me = M.me; if (!me) return `<section>${empty("your agenda", M.locked ? "Unlock HQ to see it." : "Arrives with Vesper's next feed update.")}</section>`;
  const t = (me.days[0] || [0, []])[1]; return `<section><h3>Today</h3>${t.length ? t.map(a => `<div class="day"><time>${esc(a[2] || "any time")}</time><div><span class="tag ${KIND(a[0] + " " + a[1])}">${KNAME[KIND(a[0] + " " + a[1])]}</span>${esc(a[1])}</div></div>`).join("") : `<p class="mut">Nothing on your agenda today.</p>`}</section><section class="acts"><button class="btn cy" data-go="me">Open your wing</button></section>`; }
let audio = null;
function vMe(){ const me = M.me, h2 = M.h2, acct = S.me; let h = "";
  // 12 daily focus radar
  h += `<section class="card glass wide"><h2>Daily focus</h2><p class="sub">What needs you today, and what Vesper is carrying while you're busy.</p>`;
  if (!me) h += empty("your agenda and calendar", M.locked ? "Unlock HQ to see it." : "Arrives with Vesper's next feed update.");
  else { const today = (me.days[0] || [0, []])[1], cal = (me.cal || []).filter(c => String(c[0]).slice(0, 10) === new Date().toLocaleDateString("en-CA")), busy = STN.filter(s => s._i && s._i.s === "working" && !s.helm).map(s => s.name);
    h += `<div class="kpis"><div class="kpi"><span>Needs you today</span><b>${today.length + cal.length + M.calls.length}</b><em>${M.calls.length ? M.calls.length + " business call" + (M.calls.length > 1 ? "s" : "") : "nothing from the business"}</em></div><div class="kpi"><span>Vesper is handling</span><b>${busy.length + M.queue.length}</b><em>${busy.length ? esc(busy.join(", ")) + " working" : M.queue.length ? M.queue.length + " change" + (M.queue.length > 1 ? "s" : "") + " queued to ship" : "all quiet"}</em></div><div class="kpi"><span>Overdue</span><b>${(me.overdue || []).length}</b><em>${(me.overdue || []).length ? esc(cut(me.overdue[0][1], 30)) : "nothing overdue"}</em></div></div>`;
    h += today.length || cal.length ? [...today.map(a => [a[2], a[1], KIND(a[0] + " " + a[1]), a[3]]), ...cal.map(c => [String(c[0]).slice(11, 16), c[1], KIND(c[1]), ""])].sort((a, b) => (a[0] || "99") < (b[0] || "99") ? -1 : 1).map(a => `<div class="day"><time>${esc(a[0] || "any time")}${a[3] ? "<br>" + esc(a[3]) : ""}</time><div><span class="tag ${a[2]}">${KNAME[a[2]]}</span>${esc(a[1])}</div></div>`).join("") : `<p class="mut">Nothing scheduled today. A clear runway.</p>`;
    const week = me.days.slice(1).filter(d => d[1].length);
    if (week.length) h += `<h3 class="cardh" style="margin:14px 0 2px">Coming up</h3>` + week.slice(0, 5).map(d => `<div class="day"><time>${esc(dayName(d[0]).slice(0, 10))}</time><div>${d[1].map(a => `<span class="tag ${KIND(a[0] + " " + a[1])}">${esc(a[2] || KNAME[KIND(a[0] + " " + a[1])])}</span>${esc(a[1])}`).join("<br>")}</div></div>`).join("");
    if ((me.todos || []).length) h += `<h3 class="cardh" style="margin:14px 0 2px">To-dos</h3><div class="rows">${me.todos.map(t => `<div class="row"><div class="g"><b>${esc(t)}</b></div></div>`).join("")}</div>`; }
  // 13 nursing school and exam prep
  const exams = (h2.exams || (me ? me.days.flatMap(d => d[1].filter(a => a[0] === "deadline" || /exam|quiz|test\b/i.test(a[1])).map(a => [d[0], a[1]])) : [])).filter(e => KIND(e[1]) === "school" || /exam|quiz/i.test(e[1]));
  const decks = [...HQ.ls.get("hq-decks", []), ...(h2.study || [])], cards = decks.flatMap(d => d.cards || []), canSpeak = "speechSynthesis" in window;
  h += `</section><section class="card glass"><h2>Nursing school and exam prep</h2><p class="sub">Exam countdowns and hands-free recall for the drive to campus.</p>`;
  h += exams.length ? `<div class="rows">${exams.slice(0, 6).map(e => `<div class="row"><div class="g"><b>${esc(e[1])}</b><span>${esc(dayName(e[0]))}</span></div><span class="chip" data-s="${until(e[0]) <= 3 ? "waiting" : "idle"}"><i></i>${until(e[0]) <= 0 ? "today" : until(e[0]) + " day" + (until(e[0]) > 1 ? "s" : "")}</span></div>`).join("")}</div>` : me ? `<p class="mut">No exams on your agenda. Add one below ("Pharm exam Dec 3").</p>` : empty("exam dates", "They come from your agenda in Vesper's feed.");
  h += `<h3 class="cardh" style="margin:14px 0 6px">Audio study review <span class="r">${cards.length} card${cards.length === 1 ? "" : "s"}</span></h3>`;
  h += cards.length ? `<div class="acts"><button class="btn cy" data-audio="${audio ? "stop" : "play"}" ${canSpeak ? "" : "disabled"}>${audio ? "■ Stop" : "▶ Play active recall"}</button>${canSpeak ? "" : `<span class="mut sm">This browser can't read aloud.</span>`}</div><p class="mut sm" style="margin:8px 0 0" id="audio-now">${audio ? "" : "Reads each question, pauses so you can answer out loud, then reads the answer."}</p>` : `<div class="empty"><div><b>No study cards yet.</b><br>Add your first one here, or tell Vesper "make me a study deck on beta blockers" and it shows up by itself.</div></div>`;
  h += `<div style="display:grid;gap:8px;margin-top:12px"><input type="text" id="card-q" placeholder="Question (e.g. Antidote for heparin?)" aria-label="Question"><input type="text" id="card-a" placeholder="Answer" aria-label="Answer"><div class="acts"><button class="btn" data-addcard>Add card</button>${HQ.ls.get("hq-decks", []).length ? `<button class="btn" data-clearcards>Clear my cards</button>` : ""}</div></div>`;
  // 14 running, marathon and recovery
  h += `</section><section class="card glass"><h2>Running, races and recovery</h2><p class="sub">Read from your own Mileset account on this device. Never sent anywhere else.</p>`;
  const races = (h2.races || []).map(r => ({day: r[0], name: r[1]}));
  if (acct){ let pr = acct.profile || acct.plan || {}; if (typeof pr === "string") try { pr = JSON.parse(pr); } catch(e){ pr = {}; } if (pr.raceDate && !races.some(r => r.day === pr.raceDate)) races.unshift({day: pr.raceDate, name: "Your Mileset goal race"}); }
  const fut = races.filter(r => until(r.day) >= 0).sort((a, b) => a.day < b.day ? -1 : 1);
  h += fut.length ? `<div class="kpis">${fut.slice(0, 3).map(r => `<div class="kpi"><span>${esc(cut(r.name, 34))}</span><b>${until(r.day)}</b><em>days · ${esc(new Date(r.day + "T12:00:00").toLocaleDateString([], {month: "short", day: "numeric", year: "numeric"}))}</em></div>`).join("")}</div>` : `<div class="empty"><div><b>No race on the calendar.</b><br>Add one and its countdown shows here.</div></div><div class="acts" style="margin-top:8px"><button class="btn sm" data-pal="add race: Sydney Marathon on ">Add a race date</button></div>`;
  if (!acct) h += `<div style="margin-top:12px">` + empty("weekly mileage and recovery", S.meErr === "offline" ? "Couldn't reach your Mileset account just now." : "Sign in to Mileset in this browser (app.hybrdrunning.com) and it appears here.") + `</div>`;
  else { const acts = acct.activities || [], mon = d => { const x = new Date(d); x.setHours(12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toLocaleDateString("en-CA"); }, wk = {};
    for (const a of acts) if (a.type === "run" && a.mi > 0) wk[mon(a.date + "T12:00:00")] = (wk[mon(a.date + "T12:00:00")] || 0) + a.mi;
    const weeks = [...Array(6)].map((_, i) => mon(Date.now() - (5 - i) * 7 * 864e5)), vals = weeks.map(w => Math.round((wk[w] || 0) * 10) / 10), ci = (acct.checkins || []).slice(-1)[0], d7 = new Date(Date.now() - 6 * 864e5).toLocaleDateString("en-CA");
    const foodDays = new Set((acct.food || []).filter(f => f.date >= d7).map(f => f.date)).size, trainDays = new Set([...(acct.done || []).map(k => String(k).slice(0, 10)), ...acts.map(a => a.date)].filter(d => d >= d7)).size;
    h += `<div class="kpis" style="margin-top:12px"><div class="kpi"><span>Miles this week</span><b>${vals[5]}</b><em>last week ${vals[4]}</em></div><div class="kpi"><span>Trained, last 7 days</span><b>${trainDays}/7</b></div><div class="kpi"><span>Food logged, last 7 days</span><b>${foodDays}/7</b></div><div class="kpi"><span>Last sleep</span><b>${ci && ci.sleep_h ? ci.sleep_h + " h" : "–"}</b><em>${ci ? "energy " + (ci.energy || "–") + "/5 · " + esc(dayName(ci.date)) : "no check-in yet"}</em></div></div>${sline(vals)}<p class="dim xs" style="margin:2px 0 0">Running miles per week, last 6 weeks</p>`; }
  // 15 quick capture
  const caps = S.out.filter(r => r.cmd && r.cmd.t === "capture").slice(0, 5), st = r => ({sending: "Sending…", sent: "Sent to Vesper", done: "Filed", failed: "Couldn't file", queued: "Waiting for signal", manual: "Copied for Telegram", locked: "Locked"})[r.st] || r.st;
  h += `</section><section class="card glass wide"><h2>Quick capture</h2><p class="sub">Errand, reminder, idea: type it and go. Vesper files it as a reminder, an agenda item or a task.</p>
    <textarea id="cap" rows="3" placeholder="e.g. Pick up scrubs Thursday · Remind me to email my clinical instructor at 5 · Idea: streak badges" aria-label="Quick capture"></textarea><div class="acts" style="margin-top:8px"><button class="btn cy" data-capture>Send to Vesper</button></div>
    ${caps.length ? `<div class="rows" style="margin-top:10px">${caps.map(r => `<div class="row"><div class="g"><b>${esc(cut(r.cmd.text, 90))}</b><span>${esc(r.say ? plain(r.say) : ago(r.at))}</span></div>${badge(r.st)}</div>`).join("")}</div>` : ""}
    ${me && (me.rem || []).length ? `<h3 class="cardh" style="margin:14px 0 2px">Upcoming reminders</h3><div class="rows">${me.rem.slice(0, 5).map(r => `<div class="row"><div class="g"><b>${esc(r[1])}</b><span>${esc(when(r[0]))}${r[2] ? " · repeats " + esc(r[2]) : ""}</span></div></div>`).join("")}</div>` : ""}`;
  if (HQ.IOS_BROWSER && HQ.keyStr()) h += `<p class="dim sm" style="margin-top:14px">Put HQ on your home screen from this page: tap Share, then Add to Home Screen. It opens unlocked. Don't send this page to anyone: its address carries your key.</p>`;
  return h + `</section><p class="dim sm wide" style="text-align:center;margin:4px 0 0"><a href="./next/">Open the previous HQ</a></p>`; }
function playCards(){ const decks = [...HQ.ls.get("hq-decks", []), ...(M.h2.study || [])], cards = decks.flatMap(d => d.cards || []); if (!cards.length || !("speechSynthesis" in window)) return;
  let i = 0; audio = {on: true}; const me = audio, now = t => { const el = $("#audio-now"); if (el) el.textContent = t; };
  const say = (t, then) => { const u = new SpeechSynthesisUtterance(t); u.rate = .98; u.onend = () => me.on && then(); speechSynthesis.speak(u); };
  const next = () => { if (!me.on) return; if (i >= cards.length){ stopCards(); return; } const [q, a] = cards[i++]; now("Card " + i + " of " + cards.length + ": " + q);
    say("Question " + i + ". " + q, () => setTimeout(() => me.on && say("Answer. " + a, () => setTimeout(next, 1200)), 4000)); };
  drawView(true); next(); }
function stopCards(){ if (audio) audio.on = false; audio = null; try { speechSynthesis.cancel(); } catch(e){} drawView(true); }
function drawView(force){ if (view === "floor") return; const a = document.activeElement; if (!force && a && views.contains(a) && /INPUT|TEXTAREA/.test(a.tagName)) return;
  const keep = {}; for (const el of $$("input,textarea", views)) if (el.id) keep[el.id] = el.value; const y = views.scrollTop;
  if (setHTML(views, `<div class="view">${view === "ship" ? vShip() : view === "members" ? vMembers() : view === "company" ? vCompany() : vMe()}</div>`)){ for (const id in keep){ const el = document.getElementById(id); if (el) el.value = keep[id]; } views.scrollTop = y; }
  if (view === "ship") for (const p of [...M.needs, ...M.queue].slice(0, 5)) if (!S.checks[p.sha]) HQ.loadChecks(p); }

// ---------- HQ tabs, batch 1 (Nov 20 9:24pm): Pipeline board + Members. Every read is $0 (Vesper's plain code). ----------
const STAGES = ["Awaiting Telegram Tap", "Tests Failing", "Running Tests", "Queued for Gate", "Held", "Draft", "Open", "Live"];
const LAYERS = ["HQ Frontend", "Cloudflare Worker / D1", "Mileset App & Site", "Vesper Relay (server)", "Vesper Relay (Mac)", "Tests & CI"];
const stS = st => ({"Awaiting Telegram Tap": "waiting", "Tests Failing": "alert", "Running Tests": "working", "Queued for Gate": "working", Held: "paused", Draft: "idle", Open: "idle", Live: "ok"})[st] || "idle";
const chS = ch => ch === "pass" ? chip("ok", "Tests pass") : ch === "fail" ? chip("alert", "Tests fail") : ch === "pending" ? chip("working", "Tests running") : "";
const PF = {layer: "all", stage: "all", view: phone() ? "list" : "board"};
const nextGate = () => { const G = S.tel && S.tel.gate, t = G && G.next_run ? Date.parse(G.next_run) : M.nextRun; return t && t > Date.now() - 60e3 ? t : null; };
const cdText = () => { const t = nextGate(); if (!t) return "--:--"; const s = Math.max(0, Math.round((t - Date.now()) / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
setInterval(() => { const el = document.getElementById("cd"); if (el) el.textContent = cdText(); }, 1000);
const pipeItems = () => (S.tel && Array.isArray(S.tel.pipe) ? S.tel.pipe : null);
const pkey = it => it.r + ":" + it.n;
function vPipe(){ const items = pipeItems();
  let h = `<section class="card glass wide" id="c-pipe"><h2>Pipeline</h2><p class="sub">Every held, queued, testing and shipped change across HQ, the Worker, the app and Vesper. Read from GitHub by Vesper's plain code: $0.</p>
    <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 12px"><span class="dim sm">Next ship-gate run in</span><span class="cd" id="cd">${cdText()}</span>${nextGate() ? `<span class="dim sm">(${esc(when(nextGate()))})</span>` : ""}</div>`;
  if (!items) return h + empty("the full pipeline", S.telOn === false || !HQ.keyStr() ? "It arrives with Vesper's heartbeat once HQ is unlocked." : "Arrives with Vesper's next heartbeat (within a minute).") + `</section>`;
  const pill = (k, v, label, n) => `<button type="button" data-pf="${k}:${esc(v)}" aria-pressed="${PF[k] === v}">${esc(label)}${n != null ? " · " + n : ""}</button>`;
  const lay = LAYERS.filter(l => items.some(i => i.loc.includes(l))), stg = STAGES.filter(s => items.some(i => i.st === s));
  h += `<div class="pills" aria-label="Filter by layer">${pill("layer", "all", "All layers")}${lay.map(l => pill("layer", l, l, items.filter(i => i.loc.includes(l)).length)).join("")}</div>
    <div class="pills" aria-label="Filter by stage">${pill("stage", "all", "All stages")}${stg.map(s => pill("stage", s, s, items.filter(i => i.st === s).length)).join("")}<span style="flex:1"></span>${pill("view", "board", "Board")}${pill("view", "list", "Table")}</div>`;
  const shown = items.filter(i => (PF.layer === "all" || i.loc.includes(PF.layer)) && (PF.stage === "all" || i.st === PF.stage));
  const card = i => `<button type="button" class="pc" data-pi="${esc(pkey(i))}"><b>${esc(plain(i.t))} <span class="dim num">${i.r === "vesper" ? "Vesper " : ""}#${i.n}</span></b><div class="meta">${i.loc.map(l => `<span class="loc" data-l="${esc(l)}">${esc(l)}</span>`).join("")}</div><div class="meta">${PF.view === "list" || PF.stage !== "all" ? chip(stS(i.st), i.st) : ""}${chS(i.ch)}${i.files ? `<span class="dim xs">${i.files} file${i.files > 1 ? "s" : ""}${i.add != null ? ` · +${i.add} −${i.del}` : ""}</span>` : ""}</div></button>`;
  if (!shown.length) h += `<p class="mut">Nothing matches those filters.</p>`;
  else if (PF.view === "board") h += `<div class="board">${STAGES.filter(s => shown.some(i => i.st === s)).map(s => `<div class="col"><h3><span>${esc(s)}</span><span>${shown.filter(i => i.st === s).length}</span></h3>${shown.filter(i => i.st === s).map(card).join("")}</div>`).join("")}</div>`;
  else h += `<div>${shown.map(card).join("")}</div>`;
  return h + `<p class="dim xs" style="margin:8px 0 0">Updated ${esc(ago((S.tel.at || 0) * 1000))}. Tap a change for its diff summary, tests and actions.</p></section>`; }
function openPipe(k){ const it = (pipeItems() || []).find(i => pkey(i) === k); if (!it) return;
  const held = it.st === "Held", is111 = it.r === "app" && it.n === 111;
  const act = is111 ? `<p class="mut sm">#111 stays held and isolated by your standing word. HQ never sends a command for it.</p>`
    : it.st === "Awaiting Telegram Tap" ? `<button class="btn go" data-cmd='${esc(JSON.stringify(it.r === "vesper" ? {t: "install", n: it.n} : {t: "ship", n: it.n}))}' data-label="${it.r === "vesper" ? "Install Vesper upgrade" : "Approve"} #${it.n}">Request approval</button>`
    : held ? `<button class="btn" data-cmd='${esc(JSON.stringify({t: "unhold", n: it.n}))}' data-label="Release hold on #${it.n}">Release hold</button>`
    : it.r === "app" && it.st !== "Live" ? `<button class="btn warn" data-cmd='${esc(JSON.stringify({t: "hold", n: it.n}))}' data-label="Hold #${it.n}">Hold</button>` : "";
  openDrawer("pipe:" + k, plain(it.t), (it.r === "vesper" ? "Vesper upgrade #" : "App change #") + it.n + " · " + (it.st === "Live" ? "went live " : "opened ") + ago(Date.parse(it.at)),
    `<section>${chip(stS(it.st), it.st)} ${chS(it.ch)}<div class="meta" style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${it.loc.map(l => `<span class="loc" data-l="${esc(l)}">${esc(l)}</span>`).join("")}</div></section>
     <section><h3>What changes</h3><p style="margin:0">${esc(plain(it.sum) || "No description.")}</p><p class="dim sm" style="margin:8px 0 0">${it.files} file(s)${it.add != null ? `, +${it.add} −${it.del} lines` : ""}</p></section>
     <section><h3>Tests</h3>${it.ch === "fail" ? `<p style="margin:0">Failing: ${esc((it.bad || []).join(", ") || "see GitHub")}</p>` : it.ch === "pending" ? `<p class="mut" style="margin:0">Running now.</p>` : it.ch === "pass" ? `<p style="margin:0">All checks passed.</p>` : `<p class="mut" style="margin:0">No checks on this change.</p>`}</section>
     <section class="acts">${act}${it.u ? `<a class="btn" href="${esc(it.u)}" target="_blank" rel="noopener">Open on GitHub</a>` : ""}</section>`); }

const MS = {q: "", f: "all", sort: "seen", dir: -1}; let memRec = null;
function loadRoster(fresh){ HQ.ask({t: "read", q: "members", f: MS.f, arg: MS.q}, fresh).then(r => { if (r){ memRec = r; drawView(true); } }); }
const fmtDay = s => s ? (Date.now() - Date.parse(s.replace(" ", "T")) < 864e5 * 2 ? ago(Date.parse(s.replace(" ", "T") + (s.length > 10 && !/Z|\+/.test(s) ? "Z" : ""))) : s.slice(0, 10)) : "never";
function vMembers(){ const K = S.tel && S.tel.members, k = K && !K.err ? K : null;
  const kp = (v, l) => `<div class="kpi"><b>${v == null ? "–" : v}</b><span>${esc(l)}</span></div>`;
  let h = `<section class="card glass wide" id="c-kpis"><h2>Members &amp; app pulse</h2><p class="sub">Live from the Mileset database (read-only, your own accounts and test robots left out). Counts refresh every 5 minutes: $0.</p>`;
  h += k ? `<div class="kpis">${kp(k.total, "Total members")}${kp(k.a24, "Active 24h")}${kp(k.a7, "Active 7d")}${kp(k.a30, "Active 30d")}${kp(k.new24, "New today")}${kp(k.new7, "New 7d")}${kp(k.risk, "At risk")}${kp(k.sessions_today, "Sessions done today")}${kp(k.meals_today, "Meals logged today")}</div>`
    : empty("member counts", K && K.err ? "Vesper couldn't read the database just now (" + K.err + ")." : "They arrive with Vesper's heartbeat once HQ is unlocked.");
  h += `</section><section class="card glass wide" id="c-roster"><h2>Roster</h2><p class="sub">Names and emails come straight to this screen, sealed with your key. They're never saved on this device.</p>
    <div class="srch"><input id="m-q" type="search" placeholder="Search name or email" autocomplete="off" value="${esc(MS.q)}"><button class="btn" data-msearch="1">Search all</button></div>
    <div class="pills">${[["all", "All"], ["active", "Active"], ["new", "New"], ["risk", "At-risk"]].map(([v, l]) => `<button type="button" data-mf="${v}" aria-pressed="${MS.f === v}">${l}</button>`).join("")}</div>`;
  const r = memRec, rows = r && r.result && Array.isArray(r.result.rows) ? r.result.rows : null;
  if (!rows) h += r && (r.st === "failed" || r.st === "rejected") ? `<p class="mut">Vesper couldn't load the roster: ${esc(plain(r.say || "try again"))}</p>` : empty("the roster", HQ.keyStr() ? "Asking Vesper (a few seconds)." : "Unlock HQ first.");
  else { const loc = MS.q && !(r.result.q) ? rows.filter(x => (x[1] + " " + x[2]).toLowerCase().includes(MS.q.toLowerCase())) : rows;
    const col = {name: 1, joined: 3, seen: 4, s7: 5, f7: 6}[MS.sort], sorted = [...loc].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * MS.dir);
    const th = (k, l, cls) => `<th data-ms="${k}" class="${cls || ""}" aria-sort="${MS.sort === k ? (MS.dir > 0 ? "ascending" : "descending") : "none"}">${l}${MS.sort === k ? (MS.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    h += `<p class="dim sm" style="margin:0 0 6px">${esc(r.result.lines[0] || "")}${loc.length !== rows.length ? ` · ${loc.length} shown` : ""}</p><div style="overflow-x:auto"><table class="tbl"><thead><tr>${th("name", "Member")}${th("joined", "Joined", "hide-s")}${th("seen", "Last seen")}${th("s7", "Sessions 7d")}${th("f7", "Meal days 7d", "hide-s")}</tr></thead><tbody>`
      + sorted.map(x => `<tr data-mr="${esc(x[0])}" tabindex="0"><td><b>${esc(x[1] || "(no name)")}</b>${x[7] ? " " + chip("waiting", "Flagged") : ""}<div class="e">${esc(x[2])}</div></td><td class="hide-s">${esc(x[3])}</td><td>${esc(fmtDay(x[4]))}</td><td>${x[5]}</td><td class="hide-s">${x[6]}</td></tr>`).join("") + `</tbody></table></div>`; }
  return h + `</section>`; }
function openMember(uid){ const row = ((memRec && memRec.result && memRec.result.rows) || []).find(x => x[0] === uid), name = row ? row[1] || "Member" : "Member";
  const body = rec => { const m = rec && rec.result && rec.result.m;
    if (!m) return `<section>${rec && (rec.st === "failed" || rec.st === "rejected") ? `<p class="mut">${esc(plain(rec.say || "Couldn't load this member."))}</p>` : `<p class="mut">Loading from Vesper…</p>`}</section>`;
    const who = (m.name || "member").split(" ")[0], c = act => esc(JSON.stringify({t: "member", act, uid: m.id, who}));
    return `<section><div class="kpis">${[[m.joined, "Joined"], [m.seen ? fmtDay(m.seen) : "never", "Last seen"], [m.streak + "d", "Streak"], [m.sessions, "Sessions total"], [m.food7 + "/7", "Meal days"]].map(([v, l]) => `<div class="kpi"><b style="font-size:17px">${esc(v)}</b><span>${l}</span></div>`).join("")}</div></section>
      <section><h3>Email</h3><p class="e" style="margin:0 0 6px">${esc(m.email)}</p>${m.mails.length ? `<div class="rows">${m.mails.map(x => `<div class="row"><div class="g"><b>${esc(String(x[0]).replace(/_/g, " "))}</b><span>${esc(x[1])}</span></div>${chip(x[2] ? "ok" : "alert", x[2] ? "Sent" : "Failed")}</div>`).join("")}</div>` : `<p class="mut sm">No lifecycle emails sent yet.</p>`}${m.no_mail ? `<p class="mut sm">Opted out of update emails (password resets still arrive).</p>` : ""}</section>
      <section><h3>Admin actions</h3><p class="dim sm" style="margin:0 0 8px">Each one waits for your Approve in Telegram.</p><div class="acts">
        <button class="btn go" data-cmd='${c("reset")}' data-label="Password reset email to ${esc(who)}">Send password reset</button>
        <button class="btn${m.flag ? "" : " warn"}" data-cmd='${c(m.flag ? "unflag" : "flag")}' data-label="${m.flag ? "Unflag" : "Flag"} ${esc(who)}">${m.flag ? "Remove flag" : "Flag account"}</button>
        <button class="btn" disabled title="Mileset signs in with a password; there are no magic links">Magic link</button>
        <button class="btn" disabled title="Mileset has no trials: the Founding 100 are free for life">Grant trial days</button>
        <button class="btn" disabled title="Needs a new admin endpoint on the Worker (a security change that waits for your SHIP IT)">Resend welcome</button></div>
        <p class="dim xs" style="margin:8px 0 0">Magic links, trials and welcome resends aren't part of Mileset yet, so those stay off rather than pretend.</p></section>`; };
  openDrawer("member:" + uid, name, "Member", body(null));
  HQ.ask({t: "read", q: "member", arg: uid}).then(rec => { if (!rec) return; const upd = () => { if (drawerKey === "member:" + uid) $(".db", drawer).innerHTML = body(rec); };
    upd(); const iv = setInterval(() => { upd(); if (FINAL_ST.includes(rec.st) || drawerKey !== "member:" + uid) clearInterval(iv); }, 500); }); }
const FINAL_ST = ["completed", "failed", "rejected"];
views.addEventListener("click", e => { const b = e.target.closest("[data-pf],[data-pi],[data-mf],[data-ms],[data-msearch],[data-mr]"); if (!b) return;
  if (b.dataset.pf){ const [k, v] = b.dataset.pf.split(/:(.*)/); PF[k] = v; drawView(true); return; }
  if (b.dataset.pi){ openPipe(b.dataset.pi); return; }
  if (b.dataset.mf){ MS.f = b.dataset.mf; loadRoster(); drawView(true); return; }
  if (b.dataset.ms){ const k = b.dataset.ms; MS.dir = MS.sort === k ? -MS.dir : (k === "name" ? 1 : -1); MS.sort = k; drawView(true); return; }
  if (b.dataset.msearch){ MS.q = ($("#m-q") || {}).value || ""; loadRoster(true); return; }
  if (b.dataset.mr){ openMember(b.dataset.mr); } });
views.addEventListener("input", e => { if (e.target.id === "m-q"){ MS.q = e.target.value; const was = document.activeElement === e.target, pos = e.target.selectionStart; drawView(true); const el = $("#m-q"); if (was && el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(_){} } } });
views.addEventListener("keydown", e => { if (e.target.id === "m-q" && e.key === "Enter"){ MS.q = e.target.value; loadRoster(true); }
  const tr = e.target.closest && e.target.closest("tr[data-mr]"); if (tr && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openMember(tr.dataset.mr); } });
// 1-7 switch tabs (when not typing). 5 and 6 (Growth, Client Sites) arrive with batch 3; 5 opens Company for now.
const TABKEYS = {1: "floor", 2: "ship", 3: "members", 4: "company", 5: "company", 7: "me"};
addEventListener("keydown", e => { if (e.metaKey || e.ctrlKey || e.altKey || !pal.hidden) return; const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) || a && a.isContentEditable) return;
  const v = TABKEYS[e.key]; if (v){ e.preventDefault(); closeDrawer(); show(v); } });

// ---------- one click handler for every action button ----------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-cmd],[data-say],[data-pal],[data-go],[data-pr],[data-idea],[data-capture],[data-addcard],[data-clearcards],[data-audio]"); if (!b || b.closest("#pal .sug")) return;
  if (b.disabled) return;
  if (b.dataset.cmd){ e.stopPropagation(); const c = JSON.parse(b.dataset.cmd); if (HQ.blocked(c)){ send(c); return; } send(c, b.dataset.label); const acts = b.closest(".acts");
    if (acts && !b.closest(".step") && !b.closest("#call")) acts.innerHTML = `<span class="sent">${HQ.tier(c) === 1 ? "✓ " + esc(b.dataset.label || "Done") : "Sent: approve it in Telegram"}</span>`; if (drawerKey && /^pr:|idea/.test(drawerKey)) closeDrawer(); return; }
  if (b.dataset.say != null && !b.dataset.pal){ send({t: "text", text: b.dataset.say}, b.dataset.label || b.dataset.say); return; }
  if (b.dataset.pal != null){ openPal(b.dataset.pal); return; }
  if (b.dataset.go){ closeDrawer(); show(b.dataset.go); return; }
  if (b.dataset.idea != null){ openIdea(+b.dataset.idea); return; }
  if (b.dataset.pr){ openPR(+b.dataset.pr); return; }
  if (b.dataset.capture != null){ const t = $("#cap"), v = t.value.trim(); if (!v) return t.focus(); t.value = ""; send({t: "capture", text: v}, "Captured: " + cut(v, 40)).then(() => drawView(true)); return; }
  if (b.dataset.addcard != null){ const q = $("#card-q"), a = $("#card-a"); if (!q.value.trim() || !a.value.trim()) return (q.value.trim() ? a : q).focus();
    const d = HQ.ls.get("hq-decks", []); if (!d.length) d.push({name: "My cards", cards: []}); d[0].cards.push([q.value.trim(), a.value.trim()]); HQ.ls.set("hq-decks", d); q.value = a.value = ""; drawView(true); return; }
  if (b.dataset.clearcards != null){ HQ.ls.set("hq-decks", []); drawView(true); return; }
  if (b.dataset.audio){ b.dataset.audio === "play" ? playCards() : stopCards(); } });

// ---------- command bar (⌘K, or the floating pill on a phone) ----------
const pal = $("#pal"); let palSel = 0;
function sugs(q){ const L = [["Status", {t: "read", q: "status"}, "instant"], ["Ship queue", {t: "read", q: "queue"}, "instant"], ["Spend today", {t: "read", q: "spend"}, "instant"],
    ["Health check", {t: "read", q: "health"}, "instant"], ["Recent log", {t: "read", q: "log"}, "instant"], ["Ship gate", {t: "read", q: "gate"}, "instant"], ["I'm in class: hold non-urgent messages", {t: "focus", mode: "class"}, "focus"], ["Back to normal alerts", {t: "focus", mode: "normal"}, "focus"], ["Pause workers and spend", {t: "focus", mode: "paused"}, "focus"], ["I'm going over budget", "going over budget", "spend hold"],
    ...M.needs.map(p => ["Approve #" + p.n + ": " + cut(plain(p.t), 40), {t: "ship", n: p.n}, "ship gate"]), ...M.queue.map(p => ["Hold #" + p.n + ": " + cut(plain(p.t), 40), {t: "hold", n: p.n}, "ship gate"]),
    ...["Growth Sprint", "Dev Lead", "Product Lead"].map(r => ["Run " + r + " now", "run " + r.toLowerCase() + " now", "dispatch"])];
  const s = q.trim().toLowerCase(), go = [["Go to Command floor", {go: "floor"}, "1"], ["Go to Pipeline", {go: "ship"}, "2"], ["Go to Members", {go: "members"}, "3"], ["Go to Company & finance", {go: "company"}, "4"], ["Go to Me & planner", {go: "me"}, "7"]];
  const extra = [], num = s.match(/^#?(\d{1,5})$/);
  if (num) for (const it of (pipeItems() || []).filter(i => String(i.n) === num[1])) extra.push(["Open " + (it.r === "vesper" ? "Vesper " : "") + "#" + it.n + ": " + cut(plain(it.t), 40), {pipe: pkey(it)}, it.st]);
  const fm = q.trim().match(/^(?:@|find |member )\s*(.{2,})$/i); if (fm) extra.push(["Find member: " + fm[1], {member: fm[1]}, "search"]);
  return [...extra, ...(s ? [...go, ...L].filter(x => x[0].toLowerCase().includes(s)) : L)].slice(0, 8); }
function drawPal(){ const inp = $("#pal input"), q = inp ? inp.value : "", L = sugs(q), th = S.out.slice(0, 4).reverse();
  const cmdOf = c => typeof c === "string" ? {t: "text", text: c} : c, tag = (c, x) => c && (c.go || c.pipe || c.member != null) ? (x || "") : HQ.blocked(cmdOf(c)) ? "paused" : HQ.tier(cmdOf(c)) === 1 ? "instant" : "needs Telegram OK";
  $("#pal .sug").innerHTML = L.map((x, i) => `<button type="button" class="${i === palSel ? "sel" : ""}" data-i="${i}"${!(x[1].go || x[1].pipe || x[1].member != null) && HQ.blocked(cmdOf(x[1])) ? " disabled" : ""}>${esc(x[0])}<span>${esc(tag(x[1], x[2]))}</span></button>`).join("") + (q.trim() ? `<button type="button" class="${palSel >= L.length ? "sel" : ""}" data-i="-1">Send "${esc(cut(q.trim(), 60))}" to Vesper<span>${esc(tag(q.trim()))}</span></button>` : "");
  $("#pal .thread").innerHTML = th.map(r => `<div class="msg me">${esc(r.label)}<small>${badge(r.st)} · ${esc(ago(r.at))}</small></div>${r.say || r.result ? `<div class="msg v">${r.say && !r.result ? esc(plain(r.say)) : ""}${result(r)}</div>` : ""}`).join(""); pal._L = L; }
function openPal(pre){ pal.hidden = false; palSel = 0; pal.innerHTML = `<div class="box glass solid" role="dialog" aria-label="Command bar"><div class="thread"></div><input type="text" placeholder="Tell Vesper something, or pick below" aria-label="Command" autocomplete="off" autocapitalize="sentences"><div class="sug"></div><p class="dim xs" style="margin:0;text-align:center">${S.box.on === false ? "The command link isn't live yet: commands are copied for you to paste in Telegram." : "Instant reads run at once. Anything that changes something waits for your Approve in Telegram."}</p></div>`;
  const inp = $("#pal input"); inp.value = pre || ""; drawPal(); setTimeout(() => inp.focus(), 30);
  inp.oninput = () => { palSel = inp.value.trim() ? (sugs(inp.value).length ? 0 : 0) : 0; drawPal(); };
  inp.onkeydown = e => { const n = pal._L.length + (inp.value.trim() ? 1 : 0); if (e.key === "ArrowDown"){ palSel = (palSel + 1) % Math.max(1, n); drawPal(); e.preventDefault(); } else if (e.key === "ArrowUp"){ palSel = (palSel - 1 + n) % Math.max(1, n); drawPal(); e.preventDefault(); }
    else if (e.key === "Enter"){ e.preventDefault(); const typed = inp.value.trim(), pick = pal._L[palSel]; if (typed && (!pick || palSel >= pal._L.length || !pick[0].toLowerCase().includes(typed.toLowerCase()))) runPal(typed, typed); else if (pick) runPal(pick[1], pick[0]); } else if (e.key === "Escape") closePal(); }; }
function runPal(c, label){ if (c && typeof c === "object" && (c.go || c.pipe || c.member != null)){ closePal();
    if (c.go) show(c.go); else if (c.pipe){ show("ship"); openPipe(c.pipe); } else { MS.q = c.member; show("members"); loadRoster(true); } return; }
  send(typeof c === "string" ? {t: "text", text: c} : c, label); const inp = $("#pal input"); if (inp){ inp.value = ""; palSel = 0; drawPal(); inp.focus(); } }
function closePal(){ pal.hidden = true; pal.innerHTML = ""; }
pal.addEventListener("click", e => { if (e.target === pal) return closePal(); const b = e.target.closest(".sug button"); if (!b) return; const i = +b.dataset.i, inp = $("#pal input"); i < 0 ? runPal(inp.value.trim(), inp.value.trim()) : runPal(pal._L[i][1], pal._L[i][0]); });
$("#cmdpill").onclick = () => openPal("");
addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"){ e.preventDefault(); pal.hidden ? openPal("") : closePal(); } else if (e.key === "Escape"){ if (!pal.hidden) closePal(); else if (drawerKey) closeDrawer(); } });

// ---------- lock card ----------
function drawLock(){ const el = $("#lock"), need = !HQ.keyStr() || (S.privErr && S.privErr !== "locked" && !S.priv); el.hidden = !need || view !== "floor" || !!drawerKey; if (el.hidden) return;
  el.innerHTML = HQ.keyStr() ? `<h2 style="margin:0 0 6px;font-size:18px">The private office is closed</h2><p class="mut" style="margin:0">${esc(S.privErr)}</p><p class="dim sm" style="margin:10px 0 0">The floor still shows who is working. Words, money and your agenda need the key.</p>`
    : `<h2 style="margin:0 0 6px;font-size:18px">Open HQ from Vesper's private link</h2><p class="mut" style="margin:0">This device doesn't hold your HQ key yet. Tap the HQ link Vesper sent you in Telegram once and everything unlocks here.</p><p class="dim sm" style="margin:10px 0 0">Until then the floor shows only who is working, never the words.</p>`; }

// ---------- draw loop ----------
// Tier 2 actions (anything that changes something) are switched off while the over-budget pause is on; Hold stays.
function lockTier2(){ const paused = HQ.pauseState().paused;
  for (const b of $$("[data-cmd],[data-say]")){ let cmd = null; try { cmd = b.dataset.cmd ? JSON.parse(b.dataset.cmd) : {t: "text", text: b.dataset.say}; } catch(e){ continue; }
    const off = paused && HQ.blocked(cmd); if (b.disabled !== off) b.disabled = off;
    const tt = off ? "Paused: today's spend cap is reached. Lift the pause in Telegram." : HQ.tier(cmd) === 2 ? "Vesper asks you to approve this in Telegram first" : "Runs at once"; if (b.title !== tt) b.title = tt; } }
const STL = {sending: "Sending", queued: "Queued", awaiting_telegram_approval: "Awaiting Telegram approval", running: "Running", completed: "Completed", rejected: "Rejected", failed: "Failed", manual: "Copied for Telegram", offline: "Waiting for signal", locked: "Locked"};
const badge = st => `<span class="badge" data-st="${esc(st)}">${esc(STL[st] || st)}</span>`;
const result = r => r.result && r.result.lines ? `<div class="res"><b>${esc(r.result.title || "")}</b>${r.result.lines.map(l => esc(l)).join("<br>")}</div>` : "";
let queued = false, lastLeft = null;
function draw(){ if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; M = model(); drawFloor(); drawHud(); drawSync(); drawCall(); drawRecap(); drawLock(); drawView(); drawTbar(); if (!pal.hidden) drawPal(); lockTier2();
  const left = [...$("#stack").children].some(c => !c.hidden); if (left !== lastLeft){ lastLeft = left; if (view === "floor" && !drawerKey && !pts.size) fit(lastLeft === null); } }); }
buildFloor(); HQ.on(draw); draw(); fit(true); requestAnimationFrame(() => fit(true));
addEventListener("resize", () => { if (layout()){ buildFloor(); for (const st of STN) delete st._i; draw(); } if (view === "floor" && !drawerKey) fit(true); drawHud(); });
$("#stack").addEventListener("click", () => setTimeout(() => { if (view === "floor" && !drawerKey) fit(); }, 30));
HQ.start();
})();
