// Member account check (owner only; run by .github/workflows/account-check.yml from api/).
// preview: prints masked signals for every real account (no names, no email addresses).
// delete:  removes ONE account the owner asked to delete, matched by the SHA-256 of its email's local part,
//          clearing the same tables as the app's own "Delete account" (DELETE /api/account in worker.js).
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";

const MODE = String(process.env.MODE || "preview").trim(), TARGET = String(process.env.TARGET || "").trim().toLowerCase();
const CONFIRM = String(process.env.CONFIRM || "").trim();
const q = sql => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hybrid", process.env.LOCAL ? "--local" : "--remote", "--json", "--command", sql],
  {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26}))[0].results;
const sha = s => createHash("sha256").update(s).digest("hex");

const rows = q("SELECT u.id, u.email, u.name, u.created, " +
  "EXISTS(SELECT 1 FROM profiles p WHERE p.user_id = u.id) AS plan, " +
  "(SELECT COUNT(*) FROM done d WHERE d.user_id = u.id) + (SELECT COUNT(*) FROM food f WHERE f.user_id = u.id) + (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS logs, " +
  "(SELECT MAX(created) FROM sessions s WHERE s.user_id = u.id) AS last_login, " +
  "EXISTS(SELECT 1 FROM strava_links s WHERE s.user_id = u.id) AS strava, EXISTS(SELECT 1 FROM garmin_links g WHERE g.user_id = u.id) AS garmin " +
  "FROM users u WHERE u.email NOT LIKE '%@example.com' ORDER BY u.created");

const THROWAWAY = /(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|discard|fakeinbox|getnada|maildrop)\./i;
const TESTY = /^(test|tester|testing|asdf|qwer|demo|fake|aaa+|xxx+|abc|foo|bar|user|admin|null|none)\b/i;
const BIG = new Set(["gmail.com", "icloud.com", "me.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "proton.me", "protonmail.com", "live.com", "msn.com"]);
const own = rows[0] ? rows[0].id : null, match = [];

console.log("Real accounts (not @example.com):", rows.length);
console.log(" # | joined     | email kind   | plan | logs | last login | flags");
rows.forEach((r, i) => {
  const email = String(r.email || "").toLowerCase(), at = email.lastIndexOf("@"), local = email.slice(0, at), dom = email.slice(at + 1), flags = [];
  if (r.id === own) flags.push("OWNER (oldest account)");
  if (TARGET && sha(local) === TARGET){ flags.push("DELETE TARGET"); match.push(r); }
  if (local.includes("+")) flags.push("+alias address");
  if (THROWAWAY.test(dom)) flags.push("throwaway domain");
  if (TESTY.test(String(r.name || "").trim()) || TESTY.test(local)) flags.push("test-like name");
  if (!r.plan && !r.logs) flags.push("no plan, nothing logged");
  if (r.strava) flags.push("strava linked");
  if (r.garmin) flags.push("garmin linked");
  const kind = BIG.has(dom) ? dom : dom.endsWith(".edu") ? "school .edu" : "other domain";
  console.log([String(i + 1).padStart(2), String(r.created || "").slice(0, 10), kind.padEnd(12), r.plan ? "yes " : "no  ",
    String(r.logs).padStart(4), String(r.last_login || "-").slice(0, 10).padEnd(10), flags.join(", ")].join(" | "));
});
if (TARGET) console.log("Delete target matches:", match.length);
if (MODE !== "delete") process.exit(0);

if (CONFIRM !== "DELETE") { console.log("Refused: confirm must be DELETE."); process.exit(1); }
if (match.length !== 1) { console.log("Refused: exactly one account must match, found " + match.length + "."); process.exit(1); }
const id = String(match[0].id);
if (id === own) { console.log("Refused: that is the owner account."); process.exit(1); }
if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) { console.log("Refused: unexpected id format."); process.exit(1); }
const T = ["sessions", "pw_resets", "garmin_workouts", "profiles", "done", "food", "ai_usage", "checkins", "weights", "activities", "strava_links",
  "oauth_states", "reviews", "coach_notes", "push_subs", "settings", "notif_log", "import_keys", "health_daily", "reports", "link_keys", "lift_logs",
  "meal_plans", "crew_members", "garmin_links"];
const sql = T.map(t => `DELETE FROM ${t} WHERE user_id = '${id}';`).join(" ") +
  " DELETE FROM crews WHERE id NOT IN (SELECT crew_id FROM crew_members);" +
  ` UPDATE crews SET owner_id = (SELECT user_id FROM crew_members m WHERE m.crew_id = crews.id ORDER BY joined LIMIT 1) WHERE owner_id = '${id}';` +
  ` DELETE FROM users WHERE id = '${id}';`;
q(sql);
const left = q(`SELECT COUNT(*) AS n FROM users WHERE id = '${id}'`)[0].n;
console.log(left === 0 ? "Deleted 1 account (the requested one). Real accounts now: " + (rows.length - 1) : "Delete did not complete.");
process.exit(left === 0 ? 0 : 1);
