// Checks the changes from the first gym review (13 Oct 2026): a weight agreed at a review replaces the
// suggestion once, per-side machines are labelled, and the knee-raise guidance shows.
// Usage: node tools/review-test.mjs   (dev server running)
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
// Previews list ramp-up sets under each lift (14 Oct 2026); these checks read the working weights, so drop those lines.
const text = () => page.evaluate(() => document.body.innerText.replace(/\nWarm-up sets: [^\n]*/g, ''));
const shot = async name => { if (out) { await wait(300); await page.screenshot({ path: join(out, `stack-${name}.png`) }); } };
const click = async (label, nth = 0) => {
  const ok = await page.evaluate((label, nth) => {
    const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth];
    if (!b) return false;
    b.click();
    return true;
  }, label, nth);
  if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 300)}`);
  await wait(150);
};
const on = async date => { await page.goto(`http://localhost:5173/?local&nocatchup&today=${date}`, { waitUntil: 'networkidle0' }); await wait(250); };
const line = async name => (await text()).split('\n').reduce((acc, l, i, all) => (l.startsWith(name) ? all.slice(i, i + 4).join(' | ') : acc), '');
// What Brad logged on Tuesday 13 Oct at Port Hedland, as far as these checks need it
const seed = (id, daysAgo, date, rows) => page.evaluate((id, daysAgo, date, rows) => window.__dev.update(s => {
  const at = Date.now() - daysAgo * 86400000;
  s.sessions.push({ id, slotIdx: null, type: 'gymB', date, gymId: 'fifo', week: 1, swaps: { cs_row: 'iso_row', standing_calf: 'sl_calf_step_db' }, warmup: [], startedAt: at, finishedAt: at + 4800000 });
  rows.forEach(([exId, setNo, weight, reps, side], i) => s.sets.push({ id: `${id}-${i}`, sessionId: id, exId, plannedExId: exId, setNo, side, weight, reps, rir: 0, suggestedWeight: null, suggestedReps: reps, ts: at + i }));
  const g = s.profiles.find(p => p.id === 'fifo'); g.machineSteps = { iso_row: 2.5, leg_extension: 2.5 }; g.smallestPlate = 1.25;
}), id, daysAgo, date, rows);

await on('2026-10-20');
await seed('oct13', 20, '2026-10-13', [
  ['leg_extension', 1, 70, 12], ['leg_extension', 2, 70, 10], ['leg_extension', 3, 70, 8], ['leg_extension', 4, 70, 8],
  ['sl_calf_step_db', 1, 10, 12, 'L'], ['sl_calf_step_db', 1, 10, 12, 'R'], ['sl_calf_step_db', 2, 5, 12, 'L'], ['sl_calf_step_db', 2, 5, 12, 'R'], ['sl_calf_step_db', 3, 5, 12, 'L'], ['sl_calf_step_db', 3, 5, 12, 'R'],
  ['iso_row', 1, 50, 8], ['iso_row', 2, 45, 10], ['iso_row', 3, 40, 11],
]);
await wait(300);
await click('Gym B');
check('Next Tuesday: leg extension is the weight agreed at the latest review (57.5, 20 Oct), not 70', (await line('Leg Extension')).includes('57.5 kg'), await line('Leg Extension'));
check('Next Tuesday at FIFO: calf raise is on the leg press, at the agreed 120 kg', (await line('A1Leg Press Calf Raise')).includes('120 kg'), await line('A1Leg Press Calf Raise'));
check('Lifts with nothing agreed are untouched (row stays 50 kg)', (await line('Iso-Lateral Row')).includes('50 kg'), await line('Iso-Lateral Row'));
await click('Back');
await click('Start Gym B'); await click('Start warm-up'); await click('Start lifting');
for (let i = 0; i < 3; i++) await click('Next exercise');
let t = await text();
check('The row is labelled as weight on one side', /Iso-Lateral Row/i.test(t) && /kg each side/i.test(t), t.slice(0, 200));
for (let i = 0; i < 2; i++) await click('Next exercise');
await click('Skip warm-up sets');   // warm-up sets come first since 15 Oct
t = await text();
check('On the day it says where the weight came from', /Leg Extension/i.test(t) && t.includes('57.5 kg') && t.includes('Agreed at your review on 20 Oct'), t.slice(0, 260));
for (let i = 0; i < 2; i++) await click('Next exercise');
t = await text();
check('Knee raises: log controlled hanging reps, top up, dead hang afterwards', /Hanging Knee Raise/i.test(t) && t.includes('top each set up to 10 with lying knee raises') && t.includes('after the last set'), t.slice(0, 300));

// Once the lift has been done after the review, normal progression takes over
await page.evaluate(() => window.__dev.update(s => { const id = s.activeSessionId; s.sessions = s.sessions.filter(x => x.id !== id); s.activeSessionId = null; }));
await seed('oct20', 10, '2026-10-21', [['leg_extension', 1, 65, 12], ['leg_extension', 2, 65, 11], ['leg_extension', 3, 65, 10], ['leg_extension', 4, 65, 10]]);
await page.evaluate(() => window.__dev.update(s => { s.stints.push({ location: 'Port Hedland', start: '2026-11-23', end: '2026-12-06', gym: 'fifo' }); }));   // the second stint is added in the app, not the program file
await on('2026-11-24');
await click('Gym B');
check('Back at Port Hedland in November: 65 kg done well moves to 67.5, the agreed weight no longer applies', (await line('Leg Extension')).includes('67.5 kg'), await line('Leg Extension'));

// 14 Oct: a clear way to stop mid-rep, and a three-way morning check
await page.evaluate(() => window.__dev.update(s => { s.activeSessionId = null; s.activeRunId = null; }));
await on('2026-10-21');
await click('Open Intervals'); await click('Start this run');
await click('Done'); await click('Done');   // warm-up
t = await text();
check('During a rep there is an obvious way to stop', t.includes("Can't finish this rep? End the run here"));
await click("Can't finish this rep?");
t = await text();
check('Stopping early asks only the right question', t.includes('Ending the run early') && t.includes("Couldn't finish all reps") && !t.includes('Yes, could have'), t.slice(-400));
await click("Couldn't finish all reps");
check('It is recorded as not finished', await page.evaluate(() => { const r = window.__dev.getState().runs.at(-1); return r.answer === 'dnf' && !!r.finishedAt && r.segs.filter(x => x.work && x.done).length === 0; }));
await page.evaluate(() => window.__dev.update(s => { const at = Date.now() - 3600000; s.sessions.push({ id: 'gymc-check', slotIdx: null, type: 'gymC', date: '2026-10-22', gymId: 'adelaide', week: 2, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 }); }));
await on('2026-10-23');
t = await text();
check('The morning check offers Normal, Stiff and Worse, and explains them', /MORNING CHECK-IN/i.test(t) && t.includes('Normal') && t.includes('Stiff') && t.includes('the usual tightness after training'), t.split(/MORNING CHECK-IN/i)[1]?.slice(0, 300));
await click('Stiff', 1);
await click('Save check-in');
t = await text();
check('"Stiff" is saved and changes nothing: no hold, no offers', (await page.evaluate(() => window.__dev.getState().checkins.at(-1).back)) === 'stiff' && !/SUGGESTION · /i.test(t));

// 17 Oct: ending during the last rep after finishing it is not "couldn't finish"
await page.evaluate(() => window.__dev.update(s => { s.activeSessionId = null; s.activeRunId = null; }));
await on('2026-10-24');
await click('Open Threshold'); await click('Start this run');
for (let i = 0; i < 6; i++) await click('Done');   // warm-up 2, rep 1, recovery, rep 2, recovery
await click("Can't finish this rep?");
await click('I finished this rep');
t = await text();
check('"I finished this rep" ticks it and asks the usual question', /could you have done 2 more reps/i.test(t), t.slice(-300));
await click('No');
check('Saved as all reps done with the real answer, cool-down skipped', await page.evaluate(() => { const r = window.__dev.getState().runs.at(-1); return r.answer === 'no' && r.segs.filter(x => x.work).every(x => x.done) && !r.segs.at(-1).done; }));

// 23 Oct: a rest day taken on purpose skips today's session and moves nothing else
await page.evaluate(() => window.__dev.update(s => { s.activeSessionId = null; s.activeRunId = null; }));
await on('2026-10-23');
await click('Take a rest day instead');
await click('Skip it');
check('Rest day: today\'s Gym A is skipped, Saturday and Sunday stay put', await page.evaluate(() => { const sc = window.__dev.getState().schedule; const on = d => sc.filter(x => x.date === d && !x.skipped).map(x => x.type).join(); return sc.find(x => x.date === '2026-10-23').skipped === true && on('2026-10-24') === 'threshold' && on('2026-10-25') === 'gymD'; }));

// 15 Oct: back-off sets never drop below what was already done for their reps
const backoffs = await page.evaluate(async () => {
  const pl = await import('/src/plan.ts');
  const s = structuredClone(window.__dev.getState());
  const at = Date.now() - 86400000;
  s.profiles.find(p => p.id === 'fifo').machineSteps = { ...s.profiles.find(p => p.id === 'fifo').machineSteps, lat_pulldown: 2.5 };
  s.sessions.push({ id: 'c15', slotIdx: null, type: 'gymC', date: '2026-10-15', gymId: 'fifo', week: 1, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
  [[1, 65, 8], [2, 60, 10], [3, 55, 12]].forEach(([setNo, weight, reps]) => s.sets.push({ id: `lp${setNo}`, sessionId: 'c15', exId: 'lat_pulldown', plannedExId: 'lat_pulldown', setNo, weight, reps, rir: 1, suggestedWeight: null, suggestedReps: reps, ts: at + setNo }));
  const next = { id: 'x', slotIdx: null, type: 'gymC', date: '2026-10-22', gymId: 'fifo', week: 2, swaps: {}, warmup: [], startedAt: Date.now() };
  return pl.buildPlan(s, next).find(p => p.ex === 'lat_pulldown').targets.map(t => `${t.weight}x${t.reps}`).join(' ');
});
check('Lat pulldown next week: top 65 for 9, and the back-off sets stay at 60 and 55 (not 57.5 and 52.5)', backoffs === '65x9 60x10 55x12', backoffs);

// 18 Oct: weighted dips as a reverse pyramid from 10 kg; lying leg curl for Nordics at FIFO, carrying on from 40 x 8
const gymD = await page.evaluate(async () => {
  const pl = await import('/src/plan.ts');
  const s = structuredClone(window.__dev.getState());
  const at = Date.now() - 86400000;
  s.profiles.find(p => p.id === 'fifo').machineSteps = { ...s.profiles.find(p => p.id === 'fifo').machineSteps, lying_leg_curl: 5 };
  s.sessions.push({ id: 'd18', slotIdx: null, type: 'gymD', date: '2026-10-18', gymId: 'fifo', week: 1, swaps: { nordic: 'lying_leg_curl' }, warmup: [], startedAt: at, finishedAt: at + 3600000 });
  [[1, 40, 8], [2, 35, 10], [3, 30, 10]].forEach(([setNo, weight, reps]) => s.sets.push({ id: `lc${setNo}`, sessionId: 'd18', exId: 'lying_leg_curl', plannedExId: 'nordic', setNo, weight, reps, rir: 2, suggestedWeight: null, suggestedReps: reps, ts: at + setNo }));
  [10, 10, 10, 9].forEach((reps, i) => s.sets.push({ id: `dp${i}`, sessionId: 'd18', exId: 'dips', plannedExId: 'dips', setNo: i + 1, weight: null, reps, rir: 3, suggestedWeight: null, suggestedReps: 8, ts: at + 10 + i }));
  const swaps = pl.autoSwaps(s, 'fifo', 2);
  const plan = pl.buildPlan(s, { id: 'x', slotIdx: null, type: 'gymD', date: '2026-10-25', gymId: 'fifo', week: 2, swaps, warmup: [], startedAt: Date.now() });
  const show = id => { const p = plan.find(q => q.ex === id); return p ? `${p.title}: ${p.targets.map(t => `${t.weight}x${t.reps}`).join(' ')}` : 'missing'; };
  return [show('dips'), show('lying_leg_curl')];
});
check('Next Gym D: dips weighted, reverse pyramid from 10 kg', gymD[0] === 'Dips (weighted): 10x6 10x8 7.5x10', gymD[0]);
check('Next Gym D at FIFO: lying leg curl in place of Nordics, 40 kg for 9, back-offs held at 35 and 30', gymD[1] === 'Lying Leg Curl: 40x9 35x10 30x12', gymD[1]);

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} review checks passed` : `\n${results.filter(x => !x).length} of ${results.length} review checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
