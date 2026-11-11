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
    const prof = p.results[0] ? JSON.parse(p.results[0].data) : null;
    return {user: userOut(user), profile: prof, done: d.results.map(r => r.key), food: f.results};
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
  if (M === "DELETE" && path === "/api/account"){
    await env.DB.batch(["sessions", "profiles", "done", "food", "ai_usage"].map(t => env.DB.prepare("DELETE FROM " + t + " WHERE user_id = ?").bind(user.id))
      .concat([env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]));
    return {ok: true};
  }
  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(req, env){
    const h = corsFor(req), path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    try { return reply(h, await route(req, env, path)); }
    catch (e){
      if (e instanceof HttpError) return reply(h, {error: e.message}, e.status);
      console.log("server error", e && e.stack || e);
      return reply(h, {error: "Something went wrong on our side. Try again."}, 500);
    }
  }
};
