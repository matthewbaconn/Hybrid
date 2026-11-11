# Hybrid

Run and lift training plans built around your goals. Answer a few questions (race, current running,
lifting days, schedule) and get a week-by-week plan with paces, strength days and daily fuel targets.

**Open the app:** https://matthewbaconn.github.io/Hybrid/

On iPhone, open it in Safari, tap Share → Add to Home Screen, and it runs full screen like an app.
On Android, Chrome offers "Install app".

This is an early demo. Plans come from fixed training rules, and answers are saved only on your own
device. Connecting Strava and Garmin is planned.

## Accounts and backend

People sign up with email and password. Their plan, checked-off sessions and food log are saved on the
server, so they follow them to any phone. Food photos and descriptions are read by AI on the server;
the AI key never reaches the app. Each person gets 30 food reads a day.

The backend is in `api/`: a Cloudflare Worker with a D1 database (`api/migrations/`). The
"Deploy API" workflow deploys it from three repository secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `ANTHROPIC_API_KEY`. Settings → Delete my account removes a person's
account and all their data.
