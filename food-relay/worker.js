// Food relay for the Hybrid app.
// The app sends a food description and/or a photo; this Worker asks Claude for the nutrition and
// returns {items:[{name, cal, protein, carbs, fat}], note}. The API key lives only here, as a secret.
const ALLOWED = ["https://matthewbaconn.github.io"];
const MAX_IMAGE_B64 = 2_000_000;   // ~1.5 MB photo; the app shrinks photos to 1024 px first
const PROMPT = `You estimate nutrition for a training app's food log.
Use the user's description and/or photo. If a nutrition label is visible, use it and the amount eaten.
Otherwise estimate typical portions (US sizes unless stated). Split meals into their main foods.
Reply with ONLY this JSON, nothing else:
{"items":[{"name":"short food name with amount","cal":0,"protein":0,"carbs":0,"fat":0}],"note":"one short sentence on any assumption you made, or empty"}
Numbers are whole calories and grams. If there is no food, return {"items":[],"note":"No food found."}`;

function cors(origin){
  return {"Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0], "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin"};
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), {status, headers: {...h, "Content-Type": "application/json"}});
const n0 = x => { x = Math.round(Number(x)); return Number.isFinite(x) && x >= 0 && x < 20000 ? x : 0; };

export default {
  async fetch(req, env){
    const origin = req.headers.get("Origin") || "", h = cors(origin);
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    if (req.method === "GET") return json({ok: true}, 200, h);
    if (req.method !== "POST") return json({error: "Use POST."}, 405, h);
    if (!ALLOWED.includes(origin)) return json({error: "Not allowed."}, 403, h);
    if (env.LIMITER){
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({error: "Too many requests. Wait a minute and try again."}, 429, h);
    }
    let body;
    try { body = await req.json(); } catch { return json({error: "Bad request."}, 400, h); }
    const text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
    const image = typeof body.image === "string" ? body.image : "";
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body.mediaType) ? body.mediaType : "image/jpeg";
    if (!text.trim() && !image) return json({error: "Type what you ate or add a photo."}, 400, h);
    if (image.length > MAX_IMAGE_B64) return json({error: "That photo is too large."}, 413, h);

    const content = [];
    if (image) content.push({type: "image", source: {type: "base64", media_type: mediaType, data: image}});
    content.push({type: "text", text: text.trim() ? "What I ate: " + text : "Estimate the food in this photo."});
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
      body: JSON.stringify({model: env.MODEL || "claude-sonnet-5-5", max_tokens: 800, system: PROMPT, messages: [{role: "user", content}]})
    });
    if (!r.ok){ console.log("anthropic error", r.status, (await r.text()).slice(0, 300)); return json({error: "Couldn't read that right now. Try again in a minute."}, 502, h); }
    const out = await r.json();
    const raw = (out.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    let parsed;
    try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return json({error: "Couldn't read that. Try a clearer photo or add a few words."}, 502, h); }
    const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 12)
      .map(x => ({name: String(x.name || "").slice(0, 80), cal: n0(x.cal), protein: n0(x.protein), carbs: n0(x.carbs), fat: n0(x.fat)}))
      .filter(x => x.name);
    return json({items, note: typeof parsed.note === "string" ? parsed.note.slice(0, 200) : ""}, 200, h);
  }
};
