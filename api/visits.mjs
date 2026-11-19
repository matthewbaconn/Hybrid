// Visitor kinds (Matthew, Nov 17, 2026: privacy-safe diagnostic). Sorts a page load into ONE broad label so we can see
// what drives the visit counts (tests, agents, robots, tools, phones, computers). Only the label is ever stored:
// never the user agent itself, an IP address, a cookie or anything that tells one visitor from another.
// Tested by tests/visits.mjs. Order matters: the first match wins.
export const VISIT_KINDS = [
  ["test", /playwright|milesettest|headlesschrome|lighthouse/i],                                   // our own test browsers
  ["agent", /claude|anthropic|chatgpt|openai|perplexity|electron\//i],                             // AI agents and app browsers
  ["bot", /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack/i], // search robots, link previews
  ["tool", /curl|wget|python|httpx|node-fetch|undici|^node$|axios|go-http|java\/|okhttp|monitor|uptime|pingdom|postman/i], // scripts
  ["in-app", /instagram|fban|fbav|tiktok|musical_ly|snapchat/i],                                   // in-app browsers (social links)
  ["mobile", /iphone|ipad|ipod|android|mobile/i],
  ["desktop", /windows|macintosh|x11|cros|linux/i],
];
export const KIND_LABELS = ["none", "prefetch", ...VISIT_KINDS.map(k => k[0]), "other"];
export function visitKind(ua, purpose){
  if (/prefetch|prerender/i.test(String(purpose || ""))) return "prefetch";
  const s = String(ua || "");
  if (!s) return "none";
  for (const [k, re] of VISIT_KINDS) if (re.test(s)) return k;
  return "other";
}
