import "../plan.js";
import { buildPushPayload } from "@block65/webcrypto-web-push";
const HP = globalThis.HP;
// Hybrid API: accounts, saved plans, workout check-offs, food log and AI food reading.
// Runs on Cloudflare Workers with a D1 database (binding DB). Secrets: ANTHROPIC_API_KEY.
// Auth: email + password (PBKDF2-SHA256, per-user salt); sessions are random bearer tokens,
// stored only as SHA-256 hashes, valid 90 days.
const ORIGINS = ["https://matthewbaconn.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const AI_PER_DAY = 30;            // photo/text food reads per person per day (protects the API bill)
const MAX_IMAGE_B64 = 2_000_000;
const SESSION_DAYS = 90;
const PROMPT = `You estimate nutrition for a training app's food log.
Use the user's description and/or photo. If a nutrition label is visible, use it and the amount eaten.
Otherwise estimate typical portions (US sizes unless stated). Split meals into their main foods.
Reply with ONLY this JSON, nothing else:
{"items":[{"name":"short food name with amount","cal":0,"protein":0,"carbs":0,"fat":0}],"note":"one short sentence on any assumption you made, or empty"}
Numbers are whole calories and grams. If there is no food, return {"items":[],"note":"No food found."}`;

/* ---------- small helpers ---------- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => new Date().toISOString();
const n0 = x => { x = Math.round(Number(x)); return Number.isFinite(x) && x >= 0 && x < 20000 ? x : 0; };
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
class HttpError extends Error { constructor(status, msg){ super(msg); this.status = status; } }

async function sha256(s){ return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hashPassword(password, salt){
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000}, key, 256);
  return hex(bits);
}
function safeEqual(a, b){ if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function corsFor(req){
  const o = req.headers.get("Origin") || "";
  return {"Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", "Vary": "Origin"};
}
const reply = (h, obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {...h, "Content-Type": "application/json", "Cache-Control": "no-store"}});
async function body(req){ try { return await req.json(); } catch { throw new HttpError(400, "Bad request."); } }

async function limit(env, key){
  if (!env.LIMITER) return;
  const { success } = await env.LIMITER.limit({ key });
  if (!success) throw new HttpError(429, "Too many tries. Wait a minute and try again.");
}

async function newSession(env, userId){
  const token = rand(32), t = new Date();
  const exp = new Date(t.getTime() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, t.toISOString(), exp).run();
  return token;
}
async function auth(req, env){
  const m = (req.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) throw new HttpError(401, "Please log in.");
  const row = await env.DB.prepare("SELECT u.id, u.email, u.name, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(await sha256(m[1])).first();
  if (!row || row.expires < now()) throw new HttpError(401, "Your session ended. Please log in again.");
  return row;
}
const userOut = u => ({id: u.id, email: u.email, name: u.name});

/* ---------- AI food reading ---------- */
async function analyze(env, user, b){
  const text = typeof b.text === "string" ? b.text.slice(0, 500) : "";
  const image = typeof b.image === "string" ? b.image : "";
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(b.mediaType) ? b.mediaType : "image/jpeg";
  if (!text.trim() && !image) throw new HttpError(400, "Type what you ate or add a photo.");
  if (image.length > MAX_IMAGE_B64) throw new HttpError(413, "That photo is too large.");
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "Photo reading isn't switched on yet. Enter the numbers for now.");
  const day = now().slice(0, 10);
  const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").bind(user.id, day).first("count");
  if ((used || 0) >= AI_PER_DAY) throw new HttpError(429, "You've hit today's limit of " + AI_PER_DAY + " food reads. Enter the numbers yourself, or try tomorrow.");
  await env.DB.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1").bind(user.id, day).run();

  const content = [];
  if (image) content.push({type: "image", source: {type: "base64", media_type: mediaType, data: image}});
  content.push({type: "text", text: text.trim() ? "What I ate: " + text : "Estimate the food in this photo."});
  const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 800, system: PROMPT, messages: [{role: "user", content}]})
  });
  if (!r.ok){ console.log("anthropic error", r.status, (await r.text()).slice(0, 300)); throw new HttpError(502, "Couldn't read that right now. Try again in a minute."); }
  const out = await r.json();
  const raw = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let parsed;
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw new HttpError(502, "Couldn't read that. Try a clearer photo or add a few words."); }
  const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 12)
    .map(x => ({name: String(x.name || "").slice(0, 80), cal: n0(x.cal), protein: n0(x.protein), carbs: n0(x.carbs), fat: n0(x.fat)})).filter(x => x.name);
  return {items, note: typeof parsed.note === "string" ? parsed.note.slice(0, 200) : ""};
}

/* ---------- Strava ----------
   Secrets STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET; var APP_URL. The Strava app's Authorization Callback
   Domain must be this Worker's host. New Strava apps allow 1 connected athlete until Strava approves more. */
const STRAVA = "https://www.strava.com";
const TYPE_MAP = t => /Run/.test(t) ? "run" : /Ride|Cycl|Bike/.test(t) ? "bike" : /Swim/.test(t) ? "swim" : /Weight|Workout|Crossfit|HIIT|Strength/.test(t) ? "lift" : "other";
function appUrl(env, q){ return (env.APP_URL || "https://matthewbaconn.github.io/Hybrid/") + "?strava=" + q + "#today"; }
async function stravaToken(env, link){
  if (link.expires_at > Date.now() / 1000 + 120) return link.access_token;
  const r = await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/token", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: link.refresh_token})});
  if (!r.ok) throw new HttpError(502, "Strava needs you to reconnect. Open Settings and connect Strava again.");
  const j = await r.json();
  await env.DB.prepare("UPDATE strava_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?").bind(j.access_token, j.refresh_token, j.expires_at, link.user_id).run();
  return j.access_token;
}
async function stravaSync(env, user, ctx){
  const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
  if (!link) throw new HttpError(400, "Strava isn't connected.");
  const tok = await stravaToken(env, link), base = env.STRAVA_BASE || STRAVA;
  const since = link.last_sync ? Math.floor(Date.parse(link.last_sync) / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 30 * 86400;
  const r = await fetch(base + "/api/v3/athlete/activities?per_page=100&after=" + since, {headers: {Authorization: "Bearer " + tok}});
  if (r.status === 429) throw new HttpError(429, "Strava is busy. Try again in a few minutes.");
  if (!r.ok) throw new HttpError(502, "Couldn't reach Strava right now.");
  const list = await r.json(), t = now();
  const known = new Set((await env.DB.prepare("SELECT ext_id FROM activities WHERE user_id = ? AND source = 'strava'").bind(user.id).all()).results.map(x => x.ext_id));
  const ops = list.slice(0, 100).map(a => env.DB.prepare(
    "INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, created) VALUES (?, ?, 'strava', ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id, source, ext_id) DO UPDATE SET date = excluded.date, type = excluded.type, name = excluded.name, mi = excluded.mi, minutes = excluded.minutes, cal = CASE WHEN excluded.cal > 0 THEN excluded.cal ELSE activities.cal END, avg_hr = excluded.avg_hr")
    .bind(rand(10), user.id, String(a.id), String(a.start_date_local || "").slice(0, 10), TYPE_MAP(a.sport_type || a.type || ""), String(a.name || "Activity").slice(0, 80),
      Math.round((a.distance || 0) / 1609.34 * 100) / 100, Math.round((a.moving_time || 0) / 60), n0(a.calories || (a.kilojoules ? a.kilojoules * 1.1 : 0)), n0(a.average_heartrate), t));
  ops.push(env.DB.prepare("UPDATE strava_links SET last_sync = ? WHERE user_id = ?").bind(t, user.id));
  await env.DB.batch(ops);
  // lap splits for runs from the last 2 weeks that don't have them yet (needed to check workout reps)
  const need = (await env.DB.prepare("SELECT id, ext_id FROM activities WHERE user_id = ? AND source = 'strava' AND type = 'run' AND laps IS NULL AND date >= ? ORDER BY date DESC LIMIT 4")
    .bind(user.id, new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)).all()).results;
  for (const x of need){
    try {
      const lr = await fetch(base + "/api/v3/activities/" + x.ext_id + "/laps", {headers: {Authorization: "Bearer " + tok}});
      if (!lr.ok) break;
      const laps = (await lr.json()).slice(0, 80).map(l => [Math.round(l.distance || 0), Math.round(l.moving_time || 0), Math.round(l.average_heartrate || 0)]);
      await env.DB.prepare("UPDATE activities SET laps = ? WHERE id = ?").bind(JSON.stringify(laps), x.id).run();
    } catch(e){ break; }
  }
  const fresh = list.filter(a => !known.has(String(a.id))).map(a => String(a.id));
  if (fresh.length && ctx) ctx.waitUntil(afterNewActivities(env, user.id, fresh, "strava").catch(e => console.log("after-sync", e && e.stack || e)));
  return {synced: list.length, fresh: fresh.length, last_sync: t};
}

/* ---------- each person's data, in their own time zone ---------- */
const DEFAULT_SETTINGS = {tz: "America/New_York", morning: "07:00", bedtime: "21:30", n_morning: true, n_run: true, n_weekly: true, n_bed: true};
function localNow(tz){
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"})
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return {date: parts.year + "-" + parts.month + "-" + parts.day, hm: (parts.hour === "24" ? "00" : parts.hour) + ":" + parts.minute, weekday: parts.weekday};
}
async function settingsOf(env, userId){
  const row = await env.DB.prepare("SELECT data FROM settings WHERE user_id = ?").bind(userId).first();
  let s = {}; try { s = row ? JSON.parse(row.data) : {}; } catch(e){}
  return {...DEFAULT_SETTINGS, ...s};
}
async function loadUser(env, userId, today){
  const since = HP.addDays(today, -70);
  const [p, a, w, c, f, u] = await env.DB.batch([
    env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, laps, work_pace FROM activities WHERE user_id = ? AND date >= ? ORDER BY date, created").bind(userId, since),
    env.DB.prepare("SELECT date, lb FROM weights WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -200)),
    env.DB.prepare("SELECT date, sleep_h, sleep_q, soreness, energy, stress FROM checkins WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -14)),
    env.DB.prepare("SELECT date, cal FROM food WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -14)),
    env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(userId)
  ]);
  if (!p.results[0]) return null;
  const profile = JSON.parse(p.results[0].data), plan = HP.buildPlan(profile, today);
  const weights = {}; w.results.forEach(x => weights[x.date] = x.lb);
  const checkins = {}; c.results.forEach(x => checkins[x.date] = x);
  const eaten = {}; f.results.forEach(x => eaten[x.date] = (eaten[x.date] || 0) + x.cal);
  return {profile, plan, acts: a.results, weights, checkins, eaten, name: (u.results[0] || {}).name || ""};
}
function sessionsText(U, date, fbk){
  const day = HP.dayOf(U.plan, date); if (!day || !day.sessions.length) return "Rest day";
  return day.sessions.map((s, i) => { const k = date + "-" + i; let t = s.title; if (fbk.extra[k]) t += " (+1 rep)"; return t; }).join(" + ");
}

/* ---------- AI coach ---------- */
async function coachUsage(env, userId){
  const day = now().slice(0, 10);
  const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").bind(userId, "coach:" + day).first("count");
  if ((used || 0) >= 12) return false;
  await env.DB.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1").bind(userId, "coach:" + day).run();
  return true;
}
let lastCoachError = "";
// trim to the last full sentence that fits
const clip = (t, n) => { if (t.length <= n) return t; const c = t.slice(0, n), i = Math.max(c.lastIndexOf(". "), c.lastIndexOf("! "), c.lastIndexOf("? ")); return i > 40 ? c.slice(0, i + 1) : c.replace(/\s+\S*$/, "") + "…"; };
async function askCoach(env, system, data){
  if (!env.ANTHROPIC_API_KEY) return null;
  const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST",
    headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model: env.COACH_MODEL || "claude-haiku-5-5", max_tokens: 500, system, messages: [{role: "user", content: JSON.stringify(data)}]})});
  if (!r.ok){ const t = (await r.text()).slice(0, 300); console.log("coach error", r.status, t); lastCoachError = "api " + r.status + " " + t; return null; }
  const out = await r.json(), raw = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch(e){ lastCoachError = "unreadable reply (" + out.stop_reason + "): " + raw.slice(0, 200); return null; }
}
const COACH_STYLE = "You are a friendly, plain-spoken running and strength coach writing inside a training app. No jargon (no 'Z2', 'ACWR', 'EF'), no emoji, no medical advice, never shame. Use the numbers you are given; don't invent any.";
async function runReview(env, userId, U, act, today){
  const fbk = HP.feedback(U.plan, U.acts, HP.addDays(act.date, 1));
  const m = HP.dayMatches(U.plan, U.acts, act.date), idx = Object.keys(m).find(i => m[i].id === act.id);
  const day = HP.dayOf(U.plan, act.date), s = idx != null && day ? day.sessions[idx] : null;
  const as = s ? fbk.assess[act.date + "-" + idx] : null;
  const next = HP.feedback(U.plan, U.acts, HP.addDays(act.date, 1)), nextKeys = Object.keys(next.notes).slice(0, 2).map(k => next.notes[k]);
  const pace = act.mi > 0 && act.minutes > 0 ? HP.fmtPace(act.minutes * 60 / act.mi) + "/mi" : null;
  const data = {activity: {name: act.name, type: act.type, miles: act.mi, minutes: act.minutes, avg_pace: pace, avg_hr: act.avg_hr || null},
    planned: s ? {title: s.title, steps: s.steps.map(x => x[0]), type: s.type} : null, check: as ? {verdict: as.verdict, explanation: as.why} : null,
    pace_changes_for_next_workouts_s_per_mi: next.offs, upcoming_notes: nextKeys, tomorrow: sessionsText(U, HP.addDays(act.date, 1), next)};
  const out = await askCoach(env, COACH_STYLE + ' Write a post-workout summary. Reply with ONLY JSON: {"headline":"2-5 word verdict","numbers":"key numbers joined with \' · \'","meaning":"one sentence under 25 words on what it means","next":"one sentence under 25 words on what comes next"}', data);
  const review = out && out.headline ? {headline: String(out.headline).slice(0, 60), numbers: clip(String(out.numbers || ""), 140), meaning: clip(String(out.meaning || ""), 240), next: clip(String(out.next || ""), 240), verdict: as ? as.verdict : "extra", title: s ? s.title : act.name}
    : {headline: as ? ({ok: "On target", easy: "Came in fast", hard: "Too hard", unknown: "Done"})[as.verdict] : "Done", numbers: [act.mi ? act.mi + " mi" : "", pace || "", act.avg_hr ? act.avg_hr + " bpm" : ""].filter(Boolean).join(" · "),
       meaning: as ? as.why : "", next: nextKeys[0] || "Next sessions stay as planned.", verdict: as ? as.verdict : "extra", title: s ? s.title : act.name};
  await env.DB.prepare("INSERT INTO reviews (activity_id, user_id, date, data, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (activity_id) DO UPDATE SET data = excluded.data")
    .bind(act.id, userId, act.date, JSON.stringify(review), now()).run();
  return review;
}
async function afterNewActivities(env, userId, ids, source){
  const st = await settingsOf(env, userId), L = localNow(st.tz), U = await loadUser(env, userId, L.date);
  if (!U) return;
  const fresh = U.acts.filter(a => (source === "strava" ? ids.includes(a.ext_id) : ids.includes(a.id)) && a.date >= HP.addDays(L.date, -2));
  for (const a of fresh.slice(0, 3)){
    if (!(await coachUsage(env, userId))) break;
    const rv = await runReview(env, userId, U, a, L.date);
    if (st.n_run) await pushTo(env, userId, {title: rv.title + ": " + rv.headline, body: [rv.numbers, rv.next].filter(Boolean).join("\n"), tag: "run-" + a.id});
  }
}
async function morningNote(env, userId, today){
  const U = await loadUser(env, userId, today); if (!U) return null;
  const fbk = HP.feedback(U.plan, U.acts, today), c = U.checkins[today], r = HP.readiness(c), f = HP.fuel(U.plan, U.weights, U.acts, today);
  const yday = HP.addDays(today, -1), fy = HP.fuel(U.plan, U.weights, U.acts, yday);
  const recent = U.acts.filter(a => a.date >= HP.addDays(today, -3) && a.date < today).map(a => a.name + " " + (a.mi ? a.mi + " mi" : a.minutes + " min"));
  const a7 = HP.avgW(U.weights, today), a14 = HP.avgW(U.weights, HP.addDays(today, -7));
  const data = {name: (U.name || "").split(" ")[0], readiness: r ? {score: r.score, call: r.word, sleep_h: c.sleep_h, soreness_1to5: c.soreness, energy_1to5: c.energy, stress_1to5: c.stress} : null,
    today: sessionsText(U, today, fbk), adjustment_rule: r && r.level ? "Today's sessions are adjusted: " + (r.level === 1 ? "one rep fewer, long run 2 mi shorter, easy runs strictly easy" : "easy or rest, workout moves later in the week") : "train as planned",
    plan_notes_today: Object.keys(fbk.notes).filter(k => k.startsWith(today)).map(k => fbk.notes[k]),
    calories_today_target: f.cal, protein_g: f.pro, yesterday: U.eaten[yday] ? {eaten: U.eaten[yday], target: fy.cal} : "no food logged",
    weight_7day_avg: a7 ? Math.round(a7 * 10) / 10 : null, weight_change_vs_last_week: a7 && a14 ? Math.round((a7 - a14) * 10) / 10 : null, goal_weight: U.profile.goalWeight || null,
    last_3_days: recent};
  const out = await askCoach(env, COACH_STYLE + ' Write the morning check-in note. Reply with ONLY JSON: {"headline":"2-6 words","lines":["recovery read, under 20 words","today\'s session, under 20 words","fuel for today, under 20 words"]}. Three separate array items, one sentence each.', data);
  if (!out || !out.headline) return null;
  const note = {headline: String(out.headline).slice(0, 60), lines: (Array.isArray(out.lines) ? out.lines : []).slice(0, 3).map(x => clip(String(x), 220))};
  await env.DB.prepare("INSERT INTO coach_notes (user_id, date, kind, data, created) VALUES (?, ?, 'morning', ?, ?) ON CONFLICT (user_id, date, kind) DO UPDATE SET data = excluded.data, created = excluded.created")
    .bind(userId, today, JSON.stringify(note), now()).run();
  return note;
}

/* ---------- push notifications ---------- */
async function pushTo(env, userId, msg){
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return 0;
  const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE user_id = ?").bind(userId).all()).results;
  const vapid = {subject: env.VAPID_SUBJECT || "mailto:hybrid-app@users.noreply.github.com", publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE};
  let sent = 0;
  for (const s of subs){
    try {
      const payload = await buildPushPayload({data: JSON.stringify({url: (env.APP_URL || "") + "#today", ...msg}), options: {ttl: 6 * 3600, urgency: "normal", topic: (msg.tag || "hybrid").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}},
        {endpoint: s.endpoint, expirationTime: null, keys: {p256dh: s.p256dh, auth: s.auth}}, vapid);
      const r = await fetch(s.endpoint, payload);
      if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run();
      else if (r.ok) sent++;
      else console.log("push failed", r.status, (await r.text()).slice(0, 200));
    } catch(e){ console.log("push error", e && e.message); }
  }
  return sent;
}
async function once(env, userId, kind, day){
  const r = await env.DB.prepare("INSERT OR IGNORE INTO notif_log (user_id, kind, day) VALUES (?, ?, ?)").bind(userId, kind, day).run();
  return r.meta.changes > 0;
}
const inWindow = (hm, at) => { const m = x => +x.slice(0, 2) * 60 + +x.slice(3, 5); const d = m(hm) - m(at); return d >= 0 && d < 15; };
function weeklySummary(U, today){
  const end = HP.addDays(today, -1), start = HP.addDays(end, -6), fbk = HP.feedback(U.plan, U.acts, today);
  let plannedMi = 0, doneMi = 0, done = 0, total = 0; const v = {ok: 0, easy: 0, hard: 0};
  for (let d = start; d <= end; d = HP.addDays(d, 1)){
    const day = HP.dayOf(U.plan, d); if (!day) continue; const m = HP.dayMatches(U.plan, U.acts, d);
    day.sessions.forEach((s, i) => { total++; plannedMi += s.mi || 0; if (m[i]){ done++; doneMi += m[i].mi || 0; const a = fbk.assess[d + "-" + i]; if (a && v[a.verdict] != null) v[a.verdict]++; } });
  }
  const extraMi = U.acts.filter(a => a.date >= start && a.date <= end && a.type === "run").reduce((t, a) => t + (a.mi || 0), 0);
  const a1 = HP.avgW(U.weights, end), a0 = HP.avgW(U.weights, HP.addDays(end, -7));
  const days = []; for (let d = start; d <= end; d = HP.addDays(d, 1)) if (U.eaten[d]) days.push([U.eaten[d], HP.fuel(U.plan, U.weights, U.acts, d).cal]);
  const ce = days.length ? Math.round(days.reduce((t, x) => t + x[0], 0) / days.length) : null, ct = days.length ? Math.round(days.reduce((t, x) => t + x[1], 0) / days.length) : null;
  const wk = HP.weekIdx(U.plan, today), w = U.plan.weeks[wk];
  const key = w ? w.days.flatMap(d => d.sessions.filter(s => s.type === "workout" || s.type === "long" || s.type === "race").map(s => HP.DAYS[HP.dow(d.date)] + " " + s.title)).slice(0, 3) : [];
  const lines = [
    done + " of " + total + " sessions done" + (v.ok + v.easy + v.hard ? " · " + v.ok + " on target" + (v.easy ? ", " + v.easy + " fast" : "") + (v.hard ? ", " + v.hard + " too hard" : "") : ""),
    a1 && a0 ? "Weight " + a1.toFixed(1) + " lb avg (" + (a1 - a0 <= 0 ? "−" : "+") + Math.abs(a1 - a0).toFixed(1) + " this week)" : null,
    ce ? "Calories " + ce.toLocaleString("en-US") + " avg vs " + ct.toLocaleString("en-US") + " target (" + days.length + " days logged)" : null,
    w ? "This week: " + (key.length ? key.join(", ") : w.miles + " mi") : null
  ].filter(Boolean);
  return {title: "Week done: " + Math.round(extraMi * 10) / 10 + " of " + Math.round(plannedMi * 10) / 10 + " mi", body: lines.join("\n"), tag: "weekly-" + today};
}
async function cron(env, ctx){
  const users = (await env.DB.prepare("SELECT DISTINCT u.id FROM users u LEFT JOIN push_subs p ON p.user_id = u.id LEFT JOIN strava_links s ON s.user_id = u.id WHERE p.user_id IS NOT NULL OR s.user_id IS NOT NULL").all()).results;
  for (const {id} of users){
    try {
      const st = await settingsOf(env, id), L = localNow(st.tz);
      // Strava backup sync, hourly 5 am–10 pm local, in case a Strava notice was missed
      const link = await env.DB.prepare("SELECT last_sync FROM strava_links WHERE user_id = ?").bind(id).first();
      const hr = +L.hm.slice(0, 2);
      if (link && hr >= 5 && hr <= 22 && (!link.last_sync || Date.now() - Date.parse(link.last_sync) > 55 * 60e3)) await stravaSync(env, {id}, ctx).catch(e => console.log("cron sync", e.message));
      const hasPush = await env.DB.prepare("SELECT 1 FROM push_subs WHERE user_id = ?").bind(id).first();
      if (!hasPush) continue;
      const U = () => loadUser(env, id, L.date);
      if (st.n_morning && inWindow(L.hm, st.morning) && await once(env, id, "morning", L.date)){
        const u = await U(); if (u && !u.checkins[L.date]){ const fbk = HP.feedback(u.plan, u.acts, L.date);
          await pushTo(env, id, {title: "Morning check-in · 20 seconds", body: "Today: " + sessionsText(u, L.date, fbk) + ". Tap to check in and see today's fuel.", tag: "morning-" + L.date}); }
      }
      if (st.n_bed && inWindow(L.hm, st.bedtime) && await once(env, id, "bed", L.date)){
        const u = await U(); if (u){ const tm = HP.addDays(L.date, 1), fbk = HP.feedback(u.plan, u.acts, tm);
          const sl = Object.values(u.checkins).slice(-7).map(c => c.sleep_h), avg = sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
          await pushTo(env, id, {title: "Wind down for tomorrow", body: "Tomorrow: " + sessionsText(u, tm, fbk) + "." + (avg ? " This week you're averaging " + avg.toFixed(1) + " h of sleep." : "") + " Aim for 7.5 h tonight.", tag: "bed-" + L.date}); }
      }
      if (st.n_weekly && L.weekday === "Mon" && inWindow(L.hm, "12:00") && await once(env, id, "weekly", L.date)){
        const u = await U(); if (u) await pushTo(env, id, weeklySummary(u, L.date));
      }
    } catch(e){ console.log("cron user", id, e && e.stack || e); }
  }
}

/* ---------- routes ---------- */
async function route(req, env, path, ctx){
  const M = req.method;
  if (M === "GET" && path === "/api/health") return {ok: true};

  if (M === "POST" && path === "/api/signup"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req);
    const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || ""), name = String(b.name || "").trim().slice(0, 30);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new HttpError(400, "Enter a valid email.");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "Use a password of at least 8 characters.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) throw new HttpError(409, "That email already has an account. Log in instead.");
    const id = rand(12), salt = rand(16);
    await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)").bind(id, email, name, await hashPassword(password, salt), salt, now()).run();
    return {token: await newSession(env, id), user: {id, email, name}};
  }
  if (M === "GET" && path === "/api/strava/callback"){
    const q = new URL(req.url).searchParams, st = q.get("state") || "";
    const row = await env.DB.prepare("SELECT user_id, created FROM oauth_states WHERE state = ?").bind(st).first();
    await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? OR created < ?").bind(st, new Date(Date.now() - 3600e3).toISOString()).run();
    const go = code => Response.redirect(appUrl(env, code), 302);
    if (!row || Date.parse(row.created) < Date.now() - 1800e3) return go("expired");
    if (q.get("error") || !q.get("code")) return go("cancelled");
    if (!/activity:read/.test(q.get("scope") || "")) return go("noscope");
    const r = await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/token", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, code: q.get("code"), grant_type: "authorization_code"})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok){ console.log("strava token error", r.status, JSON.stringify(j).slice(0, 300)); return go(/limit|exceed/i.test(JSON.stringify(j)) || r.status === 403 ? "limit" : "failed"); }
    const a = j.athlete || {};
    await env.DB.prepare("INSERT INTO strava_links (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at, last_sync) VALUES (?, ?, ?, ?, ?, ?, NULL) " +
      "ON CONFLICT (user_id) DO UPDATE SET athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at")
      .bind(row.user_id, String(a.id || ""), ((a.firstname || "") + " " + (a.lastname || "")).trim().slice(0, 60), j.access_token, j.refresh_token, j.expires_at).run();
    return go("connected");
  }
  if (path === "/api/strava/webhook"){
    if (M === "GET"){
      const q = new URL(req.url).searchParams;
      if (!env.STRAVA_VERIFY || q.get("hub.verify_token") !== env.STRAVA_VERIFY) throw new HttpError(403, "Bad token.");
      return new Response(JSON.stringify({"hub.challenge": q.get("hub.challenge")}), {headers: {"Content-Type": "application/json"}});
    }
    if (M === "POST"){
      const ev = await body(req);
      if (ev.object_type === "activity" && ev.owner_id){
        const link = await env.DB.prepare("SELECT user_id FROM strava_links WHERE athlete_id = ?").bind(String(ev.owner_id)).first();
        if (link){
          if (ev.aspect_type === "delete") ctx.waitUntil(env.DB.prepare("DELETE FROM activities WHERE user_id = ? AND source = 'strava' AND ext_id = ?").bind(link.user_id, String(ev.object_id)).run());
          else ctx.waitUntil(stravaSync(env, {id: link.user_id}, ctx).catch(e => console.log("webhook sync", e.message)));
        }
      } else if (ev.object_type === "athlete" && ev.updates && ev.updates.authorized === "false"){
        ctx.waitUntil(env.DB.prepare("DELETE FROM strava_links WHERE athlete_id = ?").bind(String(ev.owner_id)).run());
      }
      return {ok: true};
    }
  }
  if (M === "POST" && path === "/api/login"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req);
    const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
    const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    const ok = u && safeEqual(await hashPassword(password, u.salt), u.pass_hash);
    if (!ok) throw new HttpError(401, "Email or password is wrong.");
    return {token: await newSession(env, u.id), user: userOut(u)};
  }

  const user = await auth(req, env);
  if (M === "POST" && path === "/api/logout"){
    const t = (req.headers.get("Authorization") || "").slice(7);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return {ok: true};
  }
  if (M === "GET" && path === "/api/me"){
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const [p, d, f] = await env.DB.batch([
      env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(user.id),
      env.DB.prepare("SELECT key FROM done WHERE user_id = ?").bind(user.id),
      env.DB.prepare("SELECT id, date, meal, name, cal, protein, carbs, fat FROM food WHERE user_id = ? AND date >= ? ORDER BY created").bind(user.id, since)
    ]);
    const since120 = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const [c, w, a, s] = await env.DB.batch([
      env.DB.prepare("SELECT date, sleep_h, sleep_q, soreness, energy, stress FROM checkins WHERE user_id = ? AND date >= ? ORDER BY date").bind(user.id, since),
      env.DB.prepare("SELECT date, lb FROM weights WHERE user_id = ? AND date >= ? ORDER BY date").bind(user.id, since120),
      env.DB.prepare("SELECT id, source, date, type, name, mi, minutes, cal, avg_hr, work_pace, laps FROM activities WHERE user_id = ? AND date >= ? ORDER BY date, created").bind(user.id, since),
      env.DB.prepare("SELECT athlete_name, last_sync FROM strava_links WHERE user_id = ?").bind(user.id)
    ]);
    const [rv, cn, ps] = await env.DB.batch([
      env.DB.prepare("SELECT activity_id, data FROM reviews WHERE user_id = ? AND date >= ?").bind(user.id, since),
      env.DB.prepare("SELECT date, kind, data FROM coach_notes WHERE user_id = ? AND date >= ?").bind(user.id, new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)),
      env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(user.id)
    ]);
    const prof = p.results[0] ? JSON.parse(p.results[0].data) : null;
    return {user: userOut(user), profile: prof, done: d.results.map(r => r.key), food: f.results, checkins: c.results, weights: w.results, activities: a.results,
      strava: {available: !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET), connected: !!s.results[0], name: s.results[0] ? s.results[0].athlete_name : "", last_sync: s.results[0] ? s.results[0].last_sync : null},
      reviews: Object.fromEntries(rv.results.map(x => [x.activity_id, JSON.parse(x.data)])), notes: cn.results.map(x => ({date: x.date, kind: x.kind, ...JSON.parse(x.data)})),
      settings: await settingsOf(env, user.id), push: {key: env.VAPID_PUBLIC || null, devices: ps.results[0].n}, coach: !!env.ANTHROPIC_API_KEY};
  }
  if (M === "PUT" && path === "/api/profile"){
    const b = await body(req), s = JSON.stringify(b.profile || null);
    if (!b.profile || typeof b.profile !== "object" || s.length > 20000) throw new HttpError(400, "Bad plan settings.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO profiles (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(user.id, s, now()),
      ...(isDate(b.resetFrom) ? [env.DB.prepare("DELETE FROM done WHERE user_id = ? AND key >= ?").bind(user.id, b.resetFrom)] : [])
    ]);
    return {ok: true};
  }
  if (M === "PUT" && path === "/api/done"){
    const b = await body(req), key = String(b.key || "");
    if (!/^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(key)) throw new HttpError(400, "Bad session.");
    if (b.done) await env.DB.prepare("INSERT OR IGNORE INTO done (user_id, key) VALUES (?, ?)").bind(user.id, key).run();
    else await env.DB.prepare("DELETE FROM done WHERE user_id = ? AND key = ?").bind(user.id, key).run();
    return {ok: true};
  }
  if (M === "POST" && path === "/api/food"){
    const b = await body(req), list = Array.isArray(b.items) ? b.items.slice(0, 12) : [];
    if (!isDate(b.date) || !list.length) throw new HttpError(400, "Bad food entry.");
    const meal = MEALS.includes(b.meal) ? b.meal : "Snack", t = now();
    const rows = list.map(x => ({id: rand(10), date: b.date, meal, name: String(x.name || "").trim().slice(0, 80), cal: n0(x.cal), protein: n0(x.protein), carbs: n0(x.carbs), fat: n0(x.fat)})).filter(x => x.name);
    if (!rows.length) throw new HttpError(400, "Add a food name.");
    await env.DB.batch(rows.map(x => env.DB.prepare("INSERT INTO food (id, user_id, date, meal, name, cal, protein, carbs, fat, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(x.id, user.id, x.date, x.meal, x.name, x.cal, x.protein, x.carbs, x.fat, t)));
    return {items: rows};
  }
  let m = path.match(/^\/api\/food\/([a-f0-9]{20})$/);
  if (M === "DELETE" && m){ await env.DB.prepare("DELETE FROM food WHERE id = ? AND user_id = ?").bind(m[1], user.id).run(); return {ok: true}; }
  if (M === "POST" && path === "/api/food/analyze"){ await limit(env, "ai:" + user.id); return analyze(env, user, await body(req)); }
  if (M === "PUT" && path === "/api/checkin"){
    const b = await body(req), k = x => { x = Math.round(Number(x)); return x >= 1 && x <= 5 ? x : null; }, h = Number(b.sleep_h);
    if (!isDate(b.date) || !(h >= 0 && h <= 16) || [b.sleep_q, b.soreness, b.energy, b.stress].some(x => k(x) == null)) throw new HttpError(400, "Answer every question.");
    await env.DB.prepare("INSERT INTO checkins (user_id, date, sleep_h, sleep_q, soreness, energy, stress) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET sleep_h = excluded.sleep_h, sleep_q = excluded.sleep_q, soreness = excluded.soreness, energy = excluded.energy, stress = excluded.stress")
      .bind(user.id, b.date, Math.round(h * 4) / 4, k(b.sleep_q), k(b.soreness), k(b.energy), k(b.stress)).run();
    if (await coachUsage(env, user.id)){ lastCoachError = ""; const note = await morningNote(env, user.id, b.date).catch(e => { lastCoachError = String(e && e.message || e); return null; }); return note ? {ok: true, note} : {ok: true, note: null, note_issue: lastCoachError.slice(0, 300) || "no plan"}; }
    return {ok: true};
  }
  if (M === "PUT" && path === "/api/weight"){
    const b = await body(req), lb = Number(b.lb);
    if (!isDate(b.date)) throw new HttpError(400, "Bad date.");
    if (b.lb === null){ await env.DB.prepare("DELETE FROM weights WHERE user_id = ? AND date = ?").bind(user.id, b.date).run(); return {ok: true}; }
    if (!(lb >= 70 && lb <= 500)) throw new HttpError(400, "Enter your weight in pounds.");
    await env.DB.prepare("INSERT INTO weights (user_id, date, lb) VALUES (?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET lb = excluded.lb").bind(user.id, b.date, Math.round(lb * 10) / 10).run();
    return {ok: true};
  }
  if (M === "POST" && path === "/api/activity"){
    const b = await body(req), type = ["run", "lift", "bike", "swim", "other"].includes(b.type) ? b.type : "other";
    const mi = Math.max(0, Math.min(200, Number(b.mi) || 0)), minutes = n0(b.minutes);
    if (!isDate(b.date) || (!mi && !minutes)) throw new HttpError(400, "Add a distance or a time.");
    const x = {id: rand(10), source: "manual", date: b.date, type, name: String(b.name || "").trim().slice(0, 80) || ({run: "Run", lift: "Strength", bike: "Ride", swim: "Swim", other: "Workout"})[type],
      mi: Math.round(mi * 100) / 100, minutes, cal: n0(b.cal), avg_hr: n0(b.avg_hr), work_pace: n0(b.work_pace) > 150 && n0(b.work_pace) < 1200 ? n0(b.work_pace) : 0};
    await env.DB.prepare("INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, work_pace, created) VALUES (?, ?, 'manual', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(x.id, user.id, x.date, x.type, x.name, x.mi, x.minutes, x.cal, x.avg_hr, x.work_pace, now()).run();
    if (x.type === "run") ctx.waitUntil(afterNewActivities(env, user.id, [x.id], "manual").catch(e => console.log("manual review", e && e.stack || e)));
    return {activity: x};
  }
  m = path.match(/^\/api\/activity\/([a-f0-9]{20})$/);
  if (M === "DELETE" && m){ await env.DB.prepare("DELETE FROM activities WHERE id = ? AND user_id = ?").bind(m[1], user.id).run(); return {ok: true}; }
  if (M === "PUT" && path === "/api/settings"){
    const b = await body(req), cur = await settingsOf(env, user.id), next = {...cur};
    if (typeof b.tz === "string" && b.tz.length < 60){ try { new Intl.DateTimeFormat("en", {timeZone: b.tz}); next.tz = b.tz; } catch(e){} }
    for (const k of ["morning", "bedtime"]) if (/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k] || "")) next[k] = b[k];
    for (const k of ["n_morning", "n_run", "n_weekly", "n_bed"]) if (typeof b[k] === "boolean") next[k] = b[k];
    await env.DB.prepare("INSERT INTO settings (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data").bind(user.id, JSON.stringify(next)).run();
    return {settings: next};
  }
  if (M === "POST" && path === "/api/push/subscribe"){
    const b = await body(req), sb = b.subscription || {};
    if (!/^https:\/\//.test(sb.endpoint || "") || !sb.keys || !sb.keys.p256dh || !sb.keys.auth) throw new HttpError(400, "Bad subscription.");
    await env.DB.prepare("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth")
      .bind(sb.endpoint, user.id, sb.keys.p256dh, sb.keys.auth, now()).run();
    return {ok: true};
  }
  if (M === "POST" && path === "/api/push/unsubscribe"){
    const b = await body(req);
    if (b.endpoint) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(b.endpoint), user.id).run();
    else await env.DB.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(user.id).run();
    return {ok: true};
  }
  if (M === "POST" && path === "/api/push/test"){
    await limit(env, "push:" + user.id);
    const n = await pushTo(env, user.id, {title: "Notifications are on", body: "You'll get your morning check-in, run summaries, a Monday recap and a bedtime reminder.", tag: "test"});
    return {sent: n};
  }
  if (M === "POST" && path === "/api/strava/start"){
    if (!env.STRAVA_CLIENT_ID) throw new HttpError(503, "Strava connection isn't set up yet.");
    const st = rand(16);
    await env.DB.prepare("INSERT INTO oauth_states (state, user_id, created) VALUES (?, ?, ?)").bind(st, user.id, now()).run();
    const cb = new URL(req.url).origin + "/api/strava/callback";
    return {url: (env.STRAVA_BASE || STRAVA) + "/oauth/mobile/authorize?client_id=" + encodeURIComponent(env.STRAVA_CLIENT_ID) + "&response_type=code&approval_prompt=auto&scope=activity:read_all&redirect_uri=" + encodeURIComponent(cb) + "&state=" + st};
  }
  if (M === "POST" && path === "/api/strava/sync"){ await limit(env, "strava:" + user.id); return stravaSync(env, user, ctx); }
  if (M === "POST" && path === "/api/strava/disconnect"){
    const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
    if (link){ try { const tok = await stravaToken(env, link); await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/deauthorize", {method: "POST", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
    await env.DB.batch([env.DB.prepare("DELETE FROM strava_links WHERE user_id = ?").bind(user.id), env.DB.prepare("DELETE FROM activities WHERE user_id = ? AND source = 'strava'").bind(user.id)]);
    return {ok: true};
  }
  if (M === "DELETE" && path === "/api/account"){
    const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
    if (link){ try { const tok = await stravaToken(env, link); await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/deauthorize", {method: "POST", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
    await env.DB.batch(["sessions", "profiles", "done", "food", "ai_usage", "checkins", "weights", "activities", "strava_links", "oauth_states", "reviews", "coach_notes", "push_subs", "settings", "notif_log"].map(t => env.DB.prepare("DELETE FROM " + t + " WHERE user_id = ?").bind(user.id))
      .concat([env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
    return {ok: true};
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async scheduled(event, env, ctx){ ctx.waitUntil(cron(env, ctx)); },
  async fetch(req, env, ctx){
    const h = corsFor(req), path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    try { const out = await route(req, env, path, ctx); return out instanceof Response ? out : reply(h, out); }
    catch (e){
      if (e instanceof HttpError) return reply(h, {error: e.message}, e.status);
      console.log("server error", e && e.stack || e);
      return reply(h, {error: "Something went wrong on our side. Try again."}, 500);
    }
  }
};
