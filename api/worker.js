import "../plan.js";
import { buildPushPayload } from "@block65/webcrypto-web-push";
const HP = globalThis.HP;
// Hybrid API: accounts, saved plans, workout check-offs, food log and AI food reading.
// Runs on Cloudflare Workers with a D1 database (binding DB). Secrets: ANTHROPIC_API_KEY.
// Auth: email + password (PBKDF2-SHA256, per-user salt); sessions are random bearer tokens,
// stored only as SHA-256 hashes, valid 90 days.
const ORIGINS = ["https://app.hybrdrunning.com", "https://hybrdrunning.com", "https://app.hybridrunnin.com", "https://matthewbaconn.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
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
  const row = await env.DB.prepare("SELECT u.id, u.email, u.name, u.terms_at, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(await sha256(m[1])).first();
  if (!row || row.expires < now()) throw new HttpError(401, "Your session ended. Please log in again.");
  return row;
}
const userOut = u => ({id: u.id, email: u.email, name: u.name});
/* The app's owner sees problem reports. OWNER_EMAIL (a secret) wins; otherwise it's the oldest real account. */
async function ownerId(env){
  const row = env.OWNER_EMAIL ? await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(String(env.OWNER_EMAIL).trim().toLowerCase()).first()
    : await env.DB.prepare("SELECT id FROM users WHERE email NOT LIKE '%@example.com' ORDER BY created LIMIT 1").first();
  return row ? row.id : null;
}

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
    body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 2000, system: PROMPT, messages: [{role: "user", content}]})
  });
  if (!r.ok){ const t = (await r.text()).slice(0, 300); console.log("anthropic error", r.status, t); await logEvent(env, "ai_food", false, r.status + " " + t); throw new HttpError(502, "Couldn't read that right now. Try again in a minute."); }
  const out = await r.json();
  const raw = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let parsed;
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); await logEvent(env, "ai_food", true); } catch { await logEvent(env, "ai_food", false, "unreadable: " + raw.slice(0, 150)); throw new HttpError(502, "Couldn't read that. Try a clearer photo or add a few words."); }
  const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 12)
    .map(x => ({name: String(x.name || "").slice(0, 80), cal: n0(x.cal), protein: n0(x.protein), carbs: n0(x.carbs), fat: n0(x.fat)})).filter(x => x.name);
  return {items, note: typeof parsed.note === "string" ? parsed.note.slice(0, 200) : ""};
}

/* ---------- Strava ----------
   Secrets STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET; var APP_URL. The Strava app's Authorization Callback
   Domain must be this Worker's host. New Strava apps allow 1 connected athlete until Strava approves more. */
const STRAVA = "https://www.strava.com";
const TYPE_MAP = t => /Run/.test(t) ? "run" : /Ride|Cycl|Bike/.test(t) ? "bike" : /Swim/.test(t) ? "swim" : /Weight|Workout|Crossfit|HIIT|Strength/.test(t) ? "lift" : "other";
function appUrl(env, q, ret){ return (ret || env.APP_URL || "https://matthewbaconn.github.io/Hybrid/") + "?strava=" + q + "#today"; }
// the app's address the person started from, so sign-ins send them back to the same place (old github.io or the new domain)
function retFor(req){ const o = req.headers.get("Origin") || ""; return o === "https://app.hybrdrunning.com" || o === "https://app.hybridrunnin.com" ? o + "/" : o === "https://matthewbaconn.github.io" ? o + "/Hybrid/" : null; }
/* ---------- hybrdrunning.com: the website and the app, served from GitHub Pages ----------
   The old hybridrunnin.com website forwards to the new one. The old app address still serves the app,
   which then moves itself (and the person's login) to app.hybrdrunning.com. */
const SITE_HOSTS = new Set(["hybrdrunning.com", "www.hybrdrunning.com", "app.hybrdrunning.com", "hybridrunnin.com", "www.hybridrunnin.com", "app.hybridrunnin.com"]);
const PAGES = "https://matthewbaconn.github.io/Hybrid";
async function site(req, host){
  const u = new URL(req.url);
  if (host === "www.hybrdrunning.com" || host === "hybridrunnin.com" || host === "www.hybridrunnin.com") return Response.redirect("https://hybrdrunning.com" + u.pathname + u.search, 301);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", {status: 405});
  if (/^\/(\.claude|\.github|CLAUDE(\.local)?\.md|api\/|tests\/|mail\/)/i.test(u.pathname)) return new Response("Not found", {status: 404});   // repo internals stay off the live domains
  const shared = /^\/(brand\/|privacy\.html$|icon-|apple-touch-icon)/.test(u.pathname);
  const target = PAGES + (host.startsWith("app.") || shared ? "" : "/home") + u.pathname + u.search;
  const r = await fetch(target, {headers: {"Accept": req.headers.get("Accept") || "*/*"}, redirect: "manual", cf: {cacheTtl: 60, cacheEverything: true}});
  const h = new Headers(r.headers);
  const loc = h.get("Location");
  if (loc){ const l = new URL(loc, target); h.set("Location", "https://" + host + l.pathname.replace(/^\/Hybrid(\/home)?/, "") + l.search); }
  h.delete("x-github-request-id"); h.set("X-Content-Type-Options", "nosniff");
  return new Response(r.body, {status: r.status, headers: h});
}
async function stravaToken(env, link){
  if (link.expires_at > Date.now() / 1000 + 120) return link.access_token;
  const r = await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/token", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: link.refresh_token})});
  if (!r.ok){ await logEvent(env, "strava_token", false, "refresh HTTP " + r.status); throw new HttpError(502, "Strava needs you to reconnect. Open Settings and connect Strava again."); }
  const j = await r.json();
  await env.DB.prepare("UPDATE strava_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?").bind(j.access_token, j.refresh_token, j.expires_at, link.user_id).run();
  return j.access_token;
}
async function stravaSync(env, user, ctx){
  const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
  if (!link) throw new HttpError(400, "Strava isn't connected.");
  const tok = await stravaToken(env, link), base = env.STRAVA_BASE || STRAVA;
  // first sync, or older runs still missing their route map: look back 60 days, otherwise 3 days before the last sync
  const d60 = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const noMap = await env.DB.prepare("SELECT 1 FROM activities WHERE user_id = ? AND source = 'strava' AND start_local IS NULL AND date >= ? LIMIT 1").bind(user.id, d60).first();
  const since = link.last_sync && !noMap ? Math.floor(Date.parse(link.last_sync) / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 60 * 86400;
  const r = await fetch(base + "/api/v3/athlete/activities?per_page=100&after=" + since, {headers: {Authorization: "Bearer " + tok}});
  if (r.status === 429){ await logEvent(env, "strava_sync", false, "429 rate limited"); throw new HttpError(429, "Strava is busy. Try again in a few minutes."); }
  if (!r.ok){ await logEvent(env, "strava_sync", false, "HTTP " + r.status); throw new HttpError(502, "Couldn't reach Strava right now."); }
  const list = await r.json(), t = now();
  const known = new Set((await env.DB.prepare("SELECT ext_id FROM activities WHERE user_id = ? AND source = 'strava'").bind(user.id).all()).results.map(x => x.ext_id));
  const ops = list.slice(0, 100).map(a => env.DB.prepare(
    "INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, poly, start_local, elev_ft, sport, max_hr, created) VALUES (?, ?, 'strava', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id, source, ext_id) DO UPDATE SET date = excluded.date, type = excluded.type, name = excluded.name, mi = excluded.mi, minutes = excluded.minutes, cal = CASE WHEN excluded.cal > 0 THEN excluded.cal ELSE activities.cal END, avg_hr = excluded.avg_hr, " +
    "poly = CASE WHEN COALESCE(length(activities.poly), 0) > COALESCE(length(excluded.poly), 0) THEN activities.poly ELSE excluded.poly END, start_local = excluded.start_local, elev_ft = excluded.elev_ft, sport = excluded.sport, max_hr = excluded.max_hr")
    .bind(rand(10), user.id, String(a.id), String(a.start_date_local || "").slice(0, 10), TYPE_MAP(a.sport_type || a.type || ""), String(a.name || "Activity").slice(0, 80),
      Math.round((a.distance || 0) / 1609.34 * 100) / 100, Math.round((a.moving_time || 0) / 60), n0(a.calories || (a.kilojoules ? a.kilojoules * 1.1 : 0)), n0(a.average_heartrate),
      (a.map && a.map.summary_polyline || "").slice(0, 20000) || null, String(a.start_date_local || "").slice(0, 16), Math.round((a.total_elevation_gain || 0) * 3.281), String(a.sport_type || a.type || "").slice(0, 30), n0(a.max_heartrate), t));
  ops.push(env.DB.prepare("UPDATE strava_links SET last_sync = ? WHERE user_id = ?").bind(t, user.id));
  // same workout from Garmin and from Strava: keep the Strava copy (it has the route map)
  ops.push(env.DB.prepare("DELETE FROM activities WHERE user_id = ? AND source = 'garmin' AND EXISTS (SELECT 1 FROM activities s WHERE s.user_id = activities.user_id AND s.source = 'strava' AND s.date = activities.date AND s.type = activities.type AND ABS(s.minutes - activities.minutes) <= 3 AND ABS(s.mi - activities.mi) <= 0.2)").bind(user.id));
  await env.DB.batch(ops);
  // lap splits for runs from the last 2 weeks that don't have them yet (needed to check workout reps)
  const need = (await env.DB.prepare("SELECT id, ext_id FROM activities WHERE user_id = ? AND source = 'strava' AND type = 'run' AND laps IS NULL AND date >= ? ORDER BY date DESC LIMIT 4")
    .bind(user.id, new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)).all()).results;
  for (const x of need){
    try {
      // the full activity has the lap splits and the full-detail route (the list only has a simplified route)
      const lr = await fetch(base + "/api/v3/activities/" + x.ext_id, {headers: {Authorization: "Bearer " + tok}});
      if (!lr.ok) break;
      const d = await lr.json();
      const laps = (Array.isArray(d.laps) ? d.laps : []).slice(0, 80).map(l => [Math.round(l.distance || 0), Math.round(l.moving_time || 0), Math.round(l.average_heartrate || 0)]);
      const full = d.map && d.map.polyline && d.map.polyline.length <= 60000 ? d.map.polyline : null;
      await env.DB.prepare("UPDATE activities SET laps = ?, poly = COALESCE(?, poly) WHERE id = ?").bind(JSON.stringify(laps), full, x.id).run();
    } catch(e){ break; }
  }
  const fresh = list.filter(a => !known.has(String(a.id))).map(a => String(a.id));
  await logEvent(env, "strava_sync", true, list.length + " seen, " + fresh.length + " new");
  if (fresh.length && ctx) ctx.waitUntil(afterNewActivities(env, user.id, fresh, "strava").catch(e => console.log("after-sync", e && e.stack || e)));
  return {synced: list.length, fresh: fresh.length, last_sync: t};
}

/* ---------- Garmin Connect (OAuth2 PKCE + push notifications) ----------
   Secrets GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET. Redirect URL registered in the Garmin portal:
   <worker>/api/garmin/callback. Every data endpoint in Garmin's API tools points to <worker>/api/garmin/push. */
const GARMIN_AUTH = "https://connect.garmin.com/oauth2Confirm", GARMIN_TOKEN = "https://connectapi.garmin.com/di-oauth2-service/oauth/token", GARMIN_API = "https://apis.garmin.com";
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const G_TYPE = t => { t = String(t || "").toUpperCase(); return /RUN|TREADMILL|TRACK/.test(t) ? "run" : /CYCL|BIK|RIDE|SPIN|MOUNTAIN|GRAVEL|ROAD/.test(t) ? "bike" : /SWIM/.test(t) ? "swim" : /STRENGTH|HIIT|CARDIO_TRAINING|FITNESS_EQUIPMENT|INDOOR_CARDIO|TRAINING/.test(t) ? "lift" : "other"; };
const G_NAME = t => String(t || "Activity").toLowerCase().replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()).slice(0, 80);
async function garminToken(env, link){
  if (link.expires_at > Date.now() / 1000 + 600) return link.access_token;
  const r = await fetch(env.GARMIN_TOKEN_URL || GARMIN_TOKEN, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({grant_type: "refresh_token", client_id: env.GARMIN_CLIENT_ID, client_secret: env.GARMIN_CLIENT_SECRET, refresh_token: link.refresh_token})});
  if (!r.ok){ await logEvent(env, "garmin_token", false, "refresh HTTP " + r.status); throw new HttpError(502, "Garmin needs you to reconnect. Open Settings and connect Garmin again."); }
  const j = await r.json();
  await env.DB.prepare("UPDATE garmin_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?").bind(j.access_token, j.refresh_token || link.refresh_token, Math.floor(Date.now() / 1000) + (j.expires_in || 86400), link.user_id).run();
  return j.access_token;
}
// Google polyline encoding (same format as Strava's summary_polyline, which the app already draws)
function encodePolyline(pts){
  let out = "", pl = 0, pn = 0;
  const enc1 = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20){ s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, ln] of pts){ const a = Math.round(la * 1e5), b = Math.round(ln * 1e5); out += enc1(a - pl) + enc1(b - pn); pl = a; pn = b; }
  return out;
}
// one day of watch numbers; Garmin wins over Apple Health for the same day
async function saveHealth(env, userId, date, saved, src){
  const DK = ["sleep_h", "rhr", "hrv", "steps", "active_cal", "sleep_score", "bb", "stress"], dk = DK.filter(k => saved[k] != null);
  if (!dk.length || !isDate(date)) return;
  const set = k => src === "garmin" ? k + " = COALESCE(excluded." + k + ", health_daily." + k + ")" : k + " = CASE WHEN health_daily.source = 'garmin' AND health_daily." + k + " IS NOT NULL THEN health_daily." + k + " ELSE excluded." + k + " END";
  await env.DB.prepare("INSERT INTO health_daily (user_id, date, " + DK.join(", ") + ", source, updated) VALUES (?, ?, " + DK.map(() => "?").join(", ") + ", ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET " +
    dk.map(set).join(", ") + ", source = CASE WHEN health_daily.source = 'garmin' OR excluded.source = 'garmin' THEN 'garmin' ELSE excluded.source END, updated = excluded.updated")
    .bind(userId, date, ...DK.map(k => saved[k] ?? null), src, now()).run();
}
const gDate = (sec, off) => new Date(((sec || 0) + (off || 0)) * 1000).toISOString();
async function garminPush(env, data, ctx){
  const ids = new Set();
  for (const k of Object.keys(data || {})) if (Array.isArray(data[k])) data[k].forEach(x => x && x.userId && ids.add(String(x.userId)));
  if (!ids.size) return;
  const links = (await env.DB.prepare("SELECT user_id, garmin_user_id FROM garmin_links WHERE garmin_user_id IN (" + [...ids].map(() => "?").join(",") + ")").bind(...ids).all()).results;
  const who = Object.fromEntries(links.map(l => [l.garmin_user_id, l.user_id])), seen = {}, fresh = {};
  const uid = x => who[String(x.userId)];
  for (const d of data.deregistrations || []){ const u = uid(d); if (u) await garminForget(env, u, false); }
  for (const p of data.userPermissionsChange || []){ const u = uid(p); if (u) await env.DB.prepare("UPDATE garmin_links SET permissions = ? WHERE user_id = ?").bind(JSON.stringify(p.permissions || []).slice(0, 500), u).run(); }
  const actList = [...(data.activities || []), ...(data.manuallyUpdatedActivities || []), ...(data.activityDetails || []).filter(d => d.summary).map(d => ({...d.summary, userId: d.userId, summaryId: String(d.summaryId || d.summary.summaryId || "").replace(/-detail$/, ""), _fromDetail: true}))];
  for (const a of actList){
    const u = uid(a); if (!u) continue; seen[u] = 1;
    const ext = String(a.summaryId || a.activityId || ""); if (!ext) continue;
    const local = gDate(a.startTimeInSeconds, a.startTimeOffsetInSeconds), date = local.slice(0, 10), type = G_TYPE(a.activityType), mi = Math.round((a.distanceInMeters || 0) / 1609.34 * 100) / 100, min = Math.round((a.durationInSeconds || 0) / 60);
    // same workout already came in from Strava (the person has both linked): keep the Strava one, it has the map
    const dup = await env.DB.prepare("SELECT 1 FROM activities WHERE user_id = ? AND source = 'strava' AND date = ? AND type = ? AND ABS(minutes - ?) <= 3 AND ABS(mi - ?) <= 0.2 LIMIT 1").bind(u, date, type, min, mi).first();
    if (dup) continue;
    const known = await env.DB.prepare("SELECT 1 FROM activities WHERE user_id = ? AND source = 'garmin' AND ext_id = ?").bind(u, ext).first();
    await env.DB.prepare("INSERT INTO activities (id, user_id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, start_local, elev_ft, sport, max_hr, created) VALUES (?, ?, 'garmin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      (a._fromDetail ? "ON CONFLICT (user_id, source, ext_id) DO NOTHING" : "ON CONFLICT (user_id, source, ext_id) DO UPDATE SET date = excluded.date, type = excluded.type, name = excluded.name, mi = excluded.mi, minutes = excluded.minutes, cal = excluded.cal, avg_hr = excluded.avg_hr, start_local = excluded.start_local, elev_ft = excluded.elev_ft, sport = excluded.sport, max_hr = excluded.max_hr"))
      .bind(rand(10), u, ext, date, type, String(a.activityName || G_NAME(a.activityType)).slice(0, 80), mi, min, n0(a.activeKilocalories), n0(a.averageHeartRateInBeatsPerMinute), local.slice(0, 16),
        Math.round((a.totalElevationGainInMeters || 0) * 3.281), String(a.activityType || "").slice(0, 30), n0(a.maxHeartRateInBeatsPerMinute), now()).run();
    if (!known) (fresh[u] = fresh[u] || []).push(ext);
  }
  // route map + lap splits from the detailed activity
  for (const d of data.activityDetails || []){
    const u = uid(d); if (!u) continue; seen[u] = 1;
    const ext = String(d.summaryId || d.activityId || "").replace(/-detail$/, ""), sm = d.samples || [];
    const pts = sm.filter(s => s.latitudeInDegree != null && s.longitudeInDegree != null).map(s => [s.latitudeInDegree, s.longitudeInDegree]);
    const step = Math.max(1, Math.ceil(pts.length / 1500)), poly = pts.length > 1 ? encodePolyline(pts.filter((_, i) => i % step === 0 || i === pts.length - 1)).slice(0, 20000) : null;
    let laps = null;
    if (Array.isArray(d.laps) && d.laps.length > 1 && sm.length){
      const at = t => { let i = sm.findIndex(s => s.startTimeInSeconds >= t); return i < 0 ? sm.length - 1 : i; };
      const bounds = d.laps.map(l => at(l.startTimeInSeconds)).concat([sm.length - 1]);
      laps = []; for (let i = 0; i < bounds.length - 1; i++){
        const a = sm[bounds[i]], b = sm[bounds[i + 1]], seg = sm.slice(bounds[i], bounds[i + 1] + 1).map(s => s.heartRate).filter(h => h > 0);
        laps.push([Math.round((b.totalDistanceInMeters || 0) - (a.totalDistanceInMeters || 0)), Math.round((b.timerDurationInSeconds ?? b.startTimeInSeconds) - (a.timerDurationInSeconds ?? a.startTimeInSeconds)), seg.length ? Math.round(seg.reduce((x, y) => x + y, 0) / seg.length) : 0]);
      }
      laps = laps.filter(l => l[1] > 0).slice(0, 80);
    }
    if (poly || laps) await env.DB.prepare("UPDATE activities SET poly = COALESCE(?, poly), laps = COALESCE(?, laps) WHERE user_id = ? AND source = 'garmin' AND ext_id = ?").bind(poly, laps ? JSON.stringify(laps) : null, u, ext).run();
  }
  const woke = {};
  for (const s of data.sleeps || []){
    const u = uid(s); if (!u) continue; seen[u] = 1; if (!woke[u] || s.calendarDate > woke[u]) woke[u] = s.calendarDate;
    const h = (s.durationInSeconds || 0) / 3600, sc = s.overallSleepScore && s.overallSleepScore.value;
    await saveHealth(env, u, s.calendarDate, {sleep_h: h >= 1 && h <= 16 ? Math.round(h * 100) / 100 : null, sleep_score: sc >= 0 && sc <= 100 ? Math.round(sc) : null}, "garmin");
  }
  for (const d of data.dailies || []){
    const u = uid(d); if (!u) continue; seen[u] = 1;
    const r = d.restingHeartRateInBeatsPerMinute, st = d.averageStressLevel;
    await saveHealth(env, u, d.calendarDate, {rhr: r >= 25 && r <= 150 ? Math.round(r) : null, steps: d.steps >= 0 && d.steps <= 150000 ? Math.round(d.steps) : null,
      active_cal: d.activeKilocalories >= 0 && d.activeKilocalories <= 8000 ? Math.round(d.activeKilocalories) : null, stress: st >= 0 && st <= 100 ? Math.round(st) : null}, "garmin");
  }
  for (const v of data.hrv || []){
    const u = uid(v); if (!u) continue; seen[u] = 1;
    if (!woke[u] || v.calendarDate > woke[u]) woke[u] = v.calendarDate;
    const x = v.lastNightAvg; await saveHealth(env, u, v.calendarDate, {hrv: x >= 5 && x <= 300 ? Math.round(x) : null}, "garmin");
  }
  for (const u of Object.keys(seen)) await env.DB.prepare("UPDATE garmin_links SET last_push = ? WHERE user_id = ?").bind(now(), u).run();
  await logEvent(env, "garmin_push", true, Object.keys(data).filter(k => Array.isArray(data[k])).map(k => k + ":" + data[k].length).join(",").slice(0, 120));
  for (const [u, list] of Object.entries(fresh)) ctx.waitUntil(afterNewActivities(env, u, list, "garmin").catch(e => console.log("garmin review", e && e.stack || e)));
  for (const [u, d] of Object.entries(woke)) ctx.waitUntil(wakeUp(env, u, d).catch(e => console.log("wake", e && e.stack || e)));
}
// stop Garmin access and delete stored Garmin data (privacy policy: disconnect deletes Garmin data)
async function garminForget(env, userId, tellGarmin){
  const link = await env.DB.prepare("SELECT * FROM garmin_links WHERE user_id = ?").bind(userId).first();
  if (link && tellGarmin){ try { const tok = await garminToken(env, link); await fetch((env.GARMIN_API || GARMIN_API) + "/wellness-api/rest/user/registration", {method: "DELETE", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
  await env.DB.batch([env.DB.prepare("DELETE FROM garmin_links WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM garmin_workouts WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM activities WHERE user_id = ? AND source = 'garmin'").bind(userId),
    env.DB.prepare("DELETE FROM health_daily WHERE user_id = ? AND source = 'garmin'").bind(userId)]);
}

/* ---------- each person's data, in their own time zone ---------- */
const DEFAULT_SETTINGS = {tz: "America/New_York", morning: "07:00", bedtime: "21:30", run_time: "07:00", n_morning: true, n_run: true, n_weekly: true, n_bed: true};
function localNow(tz){
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"})
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return {date: parts.year + "-" + parts.month + "-" + parts.day, hm: (parts.hour === "24" ? "00" : parts.hour) + ":" + parts.minute, weekday: parts.weekday};
}
/* crew leaderboard: nickname + one weekly total per member. Nothing else about anyone is shared. */
async function crewsFor(env, userId, weekOf){
  const mine = (await env.DB.prepare("SELECT c.id, c.name, c.code, c.owner_id, c.metric, m.nickname FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.user_id = ? ORDER BY c.created").bind(userId).all()).results;
  if (!mine.length) return [];
  const st = await settingsOf(env, userId), today = localNow(st.tz).date;
  const d = new Date(today + "T12:00:00Z"), mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10), sun = new Date(Date.parse(mon + "T12:00:00Z") + 6 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const c of mine){
    const rows = (await env.DB.prepare("SELECT m.user_id, m.nickname, " +
      "COALESCE((SELECT SUM(minutes) FROM activities a WHERE a.user_id = m.user_id AND a.source != 'strava' AND a.date BETWEEN ? AND ?), 0) AS minutes, " +
      "COALESCE((SELECT COUNT(*) FROM activities a WHERE a.user_id = m.user_id AND a.source != 'strava' AND a.date BETWEEN ? AND ?), 0) AS workouts, " +
      "COALESCE((SELECT SUM(mi) FROM activities a WHERE a.user_id = m.user_id AND a.source != 'strava' AND a.type = 'run' AND a.date BETWEEN ? AND ?), 0) AS run_miles, " +
      "COALESCE((SELECT COUNT(DISTINCT date) FROM activities a WHERE a.user_id = m.user_id AND a.source != 'strava' AND a.date BETWEEN ? AND ?), 0) AS days " +
      "FROM crew_members m WHERE m.crew_id = ?").bind(mon, sun, mon, sun, mon, sun, mon, sun, c.id).all()).results;
    const board = rows.map(r => ({nickname: r.nickname, value: Math.round((r[c.metric] || 0) * 10) / 10, you: r.user_id === userId})).sort((a, b) => b.value - a.value);
    out.push({id: c.id, name: c.name, code: c.code, metric: c.metric, owner: c.owner_id === userId, nickname: c.nickname, week: mon, members: board.length, board});
  }
  return out;
}
async function settingsOf(env, userId){
  const row = await env.DB.prepare("SELECT data FROM settings WHERE user_id = ?").bind(userId).first();
  let s = {}; try { s = row ? JSON.parse(row.data) : {}; } catch(e){}
  return {...DEFAULT_SETTINGS, ...s};
}
/* ---------- Garmin watch workouts (Training API) ----------
   Keeps the next 7 days of planned runs/rides/swims on the athlete's Garmin calendar. Each session is
   stored with a hash of what was sent; when the plan or its feedback changes the workout is replaced. */
async function garminPerms(env, link, tok){
  const r = await fetch((env.GARMIN_API || GARMIN_API) + "/wellness-api/rest/user/permissions", {headers: {Authorization: "Bearer " + tok}}).catch(() => null);
  if (!r || !r.ok) return null;
  const perms = await r.json().catch(() => null);
  if (Array.isArray(perms)) await env.DB.prepare("UPDATE garmin_links SET permissions = ? WHERE user_id = ?").bind(JSON.stringify(perms).slice(0, 500), link.user_id).run();
  return perms;
}
async function garminWorkouts(env, userId, opts){
  const link = await env.DB.prepare("SELECT * FROM garmin_links WHERE user_id = ?").bind(userId).first();
  if (!link) return {ok: false, why: "not_connected"};
  const st = await settingsOf(env, userId), L = localNow(st.tz), today = L.date;
  const U = await loadUser(env, userId, today); if (!U || !U.plan) return {ok: false, why: "no_plan"};
  const tok = await garminToken(env, link);
  let perms = null; try { perms = JSON.parse(link.permissions || "null"); } catch(e){}
  if (!Array.isArray(perms) || (opts && opts.recheck)) perms = await garminPerms(env, link, tok) || perms;
  if (!Array.isArray(perms) || !perms.includes("WORKOUT_IMPORT")) return {ok: false, why: "needs_permission"};
  const base = env.GARMIN_API || GARMIN_API, H = {Authorization: "Bearer " + tok, "Content-Type": "application/json"};
  const F = HP.feedback(U.plan, U.acts, today);
  const have = {}; (await env.DB.prepare("SELECT * FROM garmin_workouts WHERE user_id = ? AND date >= ?").bind(userId, today).all()).results.forEach(r => have[r.date + "-" + r.idx] = r);
  const want = {};
  for (let d = 0; d < 7; d++){
    const date = HP.addDays(today, d), day = HP.dayOf(U.plan, date); if (!day) continue;
    const done = HP.dayMatches(U.plan, U.acts, date);
    day.sessions.forEach((s, i) => { if (done[i]) return; const w = HP.garminWorkout(U.plan, s, F.offs, F.extra[date + "-" + i], date); if (w) want[date + "-" + i] = {date, i, w}; });
  }
  let added = 0, removed = 0, failed = 0, calls = 0;
  const drop = async r => {
    if (r.schedule_id){ calls++; await fetch(base + "/training-api/schedule/" + r.schedule_id, {method: "DELETE", headers: H}).catch(() => null); }
    if (r.workout_id){ calls++; await fetch(base + "/training-api/workout/v2/" + r.workout_id, {method: "DELETE", headers: H}).catch(() => null); }
    await env.DB.prepare("DELETE FROM garmin_workouts WHERE user_id = ? AND date = ? AND idx = ?").bind(userId, r.date, r.idx).run(); removed++;
  };
  for (const k of Object.keys(have)) if (!want[k]) await drop(have[k]);
  for (const k of Object.keys(want)){
    if (calls > 40) break;   // stay well under Garmin's 200 calls per athlete per day
    const {date, i, w} = want[k], hash = (await sha256(JSON.stringify(w))).slice(0, 16);
    if (have[k] && have[k].hash === hash) continue;
    if (have[k]) await drop(have[k]);
    calls++;
    const cr = await fetch(base + "/workoutportal/workout/v2", {method: "POST", headers: H, body: JSON.stringify(w)}).catch(() => null);
    if (!cr || !cr.ok){ failed++; await logEvent(env, "garmin_workout", false, "create " + (cr ? cr.status + " " + (await cr.text()).slice(0, 140) : "net")); if (cr && (cr.status === 412 || cr.status === 403)) return {ok: false, why: "needs_permission"}; continue; }
    const cw = await cr.json().catch(() => ({}));
    calls++;
    const sr = await fetch(base + "/training-api/schedule/", {method: "POST", headers: H, body: JSON.stringify({workoutId: cw.workoutId, date})}).catch(() => null);
    const sid = sr && sr.ok ? await sr.text().then(t => { try { const j = JSON.parse(t); return String(j.scheduleId || j); } catch(e){ return t.trim(); } }) : null;
    if (!sid){ failed++; await logEvent(env, "garmin_workout", false, "schedule " + (sr ? sr.status : "net")); }
    await env.DB.prepare("INSERT INTO garmin_workouts (user_id, date, idx, hash, workout_id, schedule_id, updated) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, date, idx) DO UPDATE SET hash = excluded.hash, workout_id = excluded.workout_id, schedule_id = excluded.schedule_id, updated = excluded.updated")
      .bind(userId, date, i, sid ? hash : "retry", String(cw.workoutId || ""), sid, now()).run();
    if (sid) added++;
  }
  if (added || removed || failed) await logEvent(env, "garmin_workout", failed === 0, added + " sent, " + removed + " removed, " + failed + " failed");
  return {ok: failed === 0, added, removed, failed, upcoming: Object.keys(want).length};
}
async function loadUser(env, userId, today){
  const since = HP.addDays(today, -70);
  const [p, a, w, c, f, u, hd] = await env.DB.batch([
    env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, laps, work_pace FROM activities WHERE user_id = ? AND date >= ? ORDER BY date, created").bind(userId, since),
    env.DB.prepare("SELECT date, lb FROM weights WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -200)),
    env.DB.prepare("SELECT date, sleep_h, sleep_q, soreness, energy, stress FROM checkins WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -14)),
    env.DB.prepare("SELECT date, cal FROM food WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -14)),
    env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(userId),
    env.DB.prepare("SELECT date, sleep_h, rhr, hrv, steps, active_cal, sleep_score, bb, stress, source FROM health_daily WHERE user_id = ? AND date >= ?").bind(userId, HP.addDays(today, -21))
  ]);
  if (!p.results[0]) return null;
  const profile = JSON.parse(p.results[0].data), plan = HP.buildPlan(profile, today);
  const weights = {}; w.results.forEach(x => weights[x.date] = x.lb);
  const checkins = {}; c.results.forEach(x => checkins[x.date] = x);
  const eaten = {}; f.results.forEach(x => eaten[x.date] = (eaten[x.date] || 0) + x.cal);
  const dev = {}; hd.results.forEach(x => dev[x.date] = x);
  return {profile, plan, acts: a.results, weights, checkins, eaten, dev, name: (u.results[0] || {}).name || ""};
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
/* health log for the nightly check: cron runs, Strava notices and syncs, notifications, AI calls */
async function logEvent(env, kind, ok, detail){
  try { await env.DB.prepare("INSERT INTO events (ts, kind, ok, detail) VALUES (?, ?, ?, ?)").bind(now(), kind, ok ? 1 : 0, detail ? String(detail).slice(0, 300) : null).run(); } catch(e){}
}
// trim to the last full sentence that fits
const clip = (t, n) => { if (t.length <= n) return t; const c = t.slice(0, n), i = Math.max(c.lastIndexOf(". "), c.lastIndexOf("! "), c.lastIndexOf("? ")); return i > 40 ? c.slice(0, i + 1) : c.replace(/\s+\S*$/, "") + "…"; };
async function askCoach(env, system, data){
  if (!env.ANTHROPIC_API_KEY) return null;
  const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST",
    headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({model: env.COACH_MODEL || "claude-haiku-5-5", max_tokens: 1500, system, messages: [{role: "user", content: JSON.stringify(data)}]})});
  if (!r.ok){ const t = (await r.text()).slice(0, 300); console.log("coach error", r.status, t); lastCoachError = "api " + r.status + " " + t; await logEvent(env, "ai_coach", false, lastCoachError); return null; }
  const out = await r.json(), raw = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  try { const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); await logEvent(env, "ai_coach", true); return j; } catch(e){ lastCoachError = "unreadable reply (" + out.stop_reason + "): " + raw.slice(0, 200); await logEvent(env, "ai_coach", false, lastCoachError); return null; }
}
const COACH_STYLE = "You are a friendly, plain-spoken running and strength coach writing inside a training app. No jargon (no 'Z2', 'ACWR', 'EF'), no emoji, no medical advice, never shame. " +
  "Safety rules: you are not a doctor, dietitian or nutritionist and never call yourself one. Don't diagnose, don't recommend supplements, medications or specific diets, and never suggest eating less than the app's calorie target, skipping meals or making up for food with extra exercise. " +
  "If the numbers or notes hint at pain, injury, illness, dizziness, chest pain or very little sleep, say to take it easy and check with a doctor if it doesn't get better. Use the numbers you are given; don't invent any.";
// Strava's API terms don't allow Strava data in AI prompts (not even data derived from it). So:
//  - Garmin / hand-logged workouts: the AI coach sees the workout numbers.
//  - Strava workouts: a rule-based summary right away (no AI), then the AI coaches only from what the
//    person tells us about the session ("how did it feel" + their own words) and the planned session.
const noStrava = U => ({...U, acts: U.acts.filter(a => a.source !== "strava")});
async function runReview(env, userId, U, act, today, feel){
  const strava = act.source === "strava", A = noStrava(U);
  const fbkAll = HP.feedback(U.plan, U.acts, HP.addDays(act.date, 1));
  const m = HP.dayMatches(U.plan, U.acts, act.date), idx = Object.keys(m).find(i => m[i].id === act.id);
  const day = HP.dayOf(U.plan, act.date), s = idx != null && day ? day.sessions[idx] : null;
  const as = s ? fbkAll.assess[act.date + "-" + idx] : null;
  const next = HP.feedback(U.plan, (strava ? A : U).acts, HP.addDays(act.date, 1)), nextKeys = Object.keys(next.notes).slice(0, 2).map(k => next.notes[k]);
  const pace = act.mi > 0 && act.minutes > 0 ? HP.fmtPace(act.minutes * 60 / act.mi) + "/mi" : null;
  const ruleBased = {headline: as ? ({ok: "On target", easy: "Came in fast", hard: "Too hard", unknown: "Done"})[as.verdict] : "Done", numbers: [act.mi ? act.mi + " mi" : "", pace || "", act.avg_hr ? act.avg_hr + " bpm" : ""].filter(Boolean).join(" · "),
    meaning: as ? as.why : "", next: nextKeys[0] || "Next sessions stay as planned.", verdict: as ? as.verdict : "extra", title: s ? s.title : act.name};
  let review;
  if (strava && !feel) review = {...ruleBased, askFeel: true};
  else {
    const data = strava
      ? {planned: s ? {title: s.title, steps: s.steps.map(x => x[0]), type: s.type} : {title: "Extra workout"}, athlete_says: {how_it_felt: feel.feel, notes: feel.note || ""}, tomorrow: sessionsText(U, HP.addDays(act.date, 1), next)}
      : {activity: {name: act.name, type: act.type, miles: act.mi, minutes: act.minutes, avg_pace: pace, avg_hr: act.avg_hr || null},
         planned: s ? {title: s.title, steps: s.steps.map(x => x[0]), type: s.type} : null, check: as ? {verdict: as.verdict, explanation: as.why} : null,
         pace_changes_for_next_workouts_s_per_mi: next.offs, upcoming_notes: nextKeys, tomorrow: sessionsText(U, HP.addDays(act.date, 1), next)};
    const prompt = strava
      ? COACH_STYLE + ' Write short post-workout coaching from what the athlete says about how the session felt, compared with what was planned. You do not have their workout numbers, so do not mention or invent any. Reply with ONLY JSON: {"headline":"2-5 word verdict","meaning":"one sentence under 25 words on what their feedback means","next":"one sentence under 25 words on what to do next"}'
      : COACH_STYLE + ' Write a post-workout summary. Reply with ONLY JSON: {"headline":"2-5 word verdict","numbers":"key numbers joined with \' · \'","meaning":"one sentence under 25 words on what it means","next":"one sentence under 25 words on what comes next"}';
    const out = await askCoach(env, prompt, data);
    review = out && out.headline
      ? {headline: String(out.headline).slice(0, 60), numbers: strava ? ruleBased.numbers : clip(String(out.numbers || ""), 140), meaning: clip(String(out.meaning || ""), 240), next: clip(String(out.next || ""), 240), verdict: as ? as.verdict : "extra", title: s ? s.title : act.name, ...(strava ? {feel: feel.feel} : {})}
      : {...ruleBased, ...(strava ? {feel: feel.feel} : {})};
  }
  await env.DB.prepare("INSERT INTO reviews (activity_id, user_id, date, data, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (activity_id) DO UPDATE SET data = excluded.data")
    .bind(act.id, userId, act.date, JSON.stringify(review), now()).run();
  return review;
}
async function afterNewActivities(env, userId, ids, source){
  const st = await settingsOf(env, userId), L = localNow(st.tz), U = await loadUser(env, userId, L.date);
  if (!U) return;
  const fresh = U.acts.filter(a => (source === "manual" ? ids.includes(a.id) : ids.includes(a.ext_id)) && a.date >= HP.addDays(L.date, -2));
  for (const a of fresh.slice(0, 3)){
    if (a.source !== "strava" && !(await coachUsage(env, userId))) break;
    const rv = await runReview(env, userId, U, a, L.date);
    if (st.n_run) await pushTo(env, userId, {title: rv.title + ": " + rv.headline, body: rv.askFeel ? [rv.numbers, "How did it feel? Tap to tell your coach."].filter(Boolean).join("\n") : [rv.numbers, rv.next].filter(Boolean).join("\n"), tag: "run-" + a.id});
  }
}
async function morningNote(env, userId, today){
  const U0 = await loadUser(env, userId, today); if (!U0) return null;
  const U = noStrava(U0);   // Strava data never goes into AI prompts
  const fbk = HP.feedback(U.plan, U.acts, today), c = U.checkins[today], sig = HP.devSignals(U.dev, today), r = HP.readiness(c, sig), f = HP.fuel(U.plan, U.weights, U.acts, today);
  const yday = HP.addDays(today, -1), fy = HP.fuel(U.plan, U.weights, U.acts, yday);
  const recent = U.acts.filter(a => a.date >= HP.addDays(today, -3) && a.date < today).map(a => a.name + " " + (a.mi ? a.mi + " mi" : a.minutes + " min"));
  const a7 = HP.avgW(U.weights, today), a14 = HP.avgW(U.weights, HP.addDays(today, -7));
  const data = {name: (U.name || "").split(" ")[0], readiness: r ? (c ? {score: r.score, call: r.word, sleep_h: c.sleep_h, soreness_1to5: c.soreness, energy_1to5: c.energy, stress_1to5: c.stress} : {score: r.score, call: r.word, based_on: "watch only, no check-in yet"}) : null,
    today: sessionsText(U, today, fbk), adjustment_rule: r && r.level ? "Today's sessions are adjusted: " + (r.level === 1 ? "one rep fewer, long run 2 mi shorter, easy runs strictly easy" : "easy or rest, workout moves later in the week") : "train as planned",
    plan_notes_today: Object.keys(fbk.notes).filter(k => k.startsWith(today)).map(k => fbk.notes[k]),
    calories_today_target: f.cal, protein_g: f.pro, yesterday: U.eaten[yday] ? {eaten: U.eaten[yday], target: fy.cal} : "no food logged",
    weight_7day_avg: a7 ? Math.round(a7 * 10) / 10 : null, weight_change_vs_last_week: a7 && a14 ? Math.round((a7 - a14) * 10) / 10 : null, goal_weight: U.profile.goalWeight || null,
    last_3_days: recent,
    watch: sig ? {sleep_h: sig.sleep_h, resting_hr: sig.rhr, resting_hr_14day_avg: sig.rhrA ? Math.round(sig.rhrA) : null, hrv_ms: sig.hrv, hrv_14day_avg: sig.hrvA ? Math.round(sig.hrvA) : null, flags: sig.notes,
      sleep_score: (U.dev[today] || {}).sleep_score ?? null, body_battery_at_wake: (U.dev[today] || {}).bb ?? null, stress_avg: (U.dev[today] || {}).stress ?? null, source: (U.dev[today] || {}).source || null} : "no watch data today"};
  const out = await askCoach(env, COACH_STYLE + ' Write the morning check-in note. Reply with ONLY JSON: {"headline":"2-6 words","lines":["recovery read, under 20 words","today\'s session, under 20 words","fuel for today, under 20 words"]}. Three separate array items, one sentence each.', data);
  if (!out || !out.headline) return null;
  const note = {headline: String(out.headline).slice(0, 60), lines: (Array.isArray(out.lines) ? out.lines : []).slice(0, 3).map(x => clip(String(x), 220))};
  await env.DB.prepare("INSERT INTO coach_notes (user_id, date, kind, data, created) VALUES (?, ?, 'morning', ?, ?) ON CONFLICT (user_id, date, kind) DO UPDATE SET data = excluded.data, created = excluded.created")
    .bind(userId, today, JSON.stringify(note), now()).run();
  return note;
}

// Garmin sent last night's sleep: readiness is ready, so adjust today and tell the person right away (once a day)
async function wakeUp(env, userId, date){
  const st = await settingsOf(env, userId), L = localNow(st.tz);
  if (date !== L.date || L.hm < "04:00") return;
  if (await env.DB.prepare("SELECT 1 FROM notif_log WHERE user_id = ? AND kind = 'wake' AND day = ?").bind(userId, L.date).first()) return;
  const U = await loadUser(env, userId, L.date); if (!U || !U.plan) return;
  const r = HP.readiness(U.checkins[L.date], HP.devSignals(U.dev, L.date)); if (!r) return;
  if (!(await once(env, userId, "wake", L.date))) return;
  await logEvent(env, "wake_read", true, String(r.score));
  if (!U.checkins[L.date] && (await coachUsage(env, userId))) await morningNote(env, userId, L.date).catch(e => console.log("wake note", e && e.message));
  if (st.n_morning){
    const fbk = HP.feedback(U.plan, U.acts, L.date), adj = ["Train as planned", "Today's session is trimmed", "Easy day or rest today"][r.level];
    await pushTo(env, userId, {title: "Readiness " + r.score + " · " + r.word, body: adj + ". Today: " + sessionsText(U, L.date, fbk) + ". Check in for a fuller read.", tag: "morning-" + L.date});
    await once(env, userId, "morning", L.date);   // no second morning reminder
  }
}
/* ---------- push notifications ---------- */
async function pushTo(env, userId, msg){
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return 0;
  const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE user_id = ?").bind(userId).all()).results;
  const vapid = {subject: env.VAPID_SUBJECT || "mailto:hybrid-app@users.noreply.github.com", publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE};
  let sent = 0;
  // Apple rejects some topics ("BadWebPushTopic"): send a short letters-and-digits one made from the tag
  const topic = (await sha256(msg.tag || "hybrid")).slice(0, 24);
  for (const s of subs){
    try {
      const payload = await buildPushPayload({data: JSON.stringify({url: (env.APP_URL || "") + "#today", ...msg}), options: {ttl: 6 * 3600, urgency: "normal", topic}},
        {endpoint: s.endpoint, expirationTime: null, keys: {p256dh: s.p256dh, auth: s.auth}}, vapid);
      const r = await fetch(s.endpoint, payload);
      if (r.status === 404 || r.status === 410){ await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run(); await logEvent(env, "push", false, "expired subscription removed (" + r.status + ")"); }
      else if (r.ok){ sent++; await logEvent(env, "push", true, msg.tag || ""); }
      else { const t = (await r.text()).slice(0, 200); console.log("push failed", r.status, t); await logEvent(env, "push", false, r.status + " " + t); }
    } catch(e){ console.log("push error", e && e.message); await logEvent(env, "push", false, "error " + (e && e.message)); }
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
  await logEvent(env, "cron", true);
  await outbox(env).catch(e => logEvent(env, "bulk_mail", false, "outbox: " + String(e && e.message).slice(0, 100)));
  // once a day (after 4 am local) refresh the next 7 days of workouts on each athlete's Garmin
  for (const {user_id} of (await env.DB.prepare("SELECT user_id FROM garmin_links WHERE permissions LIKE '%WORKOUT_IMPORT%'").all()).results){
    try { const L = localNow((await settingsOf(env, user_id)).tz); if (L.hm >= "04:00" && await once(env, user_id, "gwork", L.date)) await garminWorkouts(env, user_id); }
    catch(e){ await logEvent(env, "garmin_workout", false, "cron: " + String(e && e.message).slice(0, 100)); }
  }
  await env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(new Date(Date.now() - 21 * 864e5).toISOString()).run();
  await env.DB.prepare("DELETE FROM notif_log WHERE day < ?").bind(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).run();
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
    } catch(e){ console.log("cron user", id, e && e.stack || e); await logEvent(env, "cron_user", false, String(e && e.message || e)); }
  }
}

/* ---------- routes ---------- */
/* ---------- owner: new sign-up notice (push to the owner's phone + an email to the Mileset inbox) ---------- */
async function tellOwnerSignup(env, name, email){
  const own = await ownerId(env), total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@example.com'").first()).n;
  const who = (name ? name + " · " : "") + email;
  if (own) await pushTo(env, own, {title: "New Mileset sign-up", body: who + " · " + total + " members now", tag: "signup", url: (env.APP_URL || "") + "#members"}).catch(() => {});
  if (env.RESEND_API_KEY){
    const esc2 = x => String(x).replace(/[<>&"]/g, "");
    const r = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {method: "POST", headers: {Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json"},
      body: JSON.stringify({from: env.MAIL_FROM || "Mileset <no-reply@hybrdrunning.com>", to: [env.OWNER_NOTIFY || "hybridrunning@gmail.com"], subject: "New sign-up: " + (name || email),
        text: who + " just joined Mileset. You have " + total + " members.\n\nSee everyone in the app: More → Members.",
        html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#111"><p><b>' + esc2(name || "Someone") + '</b> (' + esc2(email) + ') just joined Mileset.</p><p>You have <b>' + total + '</b> members.</p><p style="color:#666">See everyone in the app: More → Members.</p></div>'})}).catch(() => null);
    await logEvent(env, "signup_notice", !!(r && r.ok), r ? "HTTP " + r.status : "net");
  }
}
/* Founding members: the first 100 real accounts made before Jan 1, 2027 get Mileset free for life when paid features come out */
const FOUNDING_END = "2027-01-01T05:00:00.000Z", FOUNDING_MAX = 100;   // midnight Jan 1 in Florida
async function foundingNo(env, userId){
  const u = await env.DB.prepare("SELECT created, email FROM users WHERE id = ?").bind(userId).first();
  if (!u || /@example\.com$/.test(u.email) || u.created >= FOUNDING_END) return null;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@example.com' AND created <= ?").bind(u.created).first()).n;
  return n <= FOUNDING_MAX ? n : null;
}
async function foundingLeft(env){
  if (new Date().toISOString() >= FOUNDING_END) return 0;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@example.com' AND created < ?").bind(FOUNDING_END).first()).n;
  return Math.max(0, FOUNDING_MAX - n);
}
/* email header: the Mileset profile picture + name (hosted with the app; alt text shows if images are off) */
const MAIL_HEAD = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px"><tr><td style="padding-right:12px"><img src="https://app.hybrdrunning.com/brand/profile-240.png" width="52" height="52" alt="Mileset" style="display:block;border-radius:12px;border:0"></td>' +
  '<td style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-weight:800;font-size:20px;letter-spacing:-.02em;color:#111">Mileset</td></tr></table>';
/* welcome email to each new member, signed by Matthew */
async function welcomeMail(env, id, name, email){
  if (!env.RESEND_API_KEY) return;
  const first = String(name || "").trim().split(/\s+/)[0] || "there", esc2 = x => String(x).replace(/[<>&"]/g, "");
  const unsub = API_BASE(env) + "/api/unsubscribe?u=" + id + "&s=" + (await mailSig(env, id));
  const fno = await foundingNo(env, id);
  const paras = ["Hey " + first + ",", "Welcome to Mileset. I'm really glad you're here."].concat(fno ? ["You're Founding Member #" + fno + " of 100. That means Mileset is free for you for life, including anything paid we add later. Thank you for being here early."] : []).concat(["A few things to get the most out of it:"]);
  const steps = ["Build your plan: pick a race, or everyday fitness if you just want to get fitter.", "Connect Strava or Garmin in Settings so your workouts come in on their own.", "Do the 20-second morning check-in. Your day adjusts to how you slept and feel.", "On iPhone, add Mileset to your home screen so it opens like an app."];
  const end = ["Follow along on Instagram @hybrdrunning for tips and early looks at what's coming.", "If you have a question or an idea, just reply to this email. I read every one."];
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;font-size:16px;line-height:1.55">' + MAIL_HEAD +
    paras.map(t => '<p style="margin:0 0 14px">' + esc2(t) + '</p>').join("") + '<ul style="margin:0 0 16px;padding-left:20px">' + steps.map(t => '<li style="margin:0 0 6px">' + esc2(t) + '</li>').join("") + '</ul>' +
    '<p style="margin:0 0 14px">Follow along on Instagram <a href="https://www.instagram.com/hybrdrunning/" style="color:#800000">@hybrdrunning</a> for tips and early looks at what\'s coming.</p><p style="margin:0 0 14px">' + esc2(end[1]) + '</p>' +
    '<p style="margin:22px 0"><a href="https://app.hybrdrunning.com/" style="display:inline-block;background:#800000;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">Open Mileset</a></p>' +
    '<p style="margin:0">Matthew<br><span style="color:#666">Mileset</span></p>' +
    '<p style="font-size:12px;color:#888;margin-top:28px">You\'re getting this because you just made a Mileset account.' + (env.MAIL_ADDRESS ? ' ' + esc2(env.MAIL_ADDRESS) + '.' : '') + ' <a href="' + unsub + '" style="color:#888">Unsubscribe from updates</a></p></div>';
  const text = paras.join("\n\n") + "\n\n" + steps.map(t => "- " + t).join("\n") + "\n\n" + end.join("\n\n") + "\n\nOpen Mileset: https://app.hybrdrunning.com/\n\nMatthew\nMileset\n\nUnsubscribe from updates: " + unsub;
  const r = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {method: "POST", headers: {Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json"},
    body: JSON.stringify({from: env.MAIL_FROM || "Mileset <no-reply@hybrdrunning.com>", to: [email], reply_to: "hybridrunning@gmail.com", subject: "Welcome to Mileset, " + first, html, text, headers: {"List-Unsubscribe": "<" + unsub + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}})}).catch(() => null);
  await logEvent(env, "welcome_mail", !!(r && r.ok), r ? "HTTP " + r.status : "net");
}
/* ---------- owner: email updates to every member (Resend batch API), each with its own unsubscribe link ---------- */
async function mailSig(env, uid){ return (await sha256("unsub:" + uid + ":" + (env.RESEND_API_KEY || ""))).slice(0, 24); }
const API_BASE = env => env.API_URL || "https://hybrid-api.hybridapp.workers.dev";
async function sendUpdate(env, owner, subject, message, test){
  const list = test ? [owner] : (await env.DB.prepare("SELECT id, email, name FROM users WHERE email NOT LIKE '%@example.com' AND no_mail = 0 ORDER BY created").all()).results;
  const esc2 = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linkify = t => t.replace(/https?:\/\/[^\s<]+/g, u => '<a href="' + u + '" style="color:#800000">' + u + '</a>');
  const addr = env.MAIL_ADDRESS || "";
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i += 100){
    const batch = [];
    for (const u of list.slice(i, i + 100)){
      const first = String(u.name || "").trim().split(/\s+/)[0] || "there";
      const body = message.replace(/\{name\}/g, first), unsub = API_BASE(env) + "/api/unsubscribe?u=" + u.id + "&s=" + (await mailSig(env, u.id));
      const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;font-size:16px;line-height:1.55">' +
        MAIL_HEAD +
        body.split(/\n{2,}/).map(par => '<p style="margin:0 0 14px">' + linkify(esc2(par)).replace(/\n/g, "<br>") + '</p>').join("") +
        '<p style="margin:22px 0"><a href="https://app.hybrdrunning.com/" style="display:inline-block;background:#800000;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">Open Mileset</a></p>' +
        '<p style="font-size:12px;color:#888;margin-top:28px">You\'re getting this because you have a Mileset account.' + (addr ? ' ' + esc2(addr) + '.' : '') + ' <a href="' + unsub + '" style="color:#888">Unsubscribe</a></p></div>';
      batch.push({from: env.MAIL_FROM || "Mileset <no-reply@hybrdrunning.com>", to: [u.email], reply_to: "hybridrunning@gmail.com", subject: (test ? "[Test] " : "") + subject,
        html, text: body + "\n\nOpen Mileset: https://app.hybrdrunning.com/\n\n" + (addr ? addr + "\n" : "") + "Unsubscribe: " + unsub,
        headers: {"List-Unsubscribe": "<" + unsub + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}});
    }
    const r = await fetch((env.RESEND_URL || "https://api.resend.com/emails").replace(/\/emails$/, "/emails/batch"), {method: "POST", headers: {Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json"}, body: JSON.stringify(batch)}).catch(() => null);
    if (r && r.ok) sent += batch.length; else { failed += batch.length; await logEvent(env, "bulk_mail", false, r ? "HTTP " + r.status + " " + (await r.text()).slice(0, 150) : "net"); }
  }
  await logEvent(env, "bulk_mail", failed === 0, (test ? "test " : "") + sent + " sent, " + failed + " failed");
  return {sent, failed, total: list.length};
}
/* ---------- weekly member update: mail/outbox.json in the repo (served by GitHub Pages) is sent once, after send_after ---------- */
async function outbox(env){
  if (!env.RESEND_API_KEY) return;
  const r = await fetch((env.OUTBOX_URL || PAGES + "/mail/outbox.json") + "?t=" + Math.floor(Date.now() / 600e3), {cf: {cacheTtl: 0}}).catch(() => null);
  if (!r || !r.ok) return;
  let m; try { m = await r.json(); } catch(e){ return; }
  const id = String(m.id || ""), subject = String(m.subject || "").trim().slice(0, 120), message = String(m.message || "").trim().slice(0, 8000), after = Date.parse(m.send_after || "");
  if (!/^[a-z0-9-]{4,60}$/.test(id) || !subject || message.length < 20 || !(after <= Date.now()) || after < Date.now() - 7 * 864e5) return;
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO mail_sent (id, sent_at) VALUES (?, ?)").bind(id, now()).run();
  if (!claim.meta.changes) return;   // already sent
  const res = await sendUpdate(env, null, subject, message, false);
  await env.DB.prepare("UPDATE mail_sent SET sent = ? WHERE id = ?").bind(res.sent, id).run();
  const own = await ownerId(env);
  if (own) await pushTo(env, own, {title: "Member update sent", body: "\"" + subject + "\" went to " + res.sent + " member" + (res.sent === 1 ? "" : "s") + (res.failed ? " (" + res.failed + " failed)" : "") + ".", tag: "mail-" + id}).catch(() => {});
}
/* ---------- Strong at 180 food estimates (Matthew's own plan page) ----------
   A tiny MCP server the plan page calls through a claude.ai custom connector named "HYBRD Food",
   so food estimates run on this app's Anthropic key instead of the claude.ai plan's usage.
   The URL carries a private key; only its SHA-256 is stored here. */
const S180_KEY_SHA = "9c30c89dd7693c1dc13b323debad38ea03d6868b9967ce3806361a3a0622fba2";
async function sha256hex(t){ return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function foodMcp(req, env, key){
  const H = {"Content-Type": "application/json", "Cache-Control": "no-store"};
  if (!key || (await sha256hex(key)) !== S180_KEY_SHA) return new Response("Not found", {status: 404});
  if (req.method !== "POST") return new Response(null, {status: 405, headers: {Allow: "POST"}});
  let m; try { m = await req.json(); } catch(e){ return new Response(JSON.stringify({jsonrpc: "2.0", id: null, error: {code: -32700, message: "Parse error"}}), {status: 400, headers: H}); }
  const one = async x => {
    const ok = result => ({jsonrpc: "2.0", id: x.id, result}), bad = (code, message) => ({jsonrpc: "2.0", id: x.id ?? null, error: {code, message}});
    if (x.id === undefined) return null;   // notifications need no answer
    if (x.method === "initialize") return ok({protocolVersion: (x.params && x.params.protocolVersion) || "2025-06-18", capabilities: {tools: {}}, serverInfo: {name: "HYBRD Food", version: "1.0"}});
    if (x.method === "ping") return ok({});
    if (x.method === "tools/list") return ok({tools: [{name: "estimate_nutrition", description: "Estimate nutrition for a food log entry. Runs the given instructions (and optional food photos) and returns the JSON object they ask for.",
      inputSchema: {type: "object", properties: {prompt: {type: "string", description: "Instructions ending with the JSON shape to reply in"}, images: {type: "array", items: {type: "string"}, description: "JPEG photos as base64, at most 4"}, effort: {type: "string"}}, required: ["prompt"]}}]});
    if (x.method === "tools/call"){
      const a = (x.params && x.params.arguments) || {}, prompt = String(a.prompt || "").slice(0, 20000), imgs = (Array.isArray(a.images) ? a.images : []).slice(0, 4).map(String);
      if (!prompt) return ok({isError: true, content: [{type: "text", text: "prompt is required"}]});
      const content = imgs.map(d => ({type: "image", source: {type: "base64", media_type: "image/jpeg", data: d.replace(/^data:[^,]*,/, "")}})).concat([{type: "text", text: prompt}]);
      const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST",
        headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 4000, system: "Reply with only the JSON object asked for. No other text.", messages: [{role: "user", content}]})});
      if (!r.ok){ const t = (await r.text()).slice(0, 200); await logEvent(env, "s180_food", false, r.status + " " + t); return ok({isError: true, content: [{type: "text", text: "Estimating failed (" + r.status + "). Try again."}]}); }
      const raw = ((await r.json()).content || []).filter(c => c.type === "text").map(c => c.text).join("");
      let parsed = null; try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch(e){}
      await logEvent(env, "s180_food", !!parsed, parsed ? (imgs.length ? "photo" : "text") : "bad json");
      if (!parsed) return ok({isError: true, content: [{type: "text", text: "Couldn't read the estimate. Try again."}]});
      return ok({content: [{type: "text", text: JSON.stringify(parsed)}], structuredContent: parsed});
    }
    return bad(-32601, "Method not found");
  };
  if (Array.isArray(m)){ const out = (await Promise.all(m.map(one))).filter(Boolean); return out.length ? new Response(JSON.stringify(out), {headers: H}) : new Response(null, {status: 202}); }
  const out = await one(m); return out ? new Response(JSON.stringify(out), {headers: H}) : new Response(null, {status: 202});
}
async function route(req, env, path, ctx){
  const M = req.method;
  if (M === "GET" && path === "/api/health") return {ok: true};

  if (M === "POST" && path === "/api/signup"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req);
    const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || ""), name = String(b.name || "").trim().slice(0, 30);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new HttpError(400, "Enter a valid email.");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "Use a password of at least 8 characters.");
    if (b.agree !== true) throw new HttpError(400, "Please confirm you're 18 or older and agree to the terms.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) throw new HttpError(409, "That email already has an account. Log in instead.");
    const id = rand(12), salt = rand(16), t = now();
    await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, salt, created, terms_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, email, name, await hashPassword(password, salt), salt, t, t).run();
    if (ctx && !/@example\.com$/.test(email)){
      ctx.waitUntil(tellOwnerSignup(env, name, email).catch(e => console.log("signup notice", e && e.message)));
      ctx.waitUntil(welcomeMail(env, id, name, email).catch(e => console.log("welcome", e && e.message)));
    }
    return {token: await newSession(env, id), user: {id, email, name, terms_at: t}};
  }
  if (M === "GET" && path === "/api/garmin/callback"){
    const q = new URL(req.url).searchParams, st = q.get("state") || "";
    const row = await env.DB.prepare("SELECT user_id, created, verifier, ret FROM oauth_states WHERE state = ?").bind(st).first();
    await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? OR created < ?").bind(st, new Date(Date.now() - 3600e3).toISOString()).run();
    const go = code => Response.redirect(((row && row.ret) || env.APP_URL || "https://matthewbaconn.github.io/Hybrid/") + "?garmin=" + code + "#today", 302);
    if (!row || !row.verifier || Date.parse(row.created) < Date.now() - 1800e3) return go("expired");
    if (q.get("error") || !q.get("code")) return go("cancelled");
    const cb = new URL(req.url).origin + "/api/garmin/callback";
    const r = await fetch(env.GARMIN_TOKEN_URL || GARMIN_TOKEN, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({grant_type: "authorization_code", client_id: env.GARMIN_CLIENT_ID, client_secret: env.GARMIN_CLIENT_SECRET, code: q.get("code"), code_verifier: row.verifier, redirect_uri: cb})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token){ await logEvent(env, "garmin_connect", false, "token HTTP " + r.status + " " + JSON.stringify(j).slice(0, 100)); return go("failed"); }
    const ur = await fetch((env.GARMIN_API || GARMIN_API) + "/wellness-api/rest/user/id", {headers: {Authorization: "Bearer " + j.access_token}});
    const uj = await ur.json().catch(() => ({}));
    if (!ur.ok || !uj.userId){ await logEvent(env, "garmin_connect", false, "user id HTTP " + ur.status); return go("failed"); }
    const gid = String(uj.userId);
    // a Garmin account can only be linked to one Hybrid account: move it if it was linked elsewhere
    await env.DB.batch([env.DB.prepare("DELETE FROM garmin_links WHERE garmin_user_id = ? AND user_id != ?").bind(gid, row.user_id),
      env.DB.prepare("INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (user_id) DO UPDATE SET garmin_user_id = excluded.garmin_user_id, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at")
        .bind(row.user_id, gid, j.access_token, j.refresh_token || "", Math.floor(Date.now() / 1000) + (j.expires_in || 86400), now())]);
    await logEvent(env, "garmin_connect", true, "");
    ctx.waitUntil(garminWorkouts(env, row.user_id, {recheck: true}).catch(e => logEvent(env, "garmin_workout", false, "connect: " + String(e && e.message).slice(0, 100))));
    ctx.waitUntil((async () => {
      const end = Math.floor(Date.now() / 1000), start = end - 14 * 86400;
      for (const k of ["sleeps", "dailies", "hrv", "activities", "activityDetails"]){
        const br = await fetch((env.GARMIN_API || GARMIN_API) + "/wellness-api/rest/backfill/" + k + "?summaryStartTimeInSeconds=" + start + "&summaryEndTimeInSeconds=" + end, {headers: {Authorization: "Bearer " + j.access_token}}).catch(() => null);
        const good = !!(br && (br.ok || br.status === 409));
        // on failure keep Garmin's own reason (no personal data) so the cause shows in the event log
        await logEvent(env, "garmin_backfill", good, k + " " + (br ? br.status : "net") + (br && !good ? " " + (await br.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140) : ""));
        if (br && br.status === 412){   // precondition failed applies to the whole account: note what Garmin allows and stop
          const lk = await env.DB.prepare("SELECT permissions FROM garmin_links WHERE user_id = ?").bind(row.user_id).first();
          await logEvent(env, "garmin_backfill", false, "stopped after 412; permissions " + String(lk && lk.permissions || "unknown").slice(0, 140));
          break;
        }
      }
    })());
    return go("connected");
  }
  if (path === "/api/garmin/push"){
    if (M !== "POST") return {ok: true};
    const raw = await req.text();
    if (raw.length > 8_000_000) throw new HttpError(413, "Too large.");
    let data; try { data = JSON.parse(raw); } catch(e){ throw new HttpError(400, "Bad JSON."); }
    // answer Garmin right away; store the data after
    ctx.waitUntil(garminPush(env, data, ctx).catch(async e => { console.log("garmin push", e && e.stack || e); await logEvent(env, "garmin_push", false, String(e && e.message || e).slice(0, 120)); }));
    return {ok: true};
  }
  if (M === "GET" && path === "/api/strava/callback"){
    const q = new URL(req.url).searchParams, st = q.get("state") || "";
    const row = await env.DB.prepare("SELECT user_id, created, ret FROM oauth_states WHERE state = ?").bind(st).first();
    await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? OR created < ?").bind(st, new Date(Date.now() - 3600e3).toISOString()).run();
    const go = code => Response.redirect(appUrl(env, code, row && row.ret), 302);
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
  if ((M === "GET" || M === "POST") && path === "/api/import"){
    // iPhone Shortcut (Apple Health — Apple Watch, or Garmin/scales that write to Apple Health):
    //   .../api/import?key=…&weight=195.2 lb&sleep=7 hr 25 min&rhr=52&hrv=61 ms&steps=12,034&active=640 kcal
    // Every value is optional. Lists (one value per line) are added up or averaged.
    const q = new URL(req.url).searchParams, b = M === "POST" ? await body(req).catch(() => ({})) : {};
    const key = String(q.get("key") || b.key || "");
    await limit(env, "import:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const kh = key.length > 20 ? await sha256(key) : null;
    let row = kh ? await env.DB.prepare("SELECT user_id, 'apple' AS kind FROM import_keys WHERE key_hash = ?").bind(kh).first() : null;
    if (!row) throw new HttpError(401, "That link isn't valid anymore. Make a new one in Mileset settings.");
    const src = row.kind === "garmin" ? "garmin" : "apple";
    const get = k => { const v = q.get(k) ?? b[k]; return v == null ? "" : String(v).trim(); };
    const nums = raw => raw.split(/[\n;|]+/).map(t => t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(",", ".")).map(t => { const m = t.match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; }).filter(x => !isNaN(x));
    const sum = a => a.reduce((x, y) => x + y, 0), mean = a => a.length ? sum(a) / a.length : NaN;
    const hours = raw => {
      const parts = raw.split(/[\n;|]+/).filter(t => /\d/.test(t)); let tot = 0;
      for (const t of parts){
        const h = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i), m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i), sec = t.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
        const n = x => Number(x[1].replace(",", "."));
        if (h || m || sec){ tot += (h ? n(h) : 0) + (m ? n(m) / 60 : 0) + (sec ? n(sec) / 3600 : 0); continue; }
        const c = t.match(/^(\d+):(\d{2})(?::(\d{2}))?$/); if (c){ tot += +c[1] + +c[2] / 60 + (c[3] ? +c[3] / 3600 : 0); continue; }
        const v = nums(t)[0]; if (v == null) continue;
        tot += v > 1440 ? v / 3600 : v > 24 ? v / 60 : v;   // plain number: seconds, minutes or hours
      }
      return tot;
    };
    const saved = {}, st = await settingsOf(env, row.user_id), dq = (get("date") || "").slice(0, 10);
    const date = isDate(dq) ? dq : localNow(st.tz).date, ops = [];
    const w = get("weight"), softW = src === "garmin";   // Garmin weight only fills days with no weigh-in
    if (w){ let lb = nums(w).slice(-1)[0]; if (/kg/i.test(w)) lb *= 2.20462; if (lb >= 70 && lb <= 500){ saved.weight = Math.round(lb * 10) / 10;
      ops.push(env.DB.prepare(softW ? "INSERT INTO weights (user_id, date, lb) VALUES (?, ?, ?) ON CONFLICT (user_id, date) DO NOTHING" : "INSERT INTO weights (user_id, date, lb) VALUES (?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET lb = excluded.lb").bind(row.user_id, date, saved.weight)); } }
    const sl = get("sleep"); if (sl){ const h = hours(sl); if (h >= 1 && h <= 16) saved.sleep_h = Math.round(h * 100) / 100; }
    const rh = get("rhr"); if (rh){ const v = mean(nums(rh)); if (v >= 25 && v <= 150) saved.rhr = Math.round(v); }
    const hv = get("hrv"); if (hv){ const v = mean(nums(hv)); if (v >= 5 && v <= 300) saved.hrv = Math.round(v); }
    const sp = get("steps"); if (sp){ const v = sum(nums(sp)); if (v >= 0 && v <= 150000) saved.steps = Math.round(v); }
    for (const [k, col] of [["sleep_score", "sleep_score"], ["bb", "bb"], ["body_battery", "bb"], ["stress", "stress"]]){ const v = get(k); if (v){ const x = mean(nums(v)); if (x >= 0 && x <= 100) saved[col] = Math.round(x); } }
    const ac = get("active"); if (ac){ let v = sum(nums(ac)); if (/kj/i.test(ac)) v /= 4.184; if (v >= 0 && v <= 8000) saved.active_cal = Math.round(v); }
    // Garmin wins: Garmin numbers replace Apple Health ones; Apple Health only fills what Garmin left empty that day
    const DK = ["sleep_h", "rhr", "hrv", "steps", "active_cal", "sleep_score", "bb", "stress"], dk = DK.filter(k => k in saved);
    const set = k => src === "garmin" ? k + " = excluded." + k : k + " = CASE WHEN health_daily.source = 'garmin' AND health_daily." + k + " IS NOT NULL THEN health_daily." + k + " ELSE excluded." + k + " END";
    if (dk.length) ops.push(env.DB.prepare("INSERT INTO health_daily (user_id, date, " + DK.join(", ") + ", source, updated) VALUES (?, ?, " + DK.map(() => "?").join(", ") + ", ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET " +
      dk.map(set).join(", ") + ", source = CASE WHEN health_daily.source = 'garmin' OR excluded.source = 'garmin' THEN 'garmin' ELSE excluded.source END, updated = excluded.updated")
      .bind(row.user_id, date, ...DK.map(k => saved[k] ?? null), src, now()));
    if (!ops.length) throw new HttpError(400, "Nothing to save. Send weight=, sleep=, sleep_score=, rhr=, hrv=, bb=, stress=, steps= or active= with a number.");
    ops.push(src === "garmin" ? env.DB.prepare("UPDATE link_keys SET last_used = ? WHERE key_hash = ?").bind(now(), kh) : env.DB.prepare("UPDATE import_keys SET last_used = ? WHERE user_id = ?").bind(now(), row.user_id));
    await env.DB.batch(ops);
    await logEvent(env, "health_import", true, src + ": " + Object.keys(saved).join(","));
    return {ok: true, date, saved};
  }
  if (path === "/api/strava/webhook"){
    if (M === "GET"){
      const q = new URL(req.url).searchParams;
      if (!env.STRAVA_VERIFY || q.get("hub.verify_token") !== env.STRAVA_VERIFY) throw new HttpError(403, "Bad token.");
      return new Response(JSON.stringify({"hub.challenge": q.get("hub.challenge")}), {headers: {"Content-Type": "application/json"}});
    }
    if (M === "POST"){
      const ev = await body(req);
      ctx.waitUntil(logEvent(env, "strava_notice", true, ev.object_type + " " + ev.aspect_type));
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

  // forgot password: email a one-time link (always answers the same, so it can't be used to test which emails have accounts)
  if (M === "GET" && path === "/api/founding") return {left: await foundingLeft(env), max: FOUNDING_MAX, ends: "2027-01-01"};
  if (path === "/api/unsubscribe"){
    const q = new URL(req.url).searchParams, uid = String(q.get("u") || ""), sig = String(q.get("s") || "");
    const ok = /^[a-f0-9]{8,64}$/.test(uid) && env.RESEND_API_KEY && safeEqual(sig, await mailSig(env, uid));
    if (ok) await env.DB.prepare("UPDATE users SET no_mail = 1 WHERE id = ?").bind(uid).run();
    if (M === "POST") return new Response(null, {status: ok ? 200 : 400});   // one-click unsubscribe from the mail app
    return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mileset</title><body style="font-family:-apple-system,sans-serif;background:#0A0B0F;color:#fff;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:20px"><div><div style="background:#BE383E;display:inline-block;font-weight:800;font-size:22px;padding:12px 18px;border-radius:6px">Mileset</div><h1 style="font-size:22px">' +
      (ok ? "You're unsubscribed" : "That link didn't work") + '</h1><p style="color:#9aa">' + (ok ? "You won't get Mileset update emails anymore. Password resets still come through." : "Email hybridrunning@gmail.com and we'll take you off the list.") + '</p></div>', {status: ok ? 200 : 400, headers: {"Content-Type": "text/html; charset=utf-8"}});
  }
  if (M === "POST" && path === "/api/password/forgot"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req), email = String(b.email || "").trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter the email you signed up with.");
    if (!env.RESEND_API_KEY) throw new HttpError(503, "Password reset by email isn't set up yet. Email hybridrunning@gmail.com and we'll help.");
    const u = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email).first();
    if (u){
      const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM pw_resets WHERE user_id = ? AND expires > ?").bind(u.id, new Date().toISOString()).first();
      if (!recent || recent.n < 3){
        const code = rand(32), link = (env.APP_URL || "https://app.hybrdrunning.com/") + "#reset=" + code;
        await env.DB.prepare("INSERT INTO pw_resets (token_hash, user_id, expires) VALUES (?, ?, ?)").bind(await sha256(code), u.id, new Date(Date.now() + 3600e3).toISOString()).run();
        const hi = u.name ? "Hi " + String(u.name).split(" ")[0].replace(/[<>&"]/g, "") + "," : "Hi,";
        const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
          MAIL_HEAD +
          '<p style="font-size:16px;margin:22px 0 8px">' + hi + '</p><p style="font-size:16px;line-height:1.5;margin:0 0 20px">Tap the button to pick a new password. The link works once and expires in 1 hour.</p>' +
          '<p><a href="' + link + '" style="display:inline-block;background:#800000;color:#fff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:6px">Choose a new password</a></p>' +
          '<p style="font-size:13px;color:#666;line-height:1.5;margin-top:24px">If you didn\'t ask for this, ignore this email. Your password stays the same.</p></div>';
        const r = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {method: "POST", headers: {Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json"},
          body: JSON.stringify({from: env.MAIL_FROM || "Mileset <no-reply@hybrdrunning.com>", to: [email], reply_to: "hybridrunning@gmail.com", subject: "Reset your Mileset password", html,
            text: hi + "\n\nOpen this link to pick a new password (works once, expires in 1 hour):\n" + link + "\n\nIf you didn't ask for this, ignore this email."})}).catch(() => null);
        await logEvent(env, "pw_reset_mail", !!(r && r.ok), r ? (r.ok ? "sent" : "HTTP " + r.status + " " + (await r.text()).slice(0, 120)) : "net");
      }
    }
    return {ok: true};
  }
  if (M === "POST" && path === "/api/password/reset"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req), code = String(b.code || ""), next = String(b.password || "");
    if (!/^[a-f0-9]{64}$/.test(code)) throw new HttpError(400, "That reset link isn't valid. Ask for a new one.");
    if (next.length < 8 || next.length > 200) throw new HttpError(400, "Use a password of at least 8 characters.");
    const row = await env.DB.prepare("SELECT * FROM pw_resets WHERE token_hash = ?").bind(await sha256(code)).first();
    if (!row || row.used || row.expires < new Date().toISOString()) throw new HttpError(400, "That reset link has expired or was already used. Ask for a new one.");
    const salt = rand(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(next, salt), salt, row.user_id),
      env.DB.prepare("UPDATE pw_resets SET used = 1 WHERE user_id = ?").bind(row.user_id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id)   // signs out every phone
    ]);
    const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first();
    await logEvent(env, "pw_reset", true);
    return {token: await newSession(env, u.id), user: userOut(u)};
  }
  if (M === "POST" && path === "/api/report"){
    // works signed in or not (sample runner too)
    await limit(env, "report:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req), text = String(b.text || "").trim().slice(0, 2000);
    if (text.length < 5) throw new HttpError(400, "Tell us a little more about what went wrong.");
    const who = await auth(req, env).catch(() => null);
    const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE created > ?").bind(new Date(Date.now() - 864e5).toISOString()).first();
    if (day.n >= 200) throw new HttpError(429, "Too many reports today. Try again tomorrow.");
    const info = {screen: String(b.screen || "").slice(0, 30), version: String(b.version || "").slice(0, 20), device: (req.headers.get("User-Agent") || "").slice(0, 160), installed: !!b.installed};
    await env.DB.prepare("INSERT INTO reports (id, user_id, email, text, info, created) VALUES (?, ?, ?, ?, ?, ?)").bind(rand(10), who ? who.id : null, who ? who.email : null, text, JSON.stringify(info), now()).run();
    await logEvent(env, "report", true, who ? "signed in" : "not signed in");
    const own = await ownerId(env);
    if (own && ctx && !text.startsWith("Nightly test report.")) ctx.waitUntil(pushTo(env, own, {title: "Mileset: problem reported", body: clip(text, 120), tag: "report"}).catch(() => {}));
    return {ok: true};
  }
  const user = await auth(req, env);
  const mr = path.match(/^\/api\/report\/([a-f0-9]+)$/);
  if (M === "DELETE" && mr){
    if (await ownerId(env) !== user.id) throw new HttpError(403, "Not allowed.");
    await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(mr[1]).run(); return {ok: true};
  }
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
      env.DB.prepare("SELECT id, source, ext_id, date, type, name, mi, minutes, cal, avg_hr, work_pace, CASE WHEN date >= ? THEN laps END AS laps, CASE WHEN date >= ? THEN poly END AS poly, start_local, elev_ft, sport, max_hr FROM activities WHERE user_id = ? AND date >= ? ORDER BY date, created").bind(since, since, user.id, since120),
      env.DB.prepare("SELECT athlete_name, last_sync FROM strava_links WHERE user_id = ?").bind(user.id)
    ]);
    const [rv, cn, ps, ik, hd, ll, mp, gl] = await env.DB.batch([
      env.DB.prepare("SELECT activity_id, data FROM reviews WHERE user_id = ? AND date >= ?").bind(user.id, since),
      env.DB.prepare("SELECT date, kind, data FROM coach_notes WHERE user_id = ? AND date >= ?").bind(user.id, new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)),
      env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(user.id),
      env.DB.prepare("SELECT last_used FROM import_keys WHERE user_id = ?").bind(user.id),
      env.DB.prepare("SELECT date, sleep_h, rhr, hrv, steps, active_cal, sleep_score, bb, stress, source FROM health_daily WHERE user_id = ? AND date >= ? ORDER BY date").bind(user.id, since),
      env.DB.prepare("SELECT date, ex, weight, hit FROM lift_logs WHERE user_id = ? AND date >= ? ORDER BY date").bind(user.id, since120),
      env.DB.prepare("SELECT data FROM meal_plans WHERE user_id = ?").bind(user.id),
      env.DB.prepare("SELECT connected, last_push, permissions, (SELECT COUNT(*) FROM garmin_workouts w WHERE w.user_id = garmin_links.user_id AND w.date >= date('now', '-1 day') AND w.schedule_id IS NOT NULL) AS wk FROM garmin_links WHERE user_id = ?").bind(user.id)
    ]);
    const prof = p.results[0] ? JSON.parse(p.results[0].data) : null;
    const owner = await ownerId(env) === user.id, founding = await foundingNo(env, user.id);
    const reports = owner ? (await env.DB.prepare("SELECT id, email, text, info, created FROM reports ORDER BY created DESC LIMIT 50").all()).results : undefined;
    return {user: {...userOut(user), terms_at: user.terms_at || null}, profile: prof, done: d.results.map(r => r.key), food: f.results, checkins: c.results, weights: w.results, activities: a.results,
      strava: {available: !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET), connected: !!s.results[0], name: s.results[0] ? s.results[0].athlete_name : "", last_sync: s.results[0] ? s.results[0].last_sync : null},
      garmin: {available: !!(env.GARMIN_CLIENT_ID && env.GARMIN_CLIENT_SECRET), connected: !!gl.results[0], last_push: gl.results[0] ? gl.results[0].last_push : null,
        workouts: gl.results[0] ? (/WORKOUT_IMPORT/.test(gl.results[0].permissions || "") ? gl.results[0].wk : (gl.results[0].permissions ? -1 : null)) : null},
      reviews: Object.fromEntries(rv.results.map(x => [x.activity_id, JSON.parse(x.data)])), notes: cn.results.map(x => ({date: x.date, kind: x.kind, ...JSON.parse(x.data)})),
      settings: await settingsOf(env, user.id), push: {key: env.VAPID_PUBLIC || null, devices: ps.results[0].n}, coach: !!env.ANTHROPIC_API_KEY,
      owner, founding, reports, health: hd.results, lifts: ll.results, mealplan: mp.results[0] ? JSON.parse(mp.results[0].data) : null, crews: await crewsFor(env, user.id), health_link: ik.results[0] ? {on: true, last_used: ik.results[0].last_used} : {on: false}};
  }
  if (M === "PUT" && path === "/api/account"){
    const b = await body(req), name = String(b.name ?? "").trim().slice(0, 30);
    if (!name) throw new HttpError(400, "Enter your name.");
    await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
    return {user: {...userOut(user), name}};
  }
  if (M === "POST" && path === "/api/account/terms"){
    const b = await body(req); if (b.agree !== true) throw new HttpError(400, "Please confirm to continue.");
    const t = now(); await env.DB.prepare("UPDATE users SET terms_at = ? WHERE id = ?").bind(t, user.id).run();
    return {terms_at: t};
  }
  if (M === "POST" && path === "/api/account/password"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req), cur = String(b.current || ""), next = String(b.next || "");
    const u = await env.DB.prepare("SELECT salt, pass_hash FROM users WHERE id = ?").bind(user.id).first();
    if (!u || !safeEqual(await hashPassword(cur, u.salt), u.pass_hash)) throw new HttpError(400, "Your current password is wrong.");
    if (next.length < 8 || next.length > 200) throw new HttpError(400, "Use a new password of at least 8 characters.");
    const salt = rand(16), tok = (req.headers.get("Authorization") || "").slice(7);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(next, salt), salt, user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, await sha256(tok))   // signs out other phones
    ]);
    return {ok: true};
  }
  if (M === "POST" && path === "/api/account/email"){
    await limit(env, "auth:" + (req.headers.get("CF-Connecting-IP") || "x"));
    const b = await body(req), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new HttpError(400, "Enter a valid email.");
    const u = await env.DB.prepare("SELECT salt, pass_hash FROM users WHERE id = ?").bind(user.id).first();
    if (!u || !safeEqual(await hashPassword(pw, u.salt), u.pass_hash)) throw new HttpError(400, "Your password is wrong.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").bind(email, user.id).first()) throw new HttpError(409, "That email is already used by another account.");
    await env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, user.id).run();
    return {user: {...userOut(user), email}};
  }
  if (M === "PUT" && path === "/api/profile"){
    const b = await body(req), s = JSON.stringify(b.profile || null);
    if (!b.profile || typeof b.profile !== "object" || s.length > 20000) throw new HttpError(400, "Bad plan settings.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO profiles (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(user.id, s, now()),
      ...(isDate(b.resetFrom) ? [env.DB.prepare("DELETE FROM done WHERE user_id = ? AND key >= ?").bind(user.id, b.resetFrom)] : [])
    ]);
    if (ctx) ctx.waitUntil(garminWorkouts(env, user.id).catch(e => logEvent(env, "garmin_workout", false, "profile: " + String(e && e.message).slice(0, 100))));
    return {ok: true};
  }
  if (M === "POST" && path === "/api/garmin/workouts"){
    await limit(env, "gw:" + user.id);
    return await garminWorkouts(env, user.id, {recheck: true});
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
  if (M === "POST" && path === "/api/import-key"){
    const key = "hl_" + rand(24);
    await env.DB.prepare("INSERT INTO import_keys (user_id, key_hash, created) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET key_hash = excluded.key_hash, created = excluded.created, last_used = NULL").bind(user.id, await sha256(key), now()).run();
    return {key};
  }
  if (M === "DELETE" && path === "/api/import-key"){ await env.DB.prepare("DELETE FROM import_keys WHERE user_id = ?").bind(user.id).run(); return {ok: true}; }
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
    for (const k of ["morning", "bedtime", "run_time"]) if (/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k] || "")) next[k] = b[k];
    if (b.lat === null){ delete next.lat; delete next.lon; }
    else if (Number.isFinite(+b.lat) && Number.isFinite(+b.lon) && Math.abs(+b.lat) <= 90 && Math.abs(+b.lon) <= 180){ next.lat = Math.round(+b.lat * 100) / 100; next.lon = Math.round(+b.lon * 100) / 100; if (typeof b.place === "string") next.place = b.place.slice(0, 60); }
    for (const k of ["n_morning", "n_run", "n_weekly", "n_bed"]) if (typeof b[k] === "boolean") next[k] = b[k];
    // heart rate zones: % of max HR or of lactate threshold HR
    if (b.hr_method === "max" || b.hr_method === "lthr") next.hr_method = b.hr_method;
    if (b.sweat_oz === null) delete next.sweat_oz; else if (b.sweat_oz >= 5 && b.sweat_oz <= 80) next.sweat_oz = Math.round(b.sweat_oz);
    if (b.hr_max === null) delete next.hr_max; else if (b.hr_max >= 120 && b.hr_max <= 230) next.hr_max = Math.round(b.hr_max);
    if (b.hr_lthr === null) delete next.hr_lthr; else if (b.hr_lthr >= 100 && b.hr_lthr <= 220) next.hr_lthr = Math.round(b.hr_lthr);
    for (const k of ["hr_pct_max", "hr_pct_lthr"]) if (Array.isArray(b[k]) && b[k].length === 4 && b[k].every((x, i) => Number.isFinite(x) && x >= 30 && x <= 120 && (!i || x > b[k][i - 1]))) next[k] = b[k].map(x => Math.round(x));
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
  if (M === "POST" && path === "/api/review/feel"){
    const b = await body(req), FEELS = ["easy", "just right", "hard", "very hard"];
    if (!FEELS.includes(b.feel)) throw new HttpError(400, "Pick how it felt.");
    const note = String(b.note || "").trim().slice(0, 300);
    const st = await settingsOf(env, user.id), L = localNow(st.tz), U = await loadUser(env, user.id, L.date);
    const act = U && U.acts.find(a => a.id === String(b.activity_id || ""));
    if (!act) throw new HttpError(404, "Workout not found.");
    if (!(await coachUsage(env, user.id))) throw new HttpError(429, "That's the most coach notes for today. Try again tomorrow.");
    return {review: await runReview(env, user.id, U, act, L.date, {feel: b.feel, note})};
  }
  if (M === "POST" && path === "/api/garmin/start"){
    if (!env.GARMIN_CLIENT_ID || !env.GARMIN_CLIENT_SECRET) throw new HttpError(503, "Garmin connection isn't set up yet.");
    const st = rand(16), verifier = b64url(crypto.getRandomValues(new Uint8Array(48))), challenge = b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
    await env.DB.prepare("INSERT INTO oauth_states (state, user_id, created, verifier, ret) VALUES (?, ?, ?, ?, ?)").bind(st, user.id, now(), verifier, retFor(req)).run();
    const cb = new URL(req.url).origin + "/api/garmin/callback";
    return {url: (env.GARMIN_AUTH_URL || GARMIN_AUTH) + "?response_type=code&client_id=" + encodeURIComponent(env.GARMIN_CLIENT_ID) + "&code_challenge=" + challenge + "&code_challenge_method=S256&redirect_uri=" + encodeURIComponent(cb) + "&state=" + st};
  }
  if (M === "POST" && path === "/api/garmin/disconnect"){ await garminForget(env, user.id, true); return {ok: true}; }
  if (M === "POST" && path === "/api/strava/start"){
    if (!env.STRAVA_CLIENT_ID) throw new HttpError(503, "Strava connection isn't set up yet.");
    const st = rand(16);
    await env.DB.prepare("INSERT INTO oauth_states (state, user_id, created, ret) VALUES (?, ?, ?, ?)").bind(st, user.id, now(), retFor(req)).run();
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
  /* ---------- race search: Claude + web search, so it covers races worldwide ---------- */
  if (M === "POST" && path === "/api/races/search"){
    await limit(env, "ai:" + user.id);
    const b = await body(req), q = String(b.q || "").trim().slice(0, 120);
    if (q.length < 3) throw new HttpError(400, "Type a race name, city or sport.");
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "Race search isn't set up yet.");
    const st = await settingsOf(env, user.id), today = localNow(st.tz).date, day = "race:" + today;
    const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").bind(user.id, day).first("count");
    if (used >= 15) throw new HttpError(429, "That's the most race searches for today. Try again tomorrow, or type the date yourself.");
    await env.DB.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1").bind(user.id, day).run();
    const SPORTS = ["5k", "10k", "half", "marathon", "50k", "hyrox", "tri_sprint", "tri_olympic", "tri_half", "tri_full", "swim", "bike", "other"];
    const system = "You find real, upcoming endurance races for a training app. Today is " + today + ". Search the web, then reply with ONLY a JSON object and nothing else: " +
      '{"races":[{"name":"...","date":"YYYY-MM-DD","city":"City, Country","sport":"one of ' + SPORTS.join("|") + '","url":"https://..."}]}. ' +
      "Up to 6 races, soonest first, only dates after today and within 18 months. Only include a race if a search result shows its date; never guess a date. " +
      "sport: 5k/10k/half/marathon/50k for runs (50k = trail or ultra), hyrox, tri_sprint/tri_olympic/tri_half (70.3)/tri_full (140.6), swim, bike (cycling), otherwise other. url: the official race page if you found it. If nothing matches, return {\"races\":[]}.";
    const callModel = async model => {
      const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST",
        headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body: JSON.stringify({model, max_tokens: 2500, system, tools: [{type: "web_search_20250305", name: "web_search", max_uses: 4}], messages: [{role: "user", content: "Find races: " + q + (b.sport && SPORTS.includes(b.sport) ? " (sport: " + b.sport + ")" : "")}]})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || "search failed (" + r.status + ")");
      return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    };
    let text;
    try { text = await callModel(env.SEARCH_MODEL || "claude-haiku-5-5"); }
    catch(e){ try { text = await callModel(env.MODEL || "claude-sonnet-5-5"); } catch(e2){ await logEvent(env, "race_search", false, String(e2.message || e2).slice(0, 120)); throw new HttpError(502, "Race search didn't work just now. Try again, or type the date yourself."); } }
    let out = [];
    try { const m = text.match(/\{[\s\S]*\}/); out = (JSON.parse(m ? m[0] : "{}").races || []); } catch(e){ out = []; }
    const clean = out.filter(x => x && isDate(String(x.date)) && String(x.date) > today && x.name).slice(0, 6).map(x => ({
      name: String(x.name).slice(0, 80), date: String(x.date), city: String(x.city || "").slice(0, 60),
      sport: SPORTS.includes(x.sport) ? x.sport : "other", url: /^https:\/\//.test(String(x.url || "")) ? String(x.url).slice(0, 300) : ""}));
    await logEvent(env, "race_search", true, clean.length + " found");
    return {races: clean};
  }

  /* ---------- strength log (weights per exercise, for progressive overload) ---------- */
  if (M === "PUT" && path === "/api/lifts"){
    const b = await body(req);
    if (!isDate(b.date) || !Array.isArray(b.sets) || b.sets.length > 20) throw new HttpError(400, "Bad lift log.");
    const ops = b.sets.filter(x => x && String(x.ex || "").trim()).map(x => {
      const w = x.weight === null || x.weight === "" ? null : Number(x.weight);
      if (w != null && !(w >= 0 && w <= 2000)) throw new HttpError(400, "Weights should be in pounds.");
      return env.DB.prepare("INSERT INTO lift_logs (user_id, date, ex, weight, hit, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, date, ex) DO UPDATE SET weight = excluded.weight, hit = excluded.hit, updated = excluded.updated")
        .bind(user.id, b.date, String(x.ex).trim().slice(0, 60), w, x.hit === false ? 0 : 1, now());
    });
    if (ops.length) await env.DB.batch(ops);
    return {ok: true};
  }

  /* ---------- meal prep + grocery list (AI) ---------- */
  if (M === "POST" && path === "/api/mealplan"){
    await limit(env, "ai:" + user.id);
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "Meal prep isn't set up yet.");
    const b = await body(req), cal = Math.round(Number(b.cal)), pro = Math.round(Number(b.protein));
    if (!(cal >= 1500 && cal <= 6000) || !(pro >= 40 && pro <= 400)) throw new HttpError(400, "Missing calorie target.");
    const diet = ["any", "vegetarian", "vegan", "pescatarian", "dairy-free", "gluten-free"].includes(b.diet) ? b.diet : "any";
    const avoid = String(b.avoid || "").replace(/[^\w ,'-]/g, "").slice(0, 120), time = b.time === "quick" ? "quick (20 min or less per prep session)" : "normal";
    const st = await settingsOf(env, user.id), today = localNow(st.tz).date, day = "meal:" + today;
    const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").bind(user.id, day).first("count");
    if (used >= 3) throw new HttpError(429, "You've made 3 meal plans today. Try again tomorrow.");
    await env.DB.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1").bind(user.id, day).run();
    const system = "You write simple, budget-friendly meal prep plans for a training app. General healthy-eating ideas for active adults, not a medical or therapeutic diet. " +
      "Reply with ONLY JSON: {\"preps\":[{\"label\":\"Prep 1 · Sun (covers Mon–Wed)\",\"meals\":[{\"slot\":\"Breakfast|Lunch|Dinner|Snack\",\"name\":\"...\",\"cal\":0,\"protein\":0,\"how\":\"one short sentence\"}]}],\"grocery\":[{\"section\":\"Produce|Protein|Dairy & eggs|Grains & bread|Pantry|Frozen\",\"items\":[\"2 lb chicken thighs\"]}],\"tips\":[\"...\"]}. " +
      "Two preps (Sun covers Mon–Wed, Wed covers Thu–Sat), 4 meals each that repeat on those days. Each day's 4 meals should add up to about the calorie and protein targets (within 10%). " +
      "Grocery amounts must cover all the days. Common grocery-store foods only. 2–3 short tips. Never go below the calorie target.";
    const r = await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST",
      headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
      body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 8000, system,
        messages: [{role: "user", content: "Daily target about " + cal + " calories and " + pro + " g protein. Diet: " + diet + ". Avoid: " + (avoid || "nothing") + ". Cooking time: " + time + "."}]})});
    let plan = null, why = "";
    for (let tries = 0; tries < 2 && !plan; tries++){
      const rr = tries ? await fetch(env.ANTHROPIC_URL || "https://api.anthropic.com/v1/messages", {method: "POST", headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 8000, system: system + " Keep it compact: short meal names, each 'how' under 10 words, at most 22 grocery items. Output the JSON object only, no other text.",
          messages: [{role: "user", content: "Daily target about " + cal + " calories and " + pro + " g protein. Diet: " + diet + ". Avoid: " + (avoid || "nothing") + ". Cooking time: " + time + "."}]})}) : r;
      const j = await rr.json().catch(() => ({}));
      if (!rr.ok){ why = String((j.error && j.error.message) || rr.status).slice(0, 120); continue; }
      const t = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").replace(/```(json)?/g, "");
      try { const p = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); if (Array.isArray(p.preps) && p.preps.length && Array.isArray(p.grocery)) plan = p; else why = "missing parts"; } catch(e){ why = "bad json (" + j.stop_reason + ")"; }
    }
    if (!plan){ await logEvent(env, "ai_meal", false, why); throw new HttpError(502, "Couldn't make a plan just now. Try again in a minute."); }
    const data = {id: rand(6), created: now(), cal, protein: pro, diet, avoid, preps: plan.preps.slice(0, 3), grocery: plan.grocery.slice(0, 8), tips: (plan.tips || []).slice(0, 3)};
    await env.DB.prepare("INSERT INTO meal_plans (user_id, data, created) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, created = excluded.created").bind(user.id, JSON.stringify(data), now()).run();
    await logEvent(env, "ai_meal", true, "");
    return {mealplan: data};
  }

  /* ---------- crews: private groups that only see nicknames + weekly totals ---------- */
  const CREW_METRICS = ["minutes", "workouts", "run_miles", "days"];
  const nick = x => String(x || "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (M === "GET" && path === "/api/crews") return {crews: await crewsFor(env, user.id, String(new URL(req.url).searchParams.get("week") || ""))};
  if (M === "POST" && path === "/api/crews"){
    const b = await body(req), name = String(b.name || "").trim().slice(0, 30), nn = nick(b.nickname);
    if (!name || !nn) throw new HttpError(400, "Add a crew name and your nickname.");
    if ((await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_members WHERE user_id = ?").bind(user.id).first("n")) >= 10) throw new HttpError(400, "You can be in up to 10 crews.");
    const id = rand(8), code = Array.from(crypto.getRandomValues(new Uint8Array(6)), x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
    await env.DB.batch([env.DB.prepare("INSERT INTO crews (id, name, code, owner_id, metric, created) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, code, user.id, CREW_METRICS.includes(b.metric) ? b.metric : "minutes", now()),
      env.DB.prepare("INSERT INTO crew_members (crew_id, user_id, nickname, joined) VALUES (?, ?, ?, ?)").bind(id, user.id, nn, now())]);
    return {crews: await crewsFor(env, user.id)};
  }
  if (M === "POST" && path === "/api/crews/join"){
    await limit(env, "crewjoin:" + user.id);
    const b = await body(req), code = String(b.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""), nn = nick(b.nickname);
    if (!nn) throw new HttpError(400, "Pick a nickname.");
    const c = await env.DB.prepare("SELECT id FROM crews WHERE code = ?").bind(code).first();
    if (!c) throw new HttpError(404, "No crew with that code. Check it with whoever sent it.");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?").bind(c.id).first("n");
    if (n >= 50) throw new HttpError(400, "That crew is full.");
    if ((await env.DB.prepare("SELECT COUNT(*) AS n FROM crew_members WHERE user_id = ?").bind(user.id).first("n")) >= 10) throw new HttpError(400, "You can be in up to 10 crews.");
    await env.DB.prepare("INSERT INTO crew_members (crew_id, user_id, nickname, joined) VALUES (?, ?, ?, ?) ON CONFLICT (crew_id, user_id) DO UPDATE SET nickname = excluded.nickname").bind(c.id, user.id, nn, now()).run();
    return {crews: await crewsFor(env, user.id)};
  }
  const mc = path.match(/^\/api\/crews\/([a-f0-9]{16})(\/leave|\/nickname|\/metric)?$/);
  if (mc){
    const crew = await env.DB.prepare("SELECT c.* FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE c.id = ? AND m.user_id = ?").bind(mc[1], user.id).first();
    if (!crew) throw new HttpError(404, "Crew not found.");
    if (M === "POST" && mc[2] === "/leave"){
      await env.DB.prepare("DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?").bind(crew.id, user.id).run();
      const next = await env.DB.prepare("SELECT user_id FROM crew_members WHERE crew_id = ? ORDER BY joined LIMIT 1").bind(crew.id).first();
      if (!next) await env.DB.prepare("DELETE FROM crews WHERE id = ?").bind(crew.id).run();
      else if (crew.owner_id === user.id) await env.DB.prepare("UPDATE crews SET owner_id = ? WHERE id = ?").bind(next.user_id, crew.id).run();
      return {crews: await crewsFor(env, user.id)};
    }
    if (M === "PUT" && mc[2] === "/nickname"){ const nn = nick((await body(req)).nickname); if (!nn) throw new HttpError(400, "Pick a nickname."); await env.DB.prepare("UPDATE crew_members SET nickname = ? WHERE crew_id = ? AND user_id = ?").bind(nn, crew.id, user.id).run(); return {crews: await crewsFor(env, user.id)}; }
    if (M === "PUT" && mc[2] === "/metric"){ if (crew.owner_id !== user.id) throw new HttpError(403, "Only the person who made the crew can change the challenge."); const m = (await body(req)).metric; if (!CREW_METRICS.includes(m)) throw new HttpError(400, "Pick a challenge."); await env.DB.prepare("UPDATE crews SET metric = ? WHERE id = ?").bind(m, crew.id).run(); return {crews: await crewsFor(env, user.id)}; }
  }
  if (M === "POST" && path === "/api/admin/mail"){
    const own = await ownerId(env); if (user.id !== own) throw new HttpError(403, "Not allowed.");
    if (!env.RESEND_API_KEY) throw new HttpError(503, "Email isn't set up.");
    const b = await body(req), subject = String(b.subject || "").trim().slice(0, 120), message = String(b.message || "").trim().slice(0, 8000);
    if (!subject || message.length < 5) throw new HttpError(400, "Add a subject and a message.");
    if (!b.test){ const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'bulk_mail' AND detail NOT LIKE 'test%' AND ts > ?").bind(new Date(Date.now() - 864e5).toISOString()).first(); if (n && n.n >= 3) throw new HttpError(429, "That's 3 updates today. Send the next one tomorrow."); }
    const me2 = await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(user.id).first();
    return await sendUpdate(env, me2, subject, message, !!b.test);
  }
  if (M === "GET" && path === "/api/admin/members"){
    if (user.id !== (await ownerId(env))) throw new HttpError(403, "Not allowed.");
    const rows = (await env.DB.prepare(
      "SELECT u.name, u.email, u.created, u.no_mail, p.data AS profile, (SELECT 1 FROM strava_links s WHERE s.user_id = u.id) AS strava, (SELECT 1 FROM garmin_links g WHERE g.user_id = u.id) AS garmin, " +
      "(SELECT MAX(created) FROM sessions x WHERE x.user_id = u.id) AS last_login, (SELECT MAX(date) FROM food f WHERE f.user_id = u.id) AS last_food, (SELECT MAX(date) FROM activities a WHERE a.user_id = u.id) AS last_act " +
      "FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.email NOT LIKE '%@example.com' ORDER BY u.created DESC").all()).results;
    return {members: rows.map(r => { let pr = null; try { pr = r.profile ? JSON.parse(r.profile) : null; } catch(e){}
      return {name: r.name, email: r.email, created: r.created, founding: r.created < FOUNDING_END, no_mail: !!r.no_mail, strava: !!r.strava, garmin: !!r.garmin, goal: pr ? HP.raceName(pr) : null, race_date: pr && pr.raceDate || null,
        last_seen: [r.last_login, r.last_food, r.last_act].filter(Boolean).sort().pop() || null}; })};
  }
  if (M === "DELETE" && path === "/api/account"){
    const link = await env.DB.prepare("SELECT * FROM strava_links WHERE user_id = ?").bind(user.id).first();
    if (link){ try { const tok = await stravaToken(env, link); await fetch((env.STRAVA_BASE || STRAVA) + "/oauth/deauthorize", {method: "POST", headers: {Authorization: "Bearer " + tok}}); } catch(e){} }
    await garminForget(env, user.id, true);
    await env.DB.batch(["sessions", "pw_resets", "garmin_workouts", "profiles", "done", "food", "ai_usage", "checkins", "weights", "activities", "strava_links", "oauth_states", "reviews", "coach_notes", "push_subs", "settings", "notif_log", "import_keys", "health_daily", "reports", "link_keys", "lift_logs", "meal_plans", "crew_members"].map(t => env.DB.prepare("DELETE FROM " + t + " WHERE user_id = ?").bind(user.id))
      .concat([env.DB.prepare("DELETE FROM crews WHERE id NOT IN (SELECT crew_id FROM crew_members)"),
        env.DB.prepare("UPDATE crews SET owner_id = (SELECT user_id FROM crew_members m WHERE m.crew_id = crews.id ORDER BY joined LIMIT 1) WHERE owner_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
    return {ok: true};
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async scheduled(event, env, ctx){ ctx.waitUntil(cron(env, ctx)); },
  async fetch(req, env, ctx){
    const host = new URL(req.url).hostname;
    if (SITE_HOSTS.has(host)){
      try { return await site(req, host); } catch(e){ return new Response("Mileset is having a moment. Try again in a minute.", {status: 502}); }
    }
    const h = corsFor(req), path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (path.startsWith("/mcp/food/")){ try { return await foodMcp(req, env, path.slice(10)); } catch(e){ return new Response(JSON.stringify({jsonrpc: "2.0", id: null, error: {code: -32603, message: "Server error"}}), {status: 500, headers: {"Content-Type": "application/json"}}); } }
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    try { const out = await route(req, env, path, ctx); return out instanceof Response ? out : reply(h, out); }
    catch (e){
      if (e instanceof HttpError) return reply(h, {error: e.message}, e.status);
      console.log("server error", e && e.stack || e);
      ctx.waitUntil(logEvent(env, "server_error", false, req.method + " " + path + ": " + String(e && e.message || e)));
      return reply(h, {error: "Something went wrong on our side. Try again."}, 500);
    }
  }
};
