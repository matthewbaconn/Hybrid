// HQ command center check (no network needed): node tests/hq.mjs
// Loads hq/index.html with ?demo (clearly labelled demo data), opens every room on a phone and a desktop,
// and fails on any script error, sideways scrolling, or a private room showing without the owner's key.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const page = 'file://' + fileURLToPath(new URL('../hq/index.html', import.meta.url));
const b = await chromium.launch(), errs = [];
for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
  await p.goto(page + '?demo'); await p.waitForTimeout(700);
  if (!(await p.textContent('#banner')).includes('DEMO')) errs.push(`${name}: demo data must be labelled`);
  if ((await p.locator('#brief .q').count()) !== 7) errs.push(`${name}: the first screen must answer 7 questions`);
  for (const v of ['hq', 'growth', 'team', 'money', 'me']) {
    await p.click(`#nav [data-v="${v}"]`); await p.waitForTimeout(150);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 1) errs.push(`${name} ${v}: scrolls sideways by ${over}px`);
    if (!(await p.isVisible(`#v-${v}`))) errs.push(`${name} ${v}: room did not open`);
  }
  if (!(await p.textContent('#money')).includes('never added to the API number')) errs.push(`${name}: money pools must stay separate`);
  await p.goto(page); await p.waitForTimeout(900);          // no key: private rooms stay locked, nothing invented
  for (const v of ['growth', 'money', 'me']) { await p.click(`#nav [data-v="${v}"]`);
    if (!(await p.textContent(`#${v}`)).includes('private')) errs.push(`${name}: ${v} must be locked without the key`); }
  // the paste-to-unlock box: a wrong paste is refused, a well-formed key is stored (it can't open the real office here, and says so)
  await p.click('#nav [data-v="growth"]');
  await p.fill('#growth .ukey', 'hello'); await p.click('#growth .ugo');
  if (!(await p.textContent('#growth .umsg')).includes("doesn't look like")) errs.push(`${name}: a bad paste must be refused`);
  await p.fill('#growth .ukey', 'https://app.hybrdrunning.com/hq/#k=' + 'A'.repeat(43)); await p.click('#growth .ugo'); await p.waitForTimeout(1500);
  if ((await p.evaluate(() => localStorage.getItem('hq-k'))) !== 'A'.repeat(43)) errs.push(`${name}: a pasted link must store its key on this device`);
  if (!(await p.textContent('#growth')).includes('private')) errs.push(`${name}: a wrong key must leave the room locked`);
  await p.close();
}
await b.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log('HQ OK: 5 rooms, phone + desktop, private rooms locked without the key');
