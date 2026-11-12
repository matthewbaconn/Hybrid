#!/usr/bin/env bash
# Nightly health report: reads the server's own health log from the live database.
# Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; optional STRAVA_CLIENT_ID/SECRET for the Strava check.
set -uo pipefail
cd "$(dirname "$0")/../api"
q(){ npx wrangler d1 execute hybrid --remote --json --command "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j[0].results))}catch(e){process.stdout.write("[]")}})'; }
problems=0; warn(){ echo "::warning::$1"; echo "- ⚠️ $1" >> "$GITHUB_STEP_SUMMARY"; }; bad(){ echo "::error::$1"; echo "- ❌ $1" >> "$GITHUB_STEP_SUMMARY"; problems=$((problems+1)); }; good(){ echo "$1"; echo "- ✅ $1" >> "$GITHUB_STEP_SUMMARY"; }
echo "## Hybrid health report" >> "$GITHUB_STEP_SUMMARY"

# custom domains: website and app answer and look right
for pair in "https://hybridrunnin.com/|Train for anything" "https://hybrdrunning.com/|Train for anything" "https://app.hybrdrunning.com/|HYBRD" "https://app.hybrdrunning.com/plan.js|root.HP" "https://hybrdrunning.com/today.jpg|"; do
  u=${pair%%|*}; want=${pair#*|}
  body=$(curl -s -L --max-time 20 -w '\n%{http_code}' "$u"); code=${body##*$'\n'}
  if [ "$code" != 200 ]; then bad "$u answered HTTP $code"; elif [ -n "$want" ] && ! grep -q "$want" <<<"$body"; then bad "$u didn't look right"; else good "$u is up"; fi
done

last=$(q "SELECT MAX(ts) AS t FROM events WHERE kind = 'cron'" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s||"[]");process.stdout.write((r[0]&&r[0].t)||"")})')
if [ -z "$last" ]; then bad "The 15-minute schedule has never run."; else
  age=$(( ( $(date +%s) - $(date -d "$last" +%s) ) / 60 ))
  if [ "$age" -gt 35 ]; then bad "The 15-minute schedule last ran $age min ago ($last)."; else good "15-minute schedule ran $age min ago."; fi
fi

counts=$(q "SELECT kind, SUM(ok) AS ok, SUM(1 - ok) AS failed FROM events WHERE ts >= datetime('now', '-1 day') GROUP BY kind")
echo "Last 24 h: $counts"
echo "$counts" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s||"[]");const by=Object.fromEntries(r.map(x=>[x.kind,x]));
const lines=[];const g=k=>by[k]||{ok:0,failed:0};
lines.push(["cron",g("cron").ok+" runs"]);
for(const k of ["strava_notice","strava_sync","strava_token","push","ai_coach","ai_food","cron_user","server_error"]){const x=g(k);lines.push([k,x.ok+" ok, "+x.failed+" failed"]);}
console.log(lines.map(l=>l.join(": ")).join("\n"));
const flag=(k,max)=>{const x=g(k);if(x.failed>max)console.log("FLAG "+k+" failed "+x.failed+" times in 24 h");};
flag("server_error",0);flag("cron_user",0);flag("push",3);flag("ai_coach",3);flag("ai_food",3);flag("strava_sync",3);flag("strava_token",0);
})' | tee /tmp/health_counts.txt
echo '```' >> "$GITHUB_STEP_SUMMARY"; grep -v '^FLAG' /tmp/health_counts.txt >> "$GITHUB_STEP_SUMMARY"; echo '```' >> "$GITHUB_STEP_SUMMARY"
grep '^FLAG' /tmp/health_counts.txt | sed 's/^FLAG //' | while read -r l; do echo "::warning::$l"; echo "- ⚠️ $l" >> "$GITHUB_STEP_SUMMARY"; done

errs=$(q "SELECT ts, kind, detail FROM events WHERE ok = 0 AND ts >= datetime('now', '-1 day') ORDER BY ts DESC LIMIT 15")
[ "$errs" != "[]" ] && { echo "Recent failures: $errs"; echo "Recent failures (newest first):" >> "$GITHUB_STEP_SUMMARY"; echo '```' >> "$GITHUB_STEP_SUMMARY"; echo "$errs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).forEach(e=>console.log(e.ts+"  "+e.kind+"  "+(e.detail||""))))' >> "$GITHUB_STEP_SUMMARY"; echo '```' >> "$GITHUB_STEP_SUMMARY"; }

stats=$(q "SELECT (SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@example.com') AS real_users, (SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@example.com' AND created > datetime('now', '-1 day')) AS new_today, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM profiles) AS plans, (SELECT COUNT(*) FROM strava_links) AS strava, (SELECT COUNT(DISTINCT user_id) FROM push_subs) AS push_users, (SELECT COUNT(*) FROM sessions WHERE expires > datetime('now')) AS sessions")
good "Accounts: $stats"
# test accounts delete themselves, and their reports with them; this clears anything left behind
q "DELETE FROM reports WHERE text LIKE 'Nightly test report.%'" > /dev/null || true
good "Problem reports waiting: $(q "SELECT COUNT(*) AS n FROM reports") · owner account: $(q "SELECT substr(created, 1, 10) AS since, (SELECT COUNT(*) FROM strava_links s WHERE s.user_id = u.id) AS strava FROM users u WHERE email NOT LIKE '%@example.com' ORDER BY created LIMIT 1")"

if [ -n "${STRAVA_CLIENT_ID:-}" ] && [ -n "${STRAVA_CLIENT_SECRET:-}" ]; then
  subs=$(curl -sS "https://www.strava.com/api/v3/push_subscriptions?client_id=$STRAVA_CLIENT_ID&client_secret=$STRAVA_CLIENT_SECRET")
  if echo "$subs" | grep -q "hybrid-api.hybridapp.workers.dev/api/strava/webhook"; then good "Strava activity notices are registered."; else bad "Strava activity notices aren't registered: $subs (run Deploy API to re-register)."; fi
fi
[ "$problems" -eq 0 ] || exit 1
