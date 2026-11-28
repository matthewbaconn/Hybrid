// HQ Growth loop panel (Nov 27, 2026), no network: node tests/hq_loop.mjs
// Loads HQ's ui.js and checks vLoop(): hidden until Vesper's feed carries M.P.loop; then today's moves, the week vs the
// quota, wins and flops, the stalled count and how members heard of Mileset; text is escaped; it leads the Growth tab.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const page = 'file://' + fileURLToPath(new URL('../hq/index.html', import.meta.url));
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), errs = [];
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.route(/^https?:/, r => r.abort());
await p.goto(page); await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  if (typeof HQ === 'undefined' || !HQ.test) return { missing: true };
  const vLoop = HQ.test.vLoop, vGrowth = HQ.test.vGrowth;
  HQ.S.priv = Object.assign({}, HQ.S.priv || {}); delete HQ.S.priv.loop; const none = vLoop();
  HQ.S.priv.loop = { moves: [{ id: 'a1b2c3d4', worker: 'retention', move: 'launch the Day-1 nudge <b>now</b>', tag: 'x-retention-1127-a1b2' }],
    week: { logged: 2, quota: 5, behind: 3 }, won: [{ action: 'reel: complaint hook', tag: 'ig_c1', signed_up: 3, trained: 1 }],
    flopped: [{ action: 'club pitch', tag: 'club_x', signed_up: 0, trained: 0 }], measuring: 4, stalled: 2, heard: [['instagram', 6], ['friend', 4]] };
  const h = vLoop(), g = vGrowth();
  return { none, h, leads: g.indexOf('<section') === g.indexOf('<section class="card glass wide" id="c-loop"') && g.indexOf('c-loop') < g.indexOf('c-gctl') };
});
if (r.missing) errs.push('HQ.test hook not found in hq/ui.js');
else {
  if (r.none !== '') errs.push('panel must be hidden without M.P.loop');
  for (const want of ['Growth loop', '2 of 5', '3 to go', 'Still measuring', '>4<', 'Stalled new members', '>2<', 'launch the Day-1 nudge', 'x-retention-1127-a1b2', 'Won', 'reel: complaint hook', '3 signed up · 1 trained', 'Flopped', 'club pitch', 'instagram 6 · friend 4'])
    if (!r.h.includes(want)) errs.push('missing: ' + want);
  if (r.h.includes('<b>now</b>')) errs.push('move text must be escaped');
  if (!r.leads) errs.push('the loop panel must lead the Growth tab');
}
await b.close();
if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
console.log('ok   HQ Growth loop panel: hidden until fed; moves, quota, wins/flops, stalled count, how-heard; escaped; leads the Growth tab'); 
