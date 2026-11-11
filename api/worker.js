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
async function stravaSync(env, user){
  const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
  if (!link) throw new HttpError(400, "Strava isn't connected.");
  const tok = await stravaToken(env, link);
  const since = link.last_sync ? Math.floor(Date.parse(link.last_sync) / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 30 * 86400;
  const r = await fetch((env.STRAVA_BASE || STRAVA) + "/api/v3/athlete/activities?per_page=100&after=" + since, {headers: {Authorization: "Bearer " + tok}});
  if (r.status === 429) throw new HttpError(429, "Strava is busy. Try again in a few minutes.");
  if (!r.ok) throw new HttpError(502, "Couldn't reach Strava right now.");
  const list = await r.json(), t = now();
  const ops = list.slice(0, 100).map(a => env.DB.prepare(
    "INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, created) VALUES (?, ?, 'strava', ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id, source, ext_id) DO UPDATE SET date = excluded.date, type = excluded.type, name = excluded.name, mi = excluded.mi, minutes = excluded.minutes, cal = CASE WHEN excluded.cal > 0 THEN excluded.cal ELSE activities.cal END, avg_hr = excluded.avg_hr")
    .bind(rand(10), user.id, String(a.id), String(a.start_date_local || "").slice(0, 10), TYPE_MAP(a.sport_type || a.type || ""), String(a.name || "Activity").slice(0, 80),
      Math.round((a.distance || 0) / 1609.34 * 100) / 100, Math.round((a.moving_time || 0) / 60), n0(a.calories || (a.kilojoules ? a.kilojoules * 1.1 : 0)), n0(a.average_heartrate), t));
  ops.push(env.DB.prepare("UPDATE strava_links SET last_sync = ? WHERE user_id = ?").bind(t, user.id));
  await env.DB.batch(ops);
  return {synced: list.length, last_sync: t};
}

/* ---------- routes ---------- */
async function route(req, env, path){
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
      env.DB.prepare("SELECT id, source, date, type, name, mi, minutes, cal, avg_hr FROM activities WHERE user_id = ? AND date >= ? ORDER BY date, created").bind(user.id, since),
      env.DB.prepare("SELECT athlete_name, last_sync FROM strava_links WHERE user_id = ?").bind(user.id)
    ]);
    const prof = p.results[0] ? JSON.parse(p.results[0].data) : null;
    return {user: userOut(user), profile: prof, done: d.results.map(r => r.key), food: f.results, checkins: c.results, weights: w.results, activities: a.results,
      strava: {available: !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET), connected: !!s.results[0], name: s.results[0] ? s.results[0].athlete_name : "", last_sync: s.results[0] ? s.results[0].last_sync : null}};
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
      mi: Math.round(mi * 100) / 100, minutes, cal: n0(b.cal), avg_hr: n0(b.avg_hr)};
    await env.DB.prepare("INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, created) VALUES (?, ?, 'manual', NULL, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(x.id, user.id, x.date, x.type, x.name, x.mi, x.minutes, x.cal, x.avg_hr, now()).run();
    return {activity: x};
  }
  m = path.match(/^\/api\/activity\/([a-f0-9]{20})$/);
  if (M === "DELETE" && m){ await env.DB.prepare("DELETE FROM activities WHERE id = ? AND user_id = ?").bind(m[1], user.id).run(); return {ok: true}; }
  if (M === "POST" && path === "/api/strava/start"){
    if (!env.STRAVA_CLIENT_ID) throw new HttpError(503, "Strava connection isn't set up yet.");
    const st = rand(16);
    await env.DB.prepare("INSERT INTO oauth_states (state, user_id, created) VALUES (?, ?, ?)").bind(st, user.id, now()).run();
    const cb = new URL(req.url).origin + "/api/strava/callback";
    return {url: (env.STRAVA_BASE || STRAVA) + "/oauth/mobile/authorize?client_id=" + encodeURIComponent(env.STRAVA_CLIENT_ID) + "&response_type=code&approval_prompt=auto&scope=activity:read_all&redirect_uri=" + encodeURIComponent(cb) + "&state=" + st};
  }
  if (M === "POST" && path === "/api/strava/sync"){ await limit(env, "strava:" + user.id); return stravaSync(env, user); }
  if (M === "POST" && path === "/api/strava/disconnect"){
    const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
    if (link){ try { const tok = await stravaToken(env, link); await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/deauthorize", {method: "POST", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
    await env.DB.batch([env.DB.prepare("DELETE FROM strava_links WHERE user_id = ?").bind(user.id), env.DB.prepare("DELETE FROM activities WHERE user_id = ? AND source = 'strava'").bind(user.id)]);
    return {ok: true};
  }
  if (M === "DELETE" && path === "/api/account"){
    const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
    if (link){ try { const tok = await stravaToken(env, link); await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/deauthorize", {method: "POST", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
    await env.DB.batch(["sessions", "profiles", "done", "food", "ai_usage", "checkins", "weights", "activities", "strava_links", "oauth_states"].map(t => env.DB.prepare("DELETE FROM " + t + " WHERE user_id = ?").bind(user.id))
      .concat([env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
    return {ok: true};
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(req, env){
    const h = corsFor(req), path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    try { const out = await route(req, env, path); return out instanceof Response ? out : reply(h, out); }
    catch (e){
      if (e instanceof HttpError) return reply(h, {error: e.message}, e.status);
      console.log("server error", e && e.stack || e);
      return reply(h, {error: "Something went wrong on our side. Try again."}, 500);
    }
  }
};
