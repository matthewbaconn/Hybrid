// Visitor-kind diagnostic (Nov 17, 2026): realistic user agents land in the right broad label, only a fixed label can
// ever come out (never the user agent, an email or anything typed), and nothing but day/path/kind/count is stored.
// Runs in PR checks from tests/webhooks.mjs (pr-checks.yml is a protected file).   node tests/visits.mjs
import {readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
const API = join(dirname(fileURLToPath(import.meta.url)), "..", "api");
const {visitKind, KIND_LABELS} = await import(join(API, "visits.mjs"));
let failed = 0;
const ok = (c, m) => { console.log((c ? "ok " : "::error::") + "visit kinds: " + m); if (!c) failed++; };
const cases = [
  ["mobile", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"],
  ["mobile", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"],
  ["in-app", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,3; iOS 18_1; en_US)"],
  ["in-app", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/490.0.0.40.108;FBBV/123]"],
  ["desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
  ["desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"],
  ["agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/0.14.10 Chrome/130.0.6723.137 Electron/33.2.0 Safari/537.36"],
  ["agent", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"],
  ["agent", "Claude-User (claude-code/1.0; +https://support.anthropic.com/)"],
  ["bot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["bot", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["bot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0"],
  ["tool", "curl/8.5.0"], ["tool", "python-httpx/0.27.0"], ["tool", "node"], ["tool", "Wget/1.21.4"],
  ["test", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Playwright MilesetTest"],
  ["test", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36"],
  ["none", ""], ["other", "Mozilla/5.0"]];
for (const [want, ua] of cases) ok(visitKind(ua) === want, want + " <- " + (ua.slice(0, 70) || "(empty)") + " (got " + visitKind(ua) + ")");
ok(visitKind(cases[0][1], "prefetch") === "prefetch" && visitKind(cases[0][1], "prerender") === "prefetch", "browser prefetches are their own label");
// privacy: only a fixed label ever comes out, whatever the input
const hostile = ["jane.doe@gmail.com", "Jane Doe 555-0100", "<script>alert(1)</script>", "x".repeat(5000), "'; DROP TABLE users; --", "\u0000‮", "Mozilla/5.0 (iPhone) token=sk-ant-AAAA"];
const outs = [...cases.map(c => visitKind(c[1])), ...hostile.map(h => visitKind(h)), ...hostile.map(h => visitKind(cases[0][1], h))];
ok(outs.every(o => KIND_LABELS.includes(o)) && KIND_LABELS.length === 10, "only one of " + KIND_LABELS.length + " fixed labels can come out (" + KIND_LABELS.join(", ") + ")");
// storage: the table holds day, path, kind and a count, nothing else; the worker binds only those
const mig = readFileSync(join(API, "migrations", "0025_page_view_kinds.sql"), "utf8");
const cols = [...mig.matchAll(/^\s+(\w+)\s+(TEXT|INTEGER)/gm)].map(m => m[1]);
ok(cols.join() === "day,path,kind,n", "page_view_kinds has only day, path, kind, n (" + cols.join() + ")");
const W = readFileSync(join(API, "worker.js"), "utf8");
const ins = W.match(/INSERT INTO page_view_kinds[^"]*"\)\s*\.bind\(([^)]*\([^)]*\))\)/);
ok(ins && ins[1].replace(/\s/g, "") === "day,p,visitKind(ua,purpose)", "the worker stores only day, page and the label (" + (ins ? ins[1] : "not found") + ")");
ok((W.match(/page_view_kinds/g) || []).length === 2 && !/CF-Connecting-IP|cf-connecting-ip/.test(W.slice(W.indexOf("function countView"), W.indexOf("async function stravaToken"))), "no other use of the table, and no IP read in the visit counter");
ok(/DELETE FROM page_view_kinds WHERE day < \?/.test(W), "diagnostic rows are pruned after 30 days");
console.log(failed ? failed + " visit-kind check(s) failed" : "visit kinds: all checks pass");
process.exit(failed ? 1 : 0);
