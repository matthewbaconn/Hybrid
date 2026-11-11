# Hybrid

Run and lift training plans built around your goals. Answer a few questions (race, current running,
lifting days, schedule) and get a week-by-week plan with paces, strength days and daily fuel targets.

**Open the app:** https://matthewbaconn.github.io/Hybrid/

On iPhone, open it in Safari, tap Share → Add to Home Screen, and it runs full screen like an app.
On Android, Chrome offers "Install app".

This is an early demo. Plans come from fixed training rules, and answers are saved only on your own
device. Connecting Strava and Garmin is planned.

## Tracking

- **Morning check-in:** five taps (sleep, sleep quality, soreness, energy, stress) give a readiness score.
  Green trains as planned, amber trims the session, red makes the day easy and moves the workout.
- **Workouts:** connect Strava (Garmin, COROS and Apple Watch can upload to Strava) or log them by hand.
  A logged workout checks off the planned session and adds its calories to the day.
- **Calories:** base target from the 7-day average weight (about 13 cal/lb, minus 400 when cutting) plus
  logged training (75% of it when cutting). Food can be logged for any of the last 30 days.
- **Weight:** morning weigh-ins, 7-day average, weekly change and distance to goal on the Training tab.

## Coaching and notifications

- **Runs adjust from how the last ones went:** workout reps (Strava laps, or the rep pace typed in) vs target move
  the next workouts' paces 5 s/mi (max ±15) and add a rep after a too-easy workout; easy runs that are too fast
  get a note; an on-target long run makes the next one's last mile steady.
- **Weekly calorie rules:** deficit starts at 400, then ±150 a week from the weight trend (250–750), every 8th
  week a diet break, maintenance at the goal weight. Hard days are at most 250 under.
- **AI coach notes:** a short review after each workout and a note after the morning check-in (12 a day max).
- **Notifications** (Settings → Notifications; on iPhone, install to the home screen first): morning check-in
  reminder, a summary after each workout, Monday recap, bedtime reminder. A Cloudflare schedule runs every
  15 minutes; Strava tells the server about new activities, with an hourly backup sync.
- The plan logic is in `plan.js`, shared by the app and the server.

## Connect Strava

The Strava app currently allows 10 connected athletes (raise it on strava.com/settings/api; past that,
Strava's review form). To switch the button on: set the Strava app's Authorization Callback Domain to
`hybrid-api.hybridapp.workers.dev`, add repository secrets `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`,
then run "Deploy API".

## Accounts and backend

People sign up with email and password. Their plan, checked-off sessions and food log are saved on the
server, so they follow them to any phone. Food photos and descriptions are read by AI on the server;
the AI key never reaches the app. Each person gets 30 food reads a day.

The backend is in `api/`: a Cloudflare Worker with a D1 database (`api/migrations/`). The
"Deploy API" workflow deploys it from three repository secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `ANTHROPIC_API_KEY`. Settings → Delete my account removes a person's
account and all their data.
