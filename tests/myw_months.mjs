// My workouts: history by month and fair change badges (Nov 23, 2026). A member asked for "a drop down menu for each
// month so you can look at your history and then each month it should clear so the list doesn't get too long", and a
// lighter set for more reps (5 lb × 20 after 10 lb with no reps logged) showed a red "−5 lb". Pulls the real functions
// out of index.html and runs them on made-up logs. No browser, no network.
//   node tests/myw_months.mjs
import {readFileSync} from "node:fs";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "ok " : "::error::") + msg); if (!cond) failed++; };
const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = src.indexOf("const mywHist = "), b = src.indexOf("function mywSave(");
ok(a > 0 && b > a, "found the My workouts helpers in index.html");
const code = src.slice(a, b).replace(/^function mywLast.*$/m, "");

function run(liftLog, TODAY, mywOpen = {}){
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const shortD = d => d.slice(5);
  return new Function("liftLog", "TODAY", "mywOpen", "esc", "shortD",
    code + "\nreturn {mywChange, mywMonthsHtml, mywHist};")(liftLog, TODAY, mywOpen, esc, shortD);
}

// 1. the screenshot: lighter weight with more reps is not "down"
let f = run([{ex: "Cable Lateral Raises", date: "2026-11-19", weight: 10, sets: 3},
             {ex: "Cable Lateral Raises", date: "2026-11-21", weight: 5, reps: 20, sets: 3}], "2026-11-23");
let c = f.mywChange({n: "Cable Lateral Raises"});
ok(c && c.up !== false, "5 lb × 20 after 10 lb (no reps logged) isn't red: " + JSON.stringify(c));
f = run([{ex: "Rear Delt Flies", date: "2026-11-19", weight: 20, reps: 5, sets: 3},
         {ex: "Rear Delt Flies", date: "2026-11-21", weight: 18, reps: 10, sets: 3}], "2026-11-23");
c = f.mywChange({n: "Rear Delt Flies"});
ok(c && c.up === true && /reps/.test(c.txt), "18 × 10 after 20 × 5 is stronger overall, shown as up: " + JSON.stringify(c));
f = run([{ex: "Press", date: "2026-11-19", weight: 40, reps: 10}, {ex: "Press", date: "2026-11-21", weight: 30, reps: 8}], "2026-11-23");
ok(f.mywChange({n: "Press"}).up === false, "lighter AND fewer reps is still down");
f = run([{ex: "Press", date: "2026-11-19", weight: 30, reps: 10}, {ex: "Press", date: "2026-11-21", weight: 35, reps: 8}], "2026-11-23");
ok(f.mywChange({n: "Press"}).up === true && f.mywChange({n: "Press"}).txt === "+5 lb", "heavier is still +5 lb, up");

// 2. months: this month listed, earlier months folded, newest first
const log = [{ex: "Squat", date: "2026-09-10", weight: 185, reps: 5}, {ex: "Squat", date: "2026-10-02", weight: 195, reps: 5},
             {ex: "Squat", date: "2026-10-20", weight: 200, reps: 5}, {ex: "Squat", date: "2026-11-05", weight: 205, reps: 5},
             {ex: "Squat", date: "2026-11-21", weight: 210, reps: 5}];
f = run(log, "2026-11-23");
let h = f.mywMonthsHtml({n: "Squat"}, f.mywHist("Squat"));
ok((h.match(/<li>/g) || []).length === 2 && h.includes("210 lb") && h.includes("205 lb") && !h.includes("200 lb"), "only November's 2 sets are listed");
ok(h.indexOf("October") > 0 && h.indexOf("September") > h.indexOf("October"), "October then September as fold-up rows");
ok(/October<\/span><small>2 times/.test(h) && /September<\/span><small>1 time</.test(h), "each month row says how many times");
ok(/data-act="mywmonth" data-k="squat\|2026-10"/.test(h) && /aria-expanded="false"/.test(h), "rows are tap-to-open buttons, closed by default");
f = run(log, "2026-11-23", {"squat|2026-10": true});
h = f.mywMonthsHtml({n: "Squat"}, f.mywHist("Squat"));
ok(h.includes("200 lb") && h.includes("195 lb") && !h.includes("185 lb") && /aria-expanded="true"/.test(h), "opening October shows its sets only");
f = run(log, "2026-12-02");
h = f.mywMonthsHtml({n: "Squat"}, f.mywHist("Squat"));
ok(/Nothing logged in December yet/.test(h) && !/<li>/.test(h) && /November<\/span><small>2 times/.test(h), "a new month starts clear; November folds up");
f = run(log, "2027-01-04");
h = f.mywMonthsHtml({n: "Squat"}, f.mywHist("Squat"));
ok(/November 2026/.test(h), "last year's months carry the year");

// 3. the screen uses it, and the old "Show all" button is gone
ok(src.includes("mywMonthsHtml(e, hs)") && !src.includes('data-act="mywmore"') && src.includes('act === "mywmonth"'), "the progress card uses the month view");
console.log(failed ? `${failed} check(s) failed` : "all My workouts month checks passed");
process.exit(failed ? 1 : 0);
