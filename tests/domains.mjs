// milesetapp.com move (Matthew, Nov 21, 2026): which address serves what, before and after the MILESET_DOMAIN switch.
// Pure, no network:  node tests/domains.mjs
import {siteRoute, hqHop, allowOrigin, returnFor, appHome, siteHome, isLive, SITE_HOSTS, ORIGINS, siteKind} from "../api/domains.mjs";
import {readFileSync} from "node:fs";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const OFF = {MILESET_DOMAIN: "off", APP_URL: "https://app.hybrdrunning.com/"}, ON = {MILESET_DOMAIN: "on", APP_URL: "https://app.hybrdrunning.com/"};
const r = (host, path, q, env) => siteRoute(host, path, q, env);

// the switch
ok(!isLive(OFF) && !isLive({}) && isLive(ON) && isLive({MILESET_DOMAIN: "ON"}), "switch: off by default, on only when set");
ok(appHome(OFF) === "https://app.hybrdrunning.com/" && appHome(ON) === "https://app.milesetapp.com/", "app home follows the switch");
ok(siteHome(OFF) === "https://hybrdrunning.com/" && siteHome(ON) === "https://milesetapp.com/", "site home follows the switch");

// every address is ours
for (const h of ["milesetapp.com", "www.milesetapp.com", "app.milesetapp.com", "hybrdrunning.com", "www.hybrdrunning.com", "app.hybrdrunning.com", "hybridrunnin.com", "www.hybridrunnin.com", "app.hybridrunnin.com"])
  ok(SITE_HOSTS.has(h), "served by the Worker: " + h);
ok(!SITE_HOSTS.has("evil.com") && !SITE_HOSTS.has("milesetapp.com.evil.com"), "nobody else's host");

// before the switch: both domains serve, nothing moves
ok(r("milesetapp.com", "/fueling-calculator", "?src=ig", OFF).serve, "off: milesetapp.com serves the website");
ok(r("app.milesetapp.com", "/", "", OFF).serve && r("app.milesetapp.com", "/hq/", "", OFF).serve, "off: app.milesetapp.com serves the app and HQ");
ok(r("hybrdrunning.com", "/terms", "", OFF).serve && r("app.hybrdrunning.com", "/hq/", "", OFF).serve, "off: hybrdrunning.com unchanged (no redirect, no HQ hop)");
ok(r("www.milesetapp.com", "/links", "?a=1", OFF).redirect === "https://milesetapp.com/links?a=1", "www.milesetapp.com 301s to milesetapp.com (path + query kept)");
ok(r("www.hybrdrunning.com", "/x", "?q=2", OFF).redirect === "https://hybrdrunning.com/x?q=2", "off: www.hybrdrunning.com still goes to hybrdrunning.com");
ok(r("hybridrunnin.com", "/", "", OFF).redirect === "https://hybrdrunning.com/", "off: hybridrunnin.com still goes to hybrdrunning.com");

// after the switch
ok(r("hybrdrunning.com", "/race-pace-calculator", "?src=pace&x=1", ON).redirect === "https://milesetapp.com/race-pace-calculator?src=pace&x=1", "on: old site 301s with path + query");
ok(r("www.hybrdrunning.com", "/", "", ON).redirect === "https://milesetapp.com/" && r("hybridrunnin.com", "/a", "", ON).redirect === "https://milesetapp.com/a", "on: www and the oldest domain go straight to milesetapp.com (one hop)");
ok(r("hybrdrunning.com", "/google59f1fe97e32e6c3b.html", "", ON).serve, "on: the Search Console verification file still answers on the old site (no redirect)");
ok(r("hybrdrunning.com", "/google-search.html", "", ON).redirect, "on: only the real verification file pattern is exempt");
ok(r("app.hybrdrunning.com", "/", "", ON).serve && r("app.hybrdrunning.com", "/index.html", "?ref=abcd1234", ON).serve,
   "on: the old app address keeps serving the app (a server redirect would sign members out; the tab moves itself)");
ok(r("app.hybrdrunning.com", "/plan.js", "", ON).serve && r("app.hybrdrunning.com", "/sw.js", "", ON).serve, "on: old app scripts and service worker keep working (Home Screen icons)");
ok(r("app.hybrdrunning.com", "/hq/", "", ON).hop && r("app.hybrdrunning.com", "/hq/next/", "", ON).hop && r("app.hybrdrunning.com", "/hq", "", ON).hop, "on: HQ on the old address hops (and carries the key)");
ok(!r("app.hybrdrunning.com", "/hqx", "", ON).hop, "on: only /hq paths hop");
ok(r("app.hybrdrunning.com", "/vesper-hud/", "?v=3", ON).redirect === "https://app.milesetapp.com/vesper-hud/?v=3", "on: the HUD 301s (its data rides in the #part, which browsers keep)");
ok(r("app.milesetapp.com", "/hq/", "", ON).serve && r("milesetapp.com", "/", "", ON).serve, "on: the new addresses serve");

// the HQ hop page
const hop = hqHop();
ok(hop.includes('localStorage.getItem("hq-k")') && hop.includes('location.replace("https://app.milesetapp.com"+location.pathname+location.search'), "hop: reads this device's key and keeps path + query");
ok(/!\/\(\^\|&\)k=\/\.test\(h\)/.test(hop) && hop.includes('h="k="+k+(h?"&"+h:"")'), "hop: adds the key in front of the #part (so #open=... still works) and never twice");
ok(hop.includes("{40,}") && !/fetch\(|XMLHttpRequest|sendBeacon|<img|<link/.test(hop), "hop: only a valid key, and the page sends nothing anywhere");
ok(hop.includes('name="robots" content="noindex"'), "hop: never indexed");
// simulate the hop in a fake browser
const run = (hash, key) => { let to = null; const localStorage = {getItem: () => key}, location = {hash, pathname: "/hq/", search: "?x=1", replace: u => to = u};
  new Function("localStorage", "location", hop.match(/<script>([\s\S]*?)<\/script>/)[1])(localStorage, location); return to; };
const K = "A".repeat(43);
ok(run("", K) === "https://app.milesetapp.com/hq/?x=1#k=" + K, "hop: key carried in the #part (never sent to a server)");
ok(run("#open=approvals", K) === "https://app.milesetapp.com/hq/?x=1#k=" + K + "&open=approvals", "hop: Telegram 'Open in HQ' (#open=approvals) still opens the right drawer");
ok(run("#k=" + "B".repeat(43), K) === "https://app.milesetapp.com/hq/?x=1#k=" + "B".repeat(43), "hop: a key already in the link wins, not doubled");
ok(run("", null) === "https://app.milesetapp.com/hq/?x=1" && run("", "short") === "https://app.milesetapp.com/hq/?x=1", "hop: no key or a junk key: moves without one");
// HQ itself reads open= before the key handler rewrites the address, and accepts &open=
const hq = readFileSync(new URL("../hq/index.html", import.meta.url), "utf8"), hqNext = readFileSync(new URL("../hq/next/index.html", import.meta.url), "utf8");
ok(/location\.hash\.match\(\/k=\(\[A-Za-z0-9_-\]\{40,\}\)\/\)/.test(hq) && /location\.hash\.match\(\/k=\(\[A-Za-z0-9_-\]\{40,\}\)\/\)/.test(hqNext),
   "HQ pages take the key from #k=... wherever it sits in the #part");
// (#open= is read by the new HQ in #122 with /(?:^#|&)open=/, so "#k=...&open=approvals" from the hop works there too)

// CORS and sign-in returns
for (const o of ["https://app.milesetapp.com", "https://milesetapp.com", "https://www.milesetapp.com", "https://app.hybrdrunning.com", "https://hybrdrunning.com"])
  ok(allowOrigin(o, OFF) === o && ORIGINS.includes(o), "CORS allows " + o);
ok(allowOrigin("https://evil.com", OFF) === "https://app.hybrdrunning.com" && allowOrigin("https://evil.com", ON) === "https://app.milesetapp.com", "CORS: anyone else gets the canonical app origin, never their own");
ok(allowOrigin("https://app.milesetapp.com.evil.com", ON) === "https://app.milesetapp.com", "CORS: look-alike hosts refused");
ok(returnFor("https://app.milesetapp.com") === "https://app.milesetapp.com/" && returnFor("https://app.hybrdrunning.com") === "https://app.hybrdrunning.com/", "Strava/Garmin send people back to the app address they started from");
ok(returnFor("https://milesetapp.com") === null && returnFor("https://evil.com") === null, "sign-in returns only to an app address");
ok(siteKind("milesetapp.com") === "site" && siteKind("app.milesetapp.com") === "app" && siteKind("hybrdrunning.com") === "site" && siteKind("www.milesetapp.com") === null, "visit counter covers both domains");

// the app moves a browser tab only when the server says live, never a Home Screen icon, never mid password reset
const app = readFileSync(new URL("../index.html", import.meta.url), "utf8");
ok(/location\.hostname === "app\.hybrdrunning\.com" && !isStandalone && API/.test(app) && /j && j\.live \?/.test(app) && /!resetCode\) moveApp/.test(app),
   "app: an old-address tab moves only when /api/home says live, never from the Home Screen or mid reset");
ok(/if \(mv\[1\] && !tokenStore\.get\(\)\)\s*\{?\s*tokenStore\.set\(mv\[1\]\)/.test(app), "app: a carried login never replaces one already on the new address");
ok(/\^#\(move=\|moved\|reset=\)/.test(app) && /\^#\?move=\|\^#\?moved/.test(app), "app: the carried #part can't smuggle another login or loop");

console.log(failed ? failed + " failed" : "all domain checks pass");
process.exit(failed ? 1 : 0);
