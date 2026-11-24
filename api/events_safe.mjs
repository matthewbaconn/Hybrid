// Event-log privacy (Matthew, Nov 17, 2026). This repo is public, and so are its workflow logs.
//  - safeDetail(): the ONLY thing that may go into events.detail. It keeps a detail only when every word is a
//    number, a fixed code word below, a tag our own code builds (morning-2026-11-17, run-<id>) or a bare /api/<route>.
//    Anything else (an AI reply, another service's error message, a name, an email, anything a member typed) is
//    replaced by "[removed]". Callers pass codes; this is the last line of defence.
//  - publicEventsSQL(): the ONLY query the public "Recent server events" workflow runs. It returns totals per event
//    type (successes and failures over 24 hours and 3 days), never a row, a time, a detail or a member. Strava, Garmin,
//    health and food events show failures only: their success counts would describe members' activity.
// Tested by tests/events_privacy.mjs (run in PR checks from tests/webhooks.mjs).

const WORDS = new Set(`
  api net HTTP error unreadable reply chars refresh confirmed ignored says still accepts the link by rate limited
  seen new already reviewed from create schedule sent removed failed cron connect profile outbox expired subscription
  push mail test signed in not found token user id stopped after permissions fields types other ok
  Strava Garmin apple garmin activity athlete update delete
  dailies sleeps hrv activities activityDetails deregistrations userPermissionsChange epochs stressDetails bodyComps
  userMetrics pulseox respiration skinTemp healthSnapshot moveiq allDayRespiration manuallyUpdatedActivities activityFiles
  move open change photo text history shared skipped
  draft ai template cancelled bad shape subject frame length instagram words name founding number
  end_turn max_tokens stop_sequence tool_use refusal pause_turn undefined null missing parts bad json
  GET POST PUT PATCH DELETE OPTIONS HEAD
  Error TypeError RangeError SyntaxError ReferenceError AbortError TimeoutError
  invalid_request_error authentication_error permission_error not_found_error request_too_large rate_limit_error
  api_error overloaded_error billing_error timeout_error
`.split(/\s+/).filter(Boolean));
const TAG = /^(morning|bed|weekly|run|mail|report|signup|first|nudge)-[a-z0-9-]{1,40}$/;
const ROUTE = /^\/api(\/[a-z_-]{1,24})?(\/:id)?$/;
const NUM = /^\d{1,9}(\.\d{1,3})?$/;

export const REMOVED = "[removed]";
export function safeDetail(d){
  if (d === null || d === undefined) return null;
  const s = String(d);
  if (!s) return null;
  if (s.length > 120 || !/^[A-Za-z0-9_:,() \/.-]+$/.test(s)) return REMOVED;
  const words = s.split(/[\s,()]+|(?<!\/):/).filter(Boolean);   // "/api/:id" stays one word
  if (words.length > 16) return REMOVED;
  for (const w of words) if (!(NUM.test(w) || WORDS.has(w) || TAG.test(w) || ROUTE.test(w))) return REMOVED;
  return s;
}

// helpers so callers never hand over free text
const ERR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", "TimeoutError"]);
export const errName = e => (e && ERR_NAMES.has(e.name)) ? e.name : "error";
// an AI/API error body -> its error type code only (e.g. "invalid_request_error"), never its message
export const apiErrType = text => { try { const t = JSON.parse(text).error.type; return WORDS.has(t) ? t : "error"; } catch(e){ return "error"; } };
// a request path -> its route only: /api/<first word>, then ":id" if there is more
export const routeOf = path => { const p = String(path || "").split("/").filter(Boolean); if (p[0] !== "api") return "other";
  return "/api" + (p[1] ? (/^[a-z_-]{1,24}$/.test(p[1]) ? "/" + p[1] : "/:id") : "") + (p.length > 2 ? "/:id" : ""); };
export const GARMIN_TYPES = new Set(["dailies", "sleeps", "hrv", "activities", "activityDetails", "deregistrations", "userPermissionsChange",
  "epochs", "stressDetails", "bodyComps", "userMetrics", "pulseox", "respiration", "skinTemp", "healthSnapshot", "moveiq", "allDayRespiration",
  "manuallyUpdatedActivities", "activityFiles"]);

// kinds whose success counts would describe what members did (Strava/Garmin/Apple activity, sleep, food)
export const SENSITIVE_SQL = "(kind LIKE 'strava%' OR kind LIKE 'garmin%' OR kind LIKE 'health%' OR kind LIKE 'wake%' OR kind IN ('ai_food', 'ai_meal'))";
export const PUBLIC_COLUMNS = ["kind", "ok_24h", "failed_24h", "ok_3d", "failed_3d"];
export function publicEventsSQL(kinds){
  const pats = String(kinds || "").split(",").map(k => k.replace(/[^a-z_%]/g, "")).filter(Boolean).slice(0, 20);
  const where = (pats.length ? pats : ["%"]).map(p => "kind LIKE '" + p + "'").join(" OR ");
  const d1 = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')", d3 = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')";
  const okCol = since => "CASE WHEN " + SENSITIVE_SQL + " THEN NULL ELSE SUM(ok = 1 AND ts > " + since + ") END";
  return "SELECT kind, " + okCol(d1) + " AS ok_24h, SUM(ok = 0 AND ts > " + d1 + ") AS failed_24h, " + okCol(d3) + " AS ok_3d, SUM(ok = 0) AS failed_3d" +
    " FROM events WHERE (" + where + ") AND ts > " + d3 + " AND kind GLOB '[a-z]*' AND NOT kind GLOB '*[^a-z_]*' GROUP BY kind ORDER BY kind";
}

// What the workflow prints. Fails closed: if the database answer holds anything but the five columns (a kind name
// and whole numbers), nothing is printed and the run fails.
export function formatPublic(wranglerJson){
  const out = JSON.parse(wranglerJson), rows = (Array.isArray(out) ? out : [out]).flatMap(r => r.results || []);
  for (const r of rows){
    const keys = Object.keys(r);
    if (keys.length !== PUBLIC_COLUMNS.length || !PUBLIC_COLUMNS.every(k => keys.includes(k))) throw new Error("refusing to print: unexpected columns");
    if (!/^[a-z_]{1,40}$/.test(r.kind)) throw new Error("refusing to print: unexpected kind");
    for (const k of PUBLIC_COLUMNS.slice(1)) if (!(r[k] === null || (Number.isInteger(r[k]) && r[k] >= 0))) throw new Error("refusing to print: unexpected value");
  }
  const cell = v => (v === null ? "-" : String(v)).padStart(12);
  return ["Totals per event type (no rows, times, details or members). \"-\" = not shown: it would describe members' activity.",
    "kind".padEnd(18) + PUBLIC_COLUMNS.slice(1).map(c => c.padStart(12)).join(""),
    ...rows.map(r => r.kind.padEnd(18) + PUBLIC_COLUMNS.slice(1).map(c => cell(r[c])).join("")),
    rows.length ? "" : "(no events of these kinds in the last 3 days)"].join("\n").trimEnd();
}
