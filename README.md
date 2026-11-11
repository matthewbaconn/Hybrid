# Hybrid

Run and lift training plans built around your goals. Answer a few questions (race, current running,
lifting days, schedule) and get a week-by-week plan with paces, strength days and daily fuel targets.

**Open the app:** https://matthewbaconn.github.io/Hybrid/

On iPhone, open it in Safari, tap Share → Add to Home Screen, and it runs full screen like an app.
On Android, Chrome offers "Install app".

This is an early demo. Plans come from fixed training rules, and answers are saved only on your own
device. Connecting Strava and Garmin is planned.

## Food photos

The Today tab has a food log. Typing what you ate or taking a photo goes through a small relay in
`food-relay/` (a Cloudflare Worker) that holds the AI key, so the key never reaches the app. Until the
relay is set up, the food log takes numbers by hand. The relay is deployed by the
"Deploy food relay" workflow from three repository secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `ANTHROPIC_API_KEY`.
