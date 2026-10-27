// Checks the ramp-up sets shown before a main lift: weights worked out from the working weight, ticked
// off in order, logged as ramp-ups and never counted. Usage: node tools/ramp-test.mjs [output-folder]
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
const text = () => page.evaluate(() => document.body.innerText);
const shot = async name => { if (out) { await wait(300); await page.screenshot({ path: join(out, `ramp-${name}.png`) }); } };
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
const ramps = () => page.evaluate(() => window.__dev.getState().sets.filter(s => s.rampUp).map(s => `${s.exId}:${s.weight}x${s.reps}`).join());

// Thursday of week 1 at Port Hedland: the deadlift starts at 70 kg
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-15', { waitUntil: 'networkidle0' }); await wait(250);
await click('Start Gym C'); await click('Start warm-up');
check('The warm-up screen points to the ramp-up sets', (await text()).includes('Each lift then starts with its own warm-up sets'));
await click('Start lifting');
await click('Next exercise');                 // past the back-extension primer
await click('1.25');                          // smallest plate at this gym, asked once
let t = await text();
check('Deadlift at 70 kg shows three ramp-up sets', /WARM-UP SETS · NOT COUNTED/i.test(t) && t.includes('35 kg × 5') && t.includes('50 kg × 3') && t.includes('60 kg × 1'), t.split(/WARM-UP SETS · NOT COUNTED/i)[1]);
await shot('deadlift');
check('The set screen shows warm-up set 1, pre-filled', /WARM-UP SET 1 OF 3/i.test(await text()) && (await page.evaluate(() => document.querySelector('.stepper input').value)) === '35');
await click('Done · warm-up set');
check('Ticking one logs it as a ramp-up', (await ramps()) === 'deadlift:35x5', await ramps());
await page.evaluate(() => { const i = document.querySelector('.stepper input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '52.5'); i.dispatchEvent(new Event('input', { bubbles: true })); });
await click('Done · warm-up set'); await click('Done · warm-up set');
check('A warm-up set can be changed before logging it', (await ramps()).includes('deadlift:52.5x3'), await ramps());
check('After the warm-ups the screen is back on set 1 at the working weight', /SET 1 OF 3/i.test(await text()) && (await page.evaluate(() => document.querySelector('.stepper input').value)) === '70');
check('All three logged in order', (await ramps()) === 'deadlift:35x5,deadlift:52.5x3,deadlift:60x1', await ramps());
await click('Done');
t = await text();
check('After the first working set the ramp-up card is gone', !/WARM-UP SETS · NOT COUNTED/i.test(t));
check('Ramp-ups are not counted as working sets', await page.evaluate(() => window.__dev.getState().sets.filter(s => s.exId === 'deadlift' && !s.rampUp).length === 1));
await click('Skip'); await click('Done'); await click('Skip'); await click('Done'); await click('Skip');
await click('Next exercise');
t = await text();
check('A main lift with no weight yet (week 1) explains how to build up instead', /WARM-UP SETS · NOT COUNTED/i.test(t) && t.includes('Build up over 2–3 lighter sets') && /Flat Dumbbell Bench Press/i.test(t), t.slice(0, 260));
await click('Next exercise');
check('A bodyweight lift (pull-ups) has no ramp-up card', !/WARM-UP SETS · NOT COUNTED/i.test(await text()), (await text()).slice(0, 120));

// Week 3 in Adelaide: a second main lift of the session gets two sets
await page.evaluate(() => window.__dev.update(s => {
  const at = Date.now() - 86400000;   // the real clock orders sessions, whatever the pretend date
  s.sessions.push({ id: 'w2c', slotIdx: null, type: 'gymC', date: '2026-10-22', gymId: 'adelaide', week: 2, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
  s.sets.push({ id: 'b1', sessionId: 'w2c', exId: 'db_bench', plannedExId: 'db_bench', setNo: 1, weight: 30, reps: 8, rir: 2, suggestedWeight: null, suggestedReps: 6, ts: at });
  s.profiles.find(p => p.id === 'adelaide').smallestPlate = 1.25;
  s.activeSessionId = null;
}));
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-29', { waitUntil: 'networkidle0' }); await wait(250);
await click('Start Gym C'); await click('Start warm-up'); await click('Start lifting');
await click('Next exercise'); await click('Next exercise');
t = await text();
check('Second main lift of the day (bench at 32.5 kg) gets two ramp-up sets', /Flat Dumbbell Bench Press/i.test(t) && t.includes('20 kg × 5') && t.includes('25 kg × 2') && !t.includes('× 1\n'), t.split(/WARM-UP SETS · NOT COUNTED/i)[1]);
await shot('bench');

// 14 Oct: every weighted lift gets a lighter set first, and the preview lists them
await page.evaluate(() => window.__dev.update(s => { s.activeSessionId = null; }));
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-11-05', { waitUntil: 'networkidle0' }); await wait(250);
await click('Gym C');   // next Thursday's preview (this test already started the 29 Oct one)
t = await text();
check('The session preview lists ramp-up weights', /Conventional Deadlift[\s\S]{0,40}Warm-up sets: \d+ × 5, \d+ × 3/.test(t) && /Flat Dumbbell Bench Press[\s\S]{0,40}Warm-up sets: [\d.]+ × 5, [\d.]+ × 2/.test(t), t.split('THE PLAN')[1]?.slice(0, 400));
await page.evaluate(() => window.__dev.update(s => {
  const at = Date.now() - 3 * 86400000;
  s.sessions.push({ id: 'w2b', slotIdx: null, type: 'gymB', date: '2026-10-20', gymId: 'adelaide', week: 2, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
  s.sets.push({ id: 'c1', sessionId: 'w2b', exId: 'incline_curl', plannedExId: 'incline_curl', setNo: 1, weight: 12.5, reps: 10, rir: 2, suggestedWeight: null, suggestedReps: 8, ts: at });
}));
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-27', { waitUntil: 'networkidle0' }); await wait(250);
await click('Gym B');
t = await text();
check('A non-main lift (incline curl) shows one lighter set in the preview (7 kg: light dumbbells go in 1 kg steps)', /Incline Dumbbell Curl[\s\S]{0,40}Warm-up sets: 7 × 6/.test(t), t.split('Incline Dumbbell Curl')[1]?.slice(0, 80));

// 27 Oct: in a pair, both exercises' warm-up sets come before the first working set
await page.evaluate(() => window.__dev.update(s => {
  s.activeSessionId = null;
  const at = Date.now() - 2 * 86400000;
  s.sessions.push({ id: 'a16', slotIdx: null, type: 'gymA', date: '2026-10-16', gymId: 'fifo', week: 1, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
  [['lateral_raise', 9, 12], ['oh_triceps', 20, 12]].forEach(([exId, weight, reps], k) => [1, 2, 3].forEach(setNo => s.sets.push({ id: `${exId}${setNo}`, sessionId: 'a16', exId, plannedExId: exId, setNo, weight, reps, rir: 2, suggestedWeight: null, suggestedReps: reps, ts: at + k * 10 + setNo })));
  s.profiles.find(p => p.id === 'fifo').machineSteps = { ...s.profiles.find(p => p.id === 'fifo').machineSteps, oh_triceps: 2.5 };
}));
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-23', { waitUntil: 'networkidle0' }); await wait(250);
await click('Start Gym A'); await click('Start warm-up'); await click('Start lifting');
for (let i = 0; i < 5; i++) await click('Next exercise');
const screen = async () => (await text()).replace(/\s+/g, ' ');
let s1 = await screen();
check('Pair: first the lateral raise warm-up', /Dumbbell Lateral Raise/i.test(s1) && /WARM-UP SET 1 OF 1/i.test(s1), s1.slice(0, 200));
await click('Done · warm-up set');
let s2 = await screen();
check('Pair: then the triceps warm-up, before any working set', /WARM-UP SET 1 OF 1/i.test(s2) && /Overhead Cable Triceps/i.test(s2.split(/WARM-UP SETS · NOT COUNTED/i)[0]), s2.slice(0, 260));
await click('Done · warm-up set');
let s3 = await screen();
check('Pair: then lateral raise set 1', /SET 1 OF 3/i.test(s3) && /Dumbbell Lateral Raise/i.test(s3.split(/SET 1 OF 3/i)[0]), s3.slice(0, 260));

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} ramp-up checks passed` : `\n${results.filter(x => !x).length} of ${results.length} ramp-up checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
