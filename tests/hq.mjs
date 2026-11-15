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
// opening the private link: the install manifest starts from the link (so a home-screen app opens unlocked);
// on a desktop the key leaves the address bar, in iPhone Safari it stays so "Add to Home Screen" keeps it
const KEY = 'B'.repeat(43);
for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }],
                            ['iphone', { viewport: { width: 390, height: 844 }, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }]]) {
  const ctx = await b.newContext(opts), p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${name} link: ${e.message}`));
  await p.goto(page + '#k=' + KEY); await p.waitForTimeout(600);
  const href = await p.getAttribute('#mf', 'href');
  let mf = null; try { mf = JSON.parse(decodeURIComponent(href.replace(/^data:application\/manifest\+json,/, ''))); } catch (e) {}
  if (!mf || !mf.start_url.endsWith('#k=' + KEY)) errs.push(`${name}: the home-screen manifest must start from the private link`);
  if (mf && !/icon-192\.png$/.test(mf.icons[0].src)) errs.push(`${name}: manifest icons must resolve`);
  if ((await p.evaluate(() => localStorage.getItem('hq-k'))) !== KEY) errs.push(`${name}: the link must store its key`);
  const hash = await p.evaluate(() => location.hash);
  if (name === 'desktop' && hash) errs.push('desktop: the key must leave the address bar');
  if (name === 'iphone' && hash !== '#k=' + KEY) errs.push('iphone: the key must stay in the address for Add to Home Screen');
  if (name === 'iphone' && !(await p.textContent('#install')).includes('opens unlocked')) errs.push('iphone: install tip must say it opens unlocked');
  await p.goto(page); await p.waitForTimeout(400);       // reopening without the link still installs unlocked
  if (!(decodeURIComponent(await p.getAttribute('#mf', 'href'))).includes('#k=' + KEY)) errs.push(`${name}: a stored key must still go into the install manifest`);
  if (name === 'iphone' && (await p.evaluate(() => location.hash)) !== '#k=' + KEY) errs.push('iphone: a stored key must come back into the address');
  await ctx.close();
}
// without a key, the plain manifest is untouched
{ const p = await b.newPage(); await p.goto(page); if ((await p.getAttribute('#mf', 'href')) !== 'manifest.webmanifest') errs.push('no key: manifest must stay plain'); await p.close(); }
await b.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log('HQ OK: 5 rooms, phone + desktop, private rooms locked without the key, private link installs unlocked');
