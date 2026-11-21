// Domains (Matthew, Nov 21, 2026: "I just registered my permanent brand domain: milesetapp.com").
// Pure, no network: which address serves what, where old addresses go, which origins may call the API.
// Tested by tests/domains.mjs.
//
// Two phases, one switch (the Worker var MILESET_DOMAIN):
//   off (default): milesetapp.com, www.milesetapp.com and app.milesetapp.com serve exactly what the hybrdrunning.com
//                  addresses serve. Nothing moves, so nothing can break while DNS and Resend are still being verified.
//   on:            milesetapp.com is home. The old website 301s there (path and query kept; browsers carry the #part
//                  across a redirect by themselves). The old app address keeps serving the app: a login and the HQ key
//                  are saved per address, so a server redirect would sign everyone out. Instead a browser tab moves
//                  itself and carries the login (index.html, #move=), HQ hops with its key (hqHop below), and a
//                  Home Screen icon stays where it is (its login, reminders and icon live at that address).

export const NEW = {site: "milesetapp.com", www: "www.milesetapp.com", app: "app.milesetapp.com"};
export const OLD = {site: "hybrdrunning.com", www: "www.hybrdrunning.com", app: "app.hybrdrunning.com"};
const OLDEST = {site: "hybridrunnin.com", www: "www.hybridrunnin.com", app: "app.hybridrunnin.com"};

export const SITE_HOSTS = new Set([...Object.values(NEW), ...Object.values(OLD), ...Object.values(OLDEST)]);
export const ORIGINS = ["https://" + NEW.app, "https://" + NEW.site, "https://" + NEW.www, "https://" + OLD.app, "https://" + OLD.site,
  "https://" + OLDEST.app, "https://matthewbaconn.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const APP_ORIGINS = new Set(["https://" + NEW.app, "https://" + OLD.app, "https://" + OLDEST.app]);

export const isLive = env => !!env && String(env.MILESET_DOMAIN || "").toLowerCase() === "on";
/** The app's canonical address (links in emails, password resets, sign-in returns). */
export const appHome = env => isLive(env) ? "https://" + NEW.app + "/" : ((env && env.APP_URL) || "https://" + OLD.app + "/");
export const siteHome = env => "https://" + (isLive(env) ? NEW.site : OLD.site) + "/";

/** CORS: the caller's origin if it's one of ours, else the canonical app origin. */
export function allowOrigin(origin, env){ return ORIGINS.includes(origin) ? origin : appHome(env).replace(/\/$/, ""); }
/** Where a Strava/Garmin sign-in sends the person back: the app address they started from. */
export function returnFor(origin){
  if (APP_ORIGINS.has(origin)) return origin + "/";
  return origin === "https://matthewbaconn.github.io" ? origin + "/Hybrid/" : null;
}

/** Search Console proves ownership of the old site with this file; it must keep answering there (never redirected). */
const VERIFY_FILE = /^\/google[0-9a-f]{8,}\.html$/;

/**
 * What a request to one of our website/app hosts should get.
 *   {redirect: url}  301 to url
 *   {hop: true}      HQ on the old app address after the switch: a tiny page that carries the HQ key across
 *   {serve: true}    serve the page from GitHub Pages as before
 */
export function siteRoute(host, pathname, search, env){
  const live = isLive(env), path = pathname || "/", q = search || "";
  const home = "https://" + (live ? NEW.site : OLD.site);
  if (host === NEW.www) return {redirect: "https://" + NEW.site + path + q};
  if (host === OLD.www || host === OLDEST.site || host === OLDEST.www) return {redirect: home + path + q};
  if (host === OLD.site && live && !VERIFY_FILE.test(path)) return {redirect: home + path + q};
  if (host === OLD.app && live){
    if (/^\/hq(\/|$)/.test(path)) return {hop: true};
    if (/^\/vesper-hud(\/|$)/.test(path)) return {redirect: "https://" + NEW.app + path + q};   // its data rides in the #part, which the browser keeps
  }
  return {serve: true};
}

/** The page that moves HQ (and the Stark kiosk) from the old app address, carrying this device's key in the #part. */
export function hqHop(){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Mileset HQ</title></head>' +
    '<body style="background:#07080B;color:#9aa3ad;font:15px -apple-system,Segoe UI,Roboto,sans-serif;padding:24px">' +
    '<script>(function(){var h=location.hash.replace(/^#/,""),k=null;try{k=localStorage.getItem("hq-k")}catch(e){}' +
    'if(k&&/^[A-Za-z0-9_-]{40,}$/.test(k)&&!/(^|&)k=/.test(h))h="k="+k+(h?"&"+h:"");' +
    'location.replace("https://' + NEW.app + '"+location.pathname+location.search+(h?"#"+h:""));})();</script>' +
    '<noscript>HQ moved to <a style="color:#5eead4" href="https://' + NEW.app + '/hq/">' + NEW.app + '/hq/</a>.</noscript>' +
    '</body></html>';
}

/** Visit counter path for a host ("app:/" for the app's front door, the page path for the website), or null. */
export function siteKind(host){
  if (host === NEW.site || host === OLD.site) return "site";
  if (host === NEW.app || host === OLD.app) return "app";
  return null;
}
