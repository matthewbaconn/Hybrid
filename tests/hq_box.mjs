// HQ mailbox (api/worker.js /api/hq/box/<box>): API=http://localhost:8787 node tests/hq_box.mjs   (needs the local API running)
// The Worker stores opaque envelopes it cannot read: it has no key. Checks: a round trip both ways with a throwaway key,
// "state" keeps one row, bad input is refused, another mailbox sees nothing, and no route leaks rows without the box id.
import crypto from "node:crypto";
const API = process.env.API || "http://localhost:8787", errs = []; let n = 0;
const check = (c, what) => { n++; if (!c){ errs.push(what); console.log("FAIL " + what); } };
const KEY = crypto.randomBytes(32), box = k => crypto.createHash("sha256").update("mileset-hq-box-v1:" + k.toString("base64url")).digest("hex"), BOX = box(KEY), OTHER = box(crypto.randomBytes(32));
const seal = (obj, aad, key = KEY) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv); c.setAAD(Buffer.from(aad));
  return {iv: iv.toString("base64url"), ct: Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]).toString("base64url")}; };
const open = (e, aad) => { const b = Buffer.from(e.ct, "base64url"), d = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(e.iv, "base64url")); d.setAAD(Buffer.from(aad)); d.setAuthTag(b.subarray(b.length - 16)); return JSON.parse(Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()])); };
const post = (b, body) => fetch(`${API}/api/hq/box/${b}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
const get = async (b, q = "") => (await fetch(`${API}/api/hq/box/${b}${q}`)).json();
const cmd = {id: "c1", ts: Date.now(), t: "ship", n: 119};
let r = await post(BOX, {d: "in", ...seal(cmd, "mileset-hq-cmd-v1")}); check(r.status === 200 && (await r.json()).id > 0, "HQ can post a sealed command");
let rows = (await get(BOX, "?d=in")).rows; check(rows.length === 1 && open(rows[0], "mileset-hq-cmd-v1").n === 119, "Vesper's server reads it back and only the key opens it");
check(!JSON.stringify(rows).includes("ship") && !JSON.stringify(rows).includes("119"), "the stored row shows nothing readable");
check((await get(BOX)).rows.length === 0, "HQ's own poll doesn't get commands back, only confirmations and state");
await post(BOX, {d: "out", ...seal({id: "c1", ok: true, say: "Approved"}, "mileset-hq-ack-v1")});
await post(BOX, {d: "state", ...seal({v: 1, t: "a"}, "mileset-hq-v1")}); await post(BOX, {d: "state", ...seal({v: 1, t: "b"}, "mileset-hq-v1")});
rows = (await get(BOX)).rows; check(rows.filter(x => x.d === "out").length === 1 && open(rows.find(x => x.d === "out"), "mileset-hq-ack-v1").say === "Approved", "the confirmation comes back to HQ");
check(rows.filter(x => x.d === "state").length === 1 && open(rows.find(x => x.d === "state"), "mileset-hq-v1").t === "b", "only the newest state is kept");
check((await get(BOX, "?since=" + Math.max(...rows.map(x => x.id)))).rows.length === 0, "since= returns only newer rows");
check((await get(OTHER)).rows.length === 0 && (await get(OTHER, "?d=in")).rows.length === 0, "a different key's mailbox sees nothing");
let bad = false; try { open((await get(BOX)).rows.find(x => x.d === "out"), "mileset-hq-cmd-v1"); } catch(e){ bad = true; } check(bad, "a confirmation can't be replayed as a command (different seal)");
for (const [b, why] of [[{d: "x", ...seal(cmd, "a")}, "unknown kind"], [{d: "in", iv: "short", ct: "A".repeat(40)}, "bad iv"], [{d: "in", iv: "A".repeat(16), ct: "A".repeat(9000)}, "oversized command"], [{d: "in"}, "empty"]])
  check((await post(BOX, b)).status === 400, "refused: " + why);
check((await fetch(`${API}/api/hq/box/nothex`)).status >= 400 && (await fetch(`${API}/api/hq/box/`)).status >= 400, "no listing without a mailbox id");
// Nov 20 command tiers: command ids make retries safe, and the sealed telemetry heartbeat has its own read endpoint.
const CID = crypto.randomUUID(), env1 = seal({command_id: CID, ts: Date.now(), t: "read", q: "spend"}, "mileset-hq-cmd-v1");
const r1 = await (await post(BOX, {d: "in", cid: CID, ...env1})).json(), r2 = await (await post(BOX, {d: "in", cid: CID, ...seal({command_id: CID, t: "x"}, "mileset-hq-cmd-v1")})).json();
check(r1.id > 0 && r2.id === r1.id && r2.dup === true, "a retried command (same command id) is not stored twice");
check((await get(BOX, "?d=in")).rows.filter(x => x.cid === CID).length === 1, "only one row exists for that command id");
const s1 = await (await post(BOX, {d: "out", cid: CID + ":1", ...seal({command_id: CID, status: "running"}, "mileset-hq-ack-v1")})).json(),
      s2 = await (await post(BOX, {d: "out", cid: CID + ":2", ...seal({command_id: CID, status: "completed"}, "mileset-hq-ack-v1")})).json(),
      s1b = await (await post(BOX, {d: "out", cid: CID + ":1", ...seal({command_id: CID, status: "running"}, "mileset-hq-ack-v1")})).json();
check(s2.id > s1.id && s1b.id === s1.id && s1b.dup, "each status update is stored once, in order");
for (const [bb, why] of [[{d: "in", cid: "not-a-uuid", ...seal({}, "a")}, "a command id that isn't a UUID"], [{d: "state", cid: crypto.randomUUID(), ...seal({}, "a")}, "a command id on a state row"]])
  check((await post(BOX, bb)).status === 400, "refused: " + why);
let t0 = await (await fetch(`${API}/api/hq/tel/${BOX}`)).json(); check(t0.tel === null && t0.now, "telemetry endpoint answers even before the first heartbeat");
await post(BOX, {d: "tel", ...seal({at: 1}, "mileset-hq-tel-v1")}); await post(BOX, {d: "tel", ...seal({at: 2}, "mileset-hq-tel-v1")});
const t1 = (await (await fetch(`${API}/api/hq/tel/${BOX}`)).json()).tel;
check(t1 && open(t1, "mileset-hq-tel-v1").at === 2, "telemetry endpoint returns only the newest sealed heartbeat");
check((await (await fetch(`${API}/api/hq/tel/${OTHER}`)).json()).tel === null, "another key's telemetry is empty");
console.log(`hq mailbox: ${n - errs.length} of ${n} checks pass`); if (errs.length) process.exit(1);
