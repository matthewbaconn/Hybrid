// Source question (Nov 18): owner-only preview; asked once to members with no ?src= tag; one answer, never overwrites src.
// Needs a local API: cd api && npx wrangler d1 migrations apply hybrid --local && npx wrangler dev --port 8787
const API = process.env.API || "http://localhost:8787"; let bad = 0;
const t = (ok, name) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad++; };
const call = async (method, path, token, data) => { const r = await fetch(API + path, {method, headers: {"content-type": "application/json", ...(token ? {Authorization: "Bearer " + token} : {})}, body: data ? JSON.stringify(data) : undefined}); return {status: r.status, j: await r.json().catch(() => ({}))}; };
const signup = async (email, q = "") => (await call("POST", "/api/signup" + q, null, {email, password: "password123", name: "Test", agree: true})).j.token;
const id = Date.now().toString(36);
const owner = await signup(`owner-${id}@test.dev`);   // the oldest real account on a fresh local DB is the owner
const member = await signup(`m-${id}@test.dev`);
let me = (await call("GET", "/api/me", owner)).j;
if (!me.owner) console.log("(owner is an older account on this local DB: owner-only checks need a fresh local DB)");
else {
  t(me.features && me.features.source === true, "owner (no source tag) is asked");
  t((await call("POST", "/api/account/source", owner, {answer: "nonsense"})).status === 400, "only the listed answers are accepted");
  t((await call("POST", "/api/account/source", owner, {answer: "instagram"})).status === 200, "answer saved");
  t((await call("GET", "/api/me", owner)).j.features.source === false, "asked once: not again after answering");
}
t((await call("GET", "/api/me", member)).j.features.source === false, "members don't see it while it's in preview");
t((await call("POST", "/api/account/source", member, {answer: "friend"})).status === 404, "and the endpoint refuses them");
process.exit(bad ? 1 : 0);
