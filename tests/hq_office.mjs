// HQ Office tab check (no network): node tests/hq_office.mjs
// Opens hq/next with demo data, goes to Office, and checks: the canvas is painted, working roles sit at their desks,
// idle roles stand in the break area, a run over 2 hours is flagged in the "Working now" strip, a score shows when present,
// nothing scrolls sideways and no script errors.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const page = 'file://' + fileURLToPath(new URL('../hq/next/index.html', import.meta.url));
const b = await chromium.launch(), errs = [];
for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
  await p.goto(page + '?demo'); await p.waitForTimeout(600);
  await p.click('#nav [data-v="office"]'); await p.waitForTimeout(300);
  if (!(await p.isVisible('#v-office'))) errs.push(`${name}: Office did not open`);
  const r = await p.evaluate(() => {
    const iso = m => new Date(Date.now() - m * 60000).toISOString().slice(0, 19) + 'Z';
    rows['product-lead'] = ['product-lead', 'w', iso(150), '', 1];   // running 2.5 h: must be flagged
    rows['worker'] = ['worker', 'w', iso(10), '', 1];               // running 10 min: fine
    rows['audit'] = ['audit', 'i', iso(300), '', 1];                // idle: break area
    for (const a of agents) a.code = a.id === 'vesper' ? 'v' : (rows[a.id] ? rows[a.id][1] : 'n');
    PRIV = Object.assign({}, PRIV || {}, { d: [{ id: 'worker', score: 7 }] });
    renderOffice();
    const crowd = officeCrowd(), by = id => crowd.find(a => a.id === id);
    const brk = ROOMS.brk, inBrk = a => a.x >= brk.x && a.x <= brk.x + brk.w && a.y >= brk.y && a.y <= brk.y + brk.h;
    const c = document.getElementById('cv2'), px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0; for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
    return { strip: document.getElementById('wnow').innerText, late: document.querySelectorAll('#wnow .late').length, scores: document.getElementById('ofscores').innerText,
      workerDesk: by('worker').x === TEAM.worker.desk[0], auditBreak: inBrk(by('audit')), painted: lit > 50, over: document.documentElement.scrollWidth - innerWidth };
  });
  if (r.late !== 1 || !/over 2 h/.test(r.strip)) errs.push(`${name}: a run over 2 hours must be flagged exactly once (${r.late}) ${r.strip}`);
  if (!r.workerDesk) errs.push(`${name}: a working role must sit at its desk`);
  if (!r.auditBreak) errs.push(`${name}: an idle role must stand in the break area`);
  if (!/last self-score 7\/10/.test(r.scores)) errs.push(`${name}: a published score must show`);
  if (!r.painted) errs.push(`${name}: the office canvas is blank`);
  if (r.over > 1) errs.push(`${name}: scrolls sideways by ${r.over}px`);
  await p.close();
}
await b.close();
if (errs.length) { console.error('HQ OFFICE FAIL\n' + errs.join('\n')); process.exit(1); }
console.log('HQ Office OK: working at desks, idle in the break area, over-2h run flagged, scores shown, phone + desktop');
