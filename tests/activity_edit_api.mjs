// Edit a workout, API side (Nov 18): description, type, tag, effort, private note, shoes. Only the owner's own row; shoes add
// up miles; a bad tag/type/effort or someone else's shoes are refused; the original type stays underneath.
// Run: cd api && wrangler d1 migrations apply hybrid --local && wrangler dev --port 8787, then: node tests/activity_edit_api.mjs
const API = process.env.API || "http://localhost:8787"; let bad = 0;
const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const call = async (tok, M, p, b) => { const r = await fetch(API + p, {method: M, headers: {"Content-Type": "application/json", Origin: "http://localhost:8000", ...(tok ? {Authorization: "Bearer " + tok} : {})}, body: b ? JSON.stringify(b) : undefined}); return {s: r.status, j: await r.json().catch(() => ({}))}; };
const signup = async e => (await call(null, "POST", "/api/signup", {email: e, password: "edit-test-12345", name: "E", agree: true})).j.token;
const k = Date.now(), A = await signup("a-" + k + "@edit.test"), B = await signup("b-" + k + "@edit.test");
const today = new Date().toISOString().slice(0, 10);
const r1 = await call(A, "POST", "/api/activity", {date: today, type: "run", name: "Run", mi: 5, minutes: 45});
const id = r1.j.activity && r1.j.activity.id; t(!!id, "logged a run");
const g = await call(A, "POST", "/api/gear", {name: "Pegasus 41", start_mi: 120}); t(g.s === 200 && g.j.gear[0].mi === 120, "added shoes with 120 mi on them");
const gid = g.j.id;
const d = await call(A, "PUT", "/api/activity/" + id + "/details", {descr: "Felt smooth.\nNegative split.", tag: "workout", rpe: 7, note: "Calf tight", gear_id: gid, type: "bike"});
t(d.s === 200 && d.j.activity.descr === "Felt smooth.\nNegative split." && d.j.activity.tag === "workout" && d.j.activity.rpe === 7 && d.j.activity.note === "Calf tight" && d.j.activity.gear_id === gid, "saves description (line breaks kept), tag, effort, note and shoes");
t(d.j.activity.type === "bike" && d.j.activity.src_type === "run", "a changed type keeps the original underneath");
t(d.j.gear[0].mi === 125, "the shoes now have 125 mi (120 + this 5 mi run): " + d.j.gear[0].mi);
const me = (await call(A, "GET", "/api/me")).j, a = me.activities.find(x => x.id === id);
t(a && a.descr && a.tag === "workout" && a.note === "Calf tight" && a.type === "bike" && me.gear && me.gear[0].mi === 125, "/api/me returns the edits and the shoes with miles");
t((await call(A, "PUT", "/api/activity/" + id + "/details", {type: "run"})).j.activity.src_type == null, "setting the type back to the original clears the override");
t((await call(A, "PUT", "/api/activity/" + id + "/details", {tag: "party"})).s === 400, "an unknown tag is refused");
t((await call(A, "PUT", "/api/activity/" + id + "/details", {rpe: 11})).s === 400, "effort above 10 is refused");
const gB = (await call(B, "POST", "/api/gear", {name: "B shoes"})).j.id;
t((await call(A, "PUT", "/api/activity/" + id + "/details", {gear_id: gB})).s === 400, "someone else's shoes are refused");
t((await call(B, "PUT", "/api/activity/" + id + "/details", {descr: "hacked"})).s === 404, "someone else can't edit your workout");
const cl = await call(A, "PUT", "/api/activity/" + id + "/details", {descr: "", note: "", tag: null, rpe: null, gear_id: null});
t(cl.s === 200 && cl.j.activity.descr == null && cl.j.activity.note == null && cl.j.activity.tag == null && cl.j.activity.gear_id == null && cl.j.gear[0].mi === 120, "empty values clear each field, and the shoes drop back to 120 mi");
t((await call(A, "PUT", "/api/gear/" + gid, {retired: true})).j.gear[0].retired === true, "shoes can be retired");
const del = await call(A, "DELETE", "/api/account", {password: "edit-test-12345"}); t(del.s === 200, "deleting the account works with shoes on it (" + del.s + ")");
process.exit(bad ? 1 : 0);
