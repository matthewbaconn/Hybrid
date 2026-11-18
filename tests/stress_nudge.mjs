// Stress nudge end to end on a local API (Nov 18): a Garmin daily summary with a stressful stretch -> one nudge a day,
// none when the member turned them off. Run: cd api && wrangler d1 migrations apply hybrid --local && wrangler dev --port 8787
import {execSync} from "node:child_process";
const API = process.env.API || "http://localhost:8787"; let bad = 0;
const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const sql = q => JSON.parse(execSync(`cd api && npx wrangler d1 execute hybrid --local --json --command ${JSON.stringify(q)}`, {encoding: "utf8"}))[0].results;
const call = async (m, p, tok, d) => { const r = await fetch(API + p, {method: m, headers: {"content-type": "application/json", ...(tok ? {Authorization: "Bearer " + tok} : {})}, body: d ? JSON.stringify(d) : undefined}); return r.json().catch(() => ({})); };
const id = Date.now().toString(36);
const tok = (await call("POST", "/api/signup", null, {email: `s-${id}@test.dev`, password: "password123", name: "S", agree: true})).token;
const uid = sql(`SELECT id FROM users WHERE email = 's-${id}@test.dev'`)[0].id;
sql(`INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES ('${uid}', 'g-${id}', 'x', 'x', 0, '2026-11-18')`);
const today = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(new Date());
const hour = +new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour: "numeric", hourCycle: "h23"}).format(new Date());
const push = (high) => fetch(API + "/api/garmin/push", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({dailies: [{userId: `g-${id}`, calendarDate: today, averageStressLevel: 55, highStressDurationInSeconds: high, stressQualifier: "stressful", steps: 4000}]})});
const nudges = () => sql(`SELECT count(*) AS n FROM notif_log WHERE user_id = '${uid}' AND kind = 'stress'`)[0].n;
await push(60 * 60); await new Promise(r => setTimeout(r, 2500));
if (hour >= 8 && hour < 21){
  t(nudges() === 1, "a stressful stretch sends one nudge");
  await push(90 * 60); await new Promise(r => setTimeout(r, 2500));
  t(nudges() === 1, "never a second one the same day");
} else t(nudges() === 0, "outside 8am-9pm nothing is sent (quiet hours)");
t(sql(`SELECT stress FROM health_daily WHERE user_id = '${uid}' AND date = '${today}'`)[0].stress === 55, "the day's stress is stored");
const tok2 = (await call("POST", "/api/signup", null, {email: `s2-${id}@test.dev`, password: "password123", name: "S2", agree: true})).token;
const uid2 = sql(`SELECT id FROM users WHERE email = 's2-${id}@test.dev'`)[0].id;
await call("PUT", "/api/settings", tok2, {n_stress: false});
sql(`INSERT INTO garmin_links (user_id, garmin_user_id, access_token, refresh_token, expires_at, connected) VALUES ('${uid2}', 'g2-${id}', 'x', 'x', 0, '2026-11-18')`);
await fetch(API + "/api/garmin/push", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({dailies: [{userId: `g2-${id}`, calendarDate: today, averageStressLevel: 70, highStressDurationInSeconds: 7200, stressQualifier: "very_stressful"}]})});
await new Promise(r => setTimeout(r, 2500));
t(sql(`SELECT count(*) AS n FROM notif_log WHERE user_id = '${uid2}' AND kind = 'stress'`)[0].n === 0, "members who turned stress nudges off get none");
process.exit(bad ? 1 : 0);
