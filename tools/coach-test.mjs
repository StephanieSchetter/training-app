// Checks the coach features on screen, using Brad's real 8 and 12 October easy runs: the questions asked
// when a run is finished, the debrief, the heart-rate-rise easy-pace rule, logging "I slowed down", and
// the weekly review. Usage: node tools/coach-test.mjs [output-folder]   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`); };
const on = async date => { await page.goto(`http://localhost:5173/?local&nocatchup&today=${date}`, { waitUntil: 'networkidle0' }); await wait(250); };
const text = () => page.evaluate(() => document.body.innerText);
const shot = async name => { if (out) { await wait(300); await page.screenshot({ path: join(out, `coach-${name}.png`), fullPage: true }); } };
const click = async (label, nth = 0) => {
  const ok = await page.evaluate((label, nth) => {
    const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth];
    if (!b) return false;
    b.click();
    return true;
  }, label, nth);
  if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 300)}`);
  await wait(200);
};
const state = fn => page.evaluate(fn);

await on('2026-10-12');
// A month of ordinary mornings, a good one today, the baseline run, and what the watch recorded for both runs.
await page.evaluate(() => window.__dev.update(s => {
  for (let i = 1; i <= 30; i++) {
    const d = new Date('2026-10-12T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i); const date = d.toISOString().slice(0, 10);
    s.garminDays[date] = { date, restingHr: 46, hrv: 38, sleepHours: 7.4, sleepScore: 80, readiness: 80, trainingLoad: null };
  }
  s.garminDays['2026-10-12'] = { date: '2026-10-12', restingHr: 45, hrv: 54, sleepHours: 8.35, sleepScore: 98, readiness: 97, trainingLoad: null };
  const laps = rows => rows.map(([sec, avgHr]) => ({ sec, km: 1, avgHr }));
  s.garminActs.push({ id: 1, type: 'run', startLocal: '2026-10-08 06:30:00', date: '2026-10-08', durationSec: 1801, avgHr: 145, maxHr: 161, trainingLoad: 70, distanceKm: 5.17, laps: laps([124, 136, 140, 142, 145, 148, 153, 157, 157].map(h => [200, h])) });
  s.garminActs.push({ id: 2, type: 'run', startLocal: '2026-10-12 06:50:07', date: '2026-10-12', durationSec: 2103, avgHr: 141, maxHr: 160, trainingLoad: 81, distanceKm: 5.78, laps: laps([[386, 121], [361, 139], [363, 143], [363, 146], [363, 150], [267, 154]]) });
  s.garminActs.push({ id: 3, type: 'run', startLocal: '2026-10-12 07:25:49', date: '2026-10-12', durationSec: 361, avgHr: 161, maxHr: 174, trainingLoad: 42, distanceKm: 1.05, laps: laps([[346, 161], [15, 172]]) });
  const at = Date.parse('2026-10-08T06:30:00');
  s.runs.push({ id: 'baseline-2026-10-08', slotIdx: null, type: 'easy', date: '2026-10-08', week: 1, title: 'Easy Run', startedAt: at, finishedAt: at + 1800000, segs: [{ section: 'Main run', text: '30 min at 10 km/h', work: true, prescribed: 10, actual: 10, km: 5, done: true }] });
}));

// Today's easy run, through the screens
await click('Open Easy Run'); await click('Start this run');
await click('Done'); await click('Done'); await click('Finish run');
let t = await text();
check('Finishing an easy run asks about conditions and slowing down', /how warm was it\?/i.test(t) && /fan or breeze\?/i.test(t) && /did you slow down part-way/i.test(t));
await shot('finish-questions');
await click('Warm'); await click('Yes', 0); await click('Save and finish');
check('The answers are stored on the run', await state(() => { const r = window.__dev.getState().runs.at(-1); return r.conditions === 'warm' && r.fan === true && r.slowedTo === undefined && !!r.finishedAt; }));

t = await text();
check('Home shows the coach\'s read of the run', /coach's read/i.test(t) && t.includes("Started easy, didn't stay easy"), t.split(/COACH'S READ/i)[1]);
check('It read the 35-minute run, not the strides', t.includes('Average 141 bpm at 10 km/h') && !t.includes('Average 161'));
check('Two easy runs with rising heart rate suggest easing back, before any time trial', t.includes('Ease your next easy run back to 9.8 km/h') && t.includes('last two easy runs at 10 km/h averaged 145, 141 bpm') && t.includes('kept climbing'), t.split(/SUGGESTION · EASY PACE/i)[1]);
await shot('home');

await click('See the full read');
t = await text();
check('Full read: the rise, first half to second', t.includes('from about 142 in the first half to 150 in the second') && t.includes('finishing around 151'), t.split(/COACH'S READ/i)[1]);
check('Full read: compared with the last run at this speed', t.includes('Last time at this speed (8 Oct): average 145') && t.includes('4 beats lower today'));
check('Full read: that morning against normal', t.includes('resting heart rate 45 (your normal is 46)') && t.includes('HRV 54 (normal 38)') && t.includes('You were recovered'));
check('Full read: conditions and what to do next', t.includes('Conditions: warm, with a fan or breeze') && t.includes('keep your heart rate under 150'));
check('Garmin card shows the run\'s own numbers', /Average HR\s*141/i.test(t));
await shot('full-read');
await click('Back');

await click('Use 9.8');
t = await text();
check('Accepting moves upcoming easy runs to 9.8', /Easy Run\s*40 min at 9\.8 km\/h/.test(t) && !/suggestion · easy pace/i.test(t), t.split('COMING UP')[1]);

// Next Monday: slowing down part-way is logged at the finish
await on('2026-10-19');
await click('Open Easy Run'); await click('Start this run');
check('The run starts at the accepted speed', (await text()).includes('40 min at 9.8 km/h'));
await click('Done'); await click('Done'); await click('Finish run');
await click('Yes', 1);
t = await text();
check('Ticking "slowed down" asks what speed, pre-filled 0.4 lower', /Slowed to/i.test(t) && t.includes('9.4'));
await click('Less Slowed to');
await shot('slowed');
await click('Save and finish');
check('The slower speed is stored; the logged speed stays the one started at', await state(() => { const r = window.__dev.getState().runs.at(-1); return r.slowedTo === 9.3 && r.segs[0].actual === 9.8; }));
await page.evaluate(() => window.__dev.update(s => { s.garminActs.push({ id: 4, type: 'run', startLocal: '2026-10-19 06:40:00', date: '2026-10-19', durationSec: 2400, avgHr: 140, maxHr: 152, trainingLoad: 80, distanceKm: 6.4, laps: [] }); }));
await wait(300);
t = await text();
check('The read says slowing was right', t.includes('Slowed down to keep it easy'), t.split(/COACH'S READ/i)[1]);

// Sunday of week 1: the weekly review
await on('2026-10-18');
t = await text();
check('Sunday shows the week\'s review on the home screen', /WEEK 1 REVIEW/i.test(t) && t.includes('Sessions: 1 of 7 done') && t.includes('Mobility: 0 evenings, target 4–5'), t.split(/WEEK 1 REVIEW/i)[1]);
check('It names the one thing to focus on', t.includes('Consistency first'));
check('It reports running and the easy run that drifted', t.includes('Running: 6.9 km.') && t.includes("1 of 1 easy runs didn't stay easy"));
await shot('weekly-review');
await on('2026-10-15');
check('No weekly review on the home screen mid-week', !/WEEK 1 REVIEW/i.test(await text()));
await click('Progress');
check('Progress always shows the current week so far', /WEEK 1 REVIEW/i.test(await text()) && (await text()).includes('so far'));

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} coach checks passed` : `\n${results.filter(x => !x).length} of ${results.length} coach checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
