// Drives the run screens across several pretend dates and checks the speed rules on screen
// (spec scenarios 10 and 11). Usage: node tools/run-test.mjs <output-folder>   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));

const wait = ms => new Promise(r => setTimeout(r, ms));
const on = async date => { await page.goto(`http://localhost:5173/?local&practice&nocatchup&today=${date}`, { waitUntil: 'networkidle0' }); await wait(200); };
const text = () => page.evaluate(() => document.body.innerText);
const shot = name => wait(300).then(() => page.screenshot({ path: join(out, `run-${name}.png`) }));
const click = async (label, nth = 0) => {
  const ok = await page.evaluate((label, nth) => {
    const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth];
    if (!b) return false;
    b.click();
    return true;
  }, label, nth);
  if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 300)}`);
  await wait(120);
};
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const summaryOf = async label => (await text()).split('\n').find(l => l.includes(label)) ?? '';

async function doIntervals(date, answer, { skipLast = false } = {}) {
  await on(date);
  await click('Open Intervals'); await click('Start this run');
  if (date === '2026-10-14') await shot('first-rep');
  let n = await page.evaluate(() => document.querySelectorAll('.segs > *').length);
  if (skipLast) n -= 3;
  for (let i = 0; i < n; i++) await click('Done');
  await click(skipLast ? 'End' : 'One question');
  if (date === '2026-10-14') await shot('question');
  await click(answer);
}

// Practice run before the block: answering "Yes" must change nothing
await on('2026-10-07');
await click('Intervals', 1);
for (let i = 0; i < 12; i++) await click('Done');
await click('One question');
await click('Yes');
const afterPractice = await text();
check('Practice intervals can be run before the block', afterPractice.includes('Delete practice data'));
check('Practice "Yes" does not change speeds', afterPractice.includes('at 13.8 km/h') && !afterPractice.includes('14.1'));

// Week 1: yes -> +0.3
await doIntervals('2026-10-14', 'Yes');
await on('2026-10-15');
check('10a: "Yes" puts next week\'s intervals up 0.3', (await summaryOf('× 1 km at')).includes('14.1 km/h'), await summaryOf('× 1 km at'));

// Week 2: couldn't finish -> same speed
await doIntervals('2026-10-21', "Couldn't finish", { skipLast: true });
await on('2026-10-22');
check('10b: one "couldn\'t finish" keeps the speed', (await summaryOf('× 1.2 km at')).includes('14.1 km/h'), await summaryOf('× 1.2 km at'));
check('10b: no alert after one', !(await text()).includes('slipped two sessions'));

// Week 3: couldn't finish again -> -0.3 and the Gym B alert
await doIntervals('2026-10-28', "Couldn't finish", { skipLast: true });
await on('2026-10-29');
const home = await text();
check('10c: second "couldn\'t finish" raises the alert', home.includes('slipped two sessions'));
await shot('alert');
await click('Skip Gym B');
check('10c: accepting removes the next Gym B', !(await text()).split('COMING UP')[1].split('PRACTICE')[0].includes('Gym B'));

// Week 4: time trial 21:00
await on('2026-11-04');
check('10c: speed dropped 0.3 for the following week', true, 'checked through the time-trial "was" value below');
await click('Open Intervals'); await click('Enter my time');
await click('Less Minutes');
for (let i = 0; i < 30; i++) await click('Less Seconds');
const tt = await text();
await shot('time-trial');
check('11: time trial 21:00 averages 14.29 km/h', tt.includes('14.29 km/h'));
check('11: intervals was 13.8 (after the -0.3), now 14.8', /Intervals\s*14\.8\s*was 13\.8/.test(tt), tt.split('NEW SPEEDS')[1]?.replace(/\n/g, ' ').slice(0, 120));
check('11: threshold 13.5', /Threshold\s*13\.5/.test(tt));
check('11: strides up by the same 1.0 -> 16.5', /Strides\s*16\.5/.test(tt));
await click('Confirm new speeds');
await on('2026-11-05');
check('11: next intervals use 14.8', (await text()).includes('at 14.8 km/h'));

await browser.close();
console.log(results.every(Boolean) ? '\nAll run checks passed' : '\nSome run checks FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
