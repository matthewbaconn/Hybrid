-- where to send the person back after Strava/Garmin sign-in (the app's web address they started from)
ALTER TABLE oauth_states ADD COLUMN ret TEXT;
