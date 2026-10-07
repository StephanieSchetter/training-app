// Checks the schedule, readiness, check-in and Garmin-banner behaviour on screen, on pretend dates
// (spec scenarios 6, 7, 8, 9, 12, 13, 14, 18). Each scenario starts from a fresh copy of the app.
// Usage: node tools/flow-test.mjs <output-folder>   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 150) : ''}`); };

/** A fresh app (own storage) on a pretend date. setup runs inside the page before the app is looked at. */
async function fresh(date, { catchUp = false, setup } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const frozen = `http://localhost:5173/?local&nocatchup&today=${date}`;
  const url = catchUp ? `http://localhost:5173/?local&today=${date}` : frozen;
  await page.goto(frozen, { waitUntil: 'networkidle0' });
  await wait(200);
  if (setup) { await page.evaluate(setup, date); await wait(700); }
  if (setup || catchUp) { await page.goto(url, { waitUntil: 'networkidle0' }); await wait(300); }
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (label, nth = 0) => {
    const ok = await page.evaluate((label, nth) => {
      const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth];
      if (!b) return false;
      b.click();
      return true;
    }, label, nth);
    if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 400)}`);
    await wait(150);
  };
  const day = async num => { await page.evaluate(num => [...document.querySelectorAll('.cal-day:not(.out)')].find(b => b.querySelector('.cal-num').textContent === String(num)).click(), num); await wait(150); };
  const on = (d) => page.evaluate(d => window.__dev.getState().schedule.filter(s => s.date === d && !s.skipped).sort((a, b) => a.order - b.order).map(s => s.type), d);
  const shot = name => wait(250).then(() => page.screenshot({ path: join(out, `flow-${name}.png`) }));
  return { page, text, click, day, on, shot, close: () => ctx.close() };
}

// 6: standing calf raise during FIFO -> swap shown automatically
{
  const a = await fresh('2026-10-13');
  await a.click('Start Gym B');
  const t = await a.text();
  check('6: FIFO calf swap shown on the start screen', /SWAPS AT THIS GYM[\s\S]*Standing Calf Raise[\s\S]*Single-Leg Calf Raise On A Step/.test(t));
  await a.close();
}

// 7: missed Thursday -> Gym C moves to Friday and everything after shifts a day
{
  const a = await fresh('2026-10-16', { catchUp: true, setup: () => window.__dev.update(s => { for (const x of s.schedule) if (x.date < '2026-10-15') x.done = true; }) });
  check('7: Gym C moved to Friday', (await a.on('2026-10-16')).join() === 'gymC', await a.on('2026-10-16'));
  check('7: Gym A moved to Saturday, next Gym B to Wednesday', (await a.on('2026-10-17')).join() === 'gymA' && (await a.on('2026-10-21')).join() === 'gymB');
  const t = await a.text();
  check('7: a notice explains the change', t.includes("wasn't logged") && t.includes('Start Gym C'));
  await a.shot('missed-day');
  // put Gym C the day before intervals -> warning with an offer to swap
  await a.page.evaluate(() => window.__dev.update(s => {
    const c = s.schedule.find(x => x.type === 'gymC' && !x.done); const b = s.schedule.find(x => x.type === 'gymB' && !x.done);
    [c.type, b.type] = [b.type, c.type];
  }));
  await wait(300);
  check('7: Gym C the day before intervals raises a warning', (await a.text()).includes('the day before intervals'));
  await a.click('Swap it with');
  check('7: accepting the swap clears it', !(await a.text()).includes('the day before intervals'));
  await a.close();
}

// 8: travel day with easy run + Gym B next day -> double-up offered, Gym B first
{
  const a = await fresh('2026-10-13');
  check('8: seeded Mon 26 Oct travel is already doubled up on Tue 27, Gym B first', (await a.on('2026-10-26')).length === 0 && (await a.on('2026-10-27')).join() === 'gymB,easy');
  await a.click('Calendar'); await a.day(19); await a.click('Shift'); await a.click('Travel — no training');
  const t = await a.text();
  check('8: marking an easy-run day as travel offers the double-up, gym first', t.includes('Double up the next day') && t.includes('Gym B first, then Easy Run'), t.split('Travel day')[1]);
  await a.shot('travel-choice');
  await a.click('Double up the next day');
  check('8: choosing it puts both on the next day in that order', (await a.on('2026-10-19')).length === 0 && (await a.on('2026-10-20')).join() === 'gymB,easy');
  await a.close();
}

// 9: Gym A day marked travel (threshold next) -> no double-up, only shift or skip
{
  const a = await fresh('2026-10-13');
  await a.click('Calendar'); await a.day(16); await a.click('Shift'); await a.click('Travel — no training');
  const t = await a.text();
  check('9: Gym A travel day offers only move or skip', !t.includes('Double up') && t.includes('Move everything a day later') && t.includes('Skip Gym A'));
  await a.click('Skip Gym A');
  check('9: skipping removes it and leaves the rest alone', (await a.on('2026-10-16')).length === 0 && (await a.on('2026-10-17')).join() === 'threshold');
  await a.close();
}

// 12: readiness 20 on intervals day -> intervals at -0.3, not an easy run
{
  const a = await fresh('2026-10-14', { setup: d => window.__dev.update(s => { s.garminDays[d] = { date: d, restingHr: 50, hrv: 40, sleepHours: 5, sleepScore: 40, readiness: 20, trainingLoad: 100 }; }) });
  check('12: home shows the suggestion', (await a.text()).includes('Readiness 20: Intervals at -0.3 km/h'));
  await a.click('Open Intervals');
  await a.click('Accept');
  const t = await a.text();
  check('12: accepted -> intervals stay, at 13.5 km/h', t.includes('5 × 800 m at 13.5 km/h') && !t.includes('Easy Run'), t.split('\n').find(l => l.includes('× 800')));
  await a.shot('readiness-intervals');
  await a.click('Start this run');
  check('12: the run starts as intervals at the lower speed', (await a.text()).includes('Rep 1 of 5: 800 m at 13.5 km/h'));
  await a.close();
}

// readiness 40 on a gym day -> one fewer set on main lifts, +1 RIR
{
  const a = await fresh('2026-10-13', { setup: d => window.__dev.update(s => { s.garminDays[d] = { date: d, restingHr: 50, hrv: 40, sleepHours: 5, sleepScore: 40, readiness: 40, trainingLoad: 100 }; }) });
  await a.click('Start Gym B');
  await a.click('Accept');
  const t = await a.text();
  check('8.1: readiness 40 accepted -> main lifts lose a set, RIR +1', t.includes('2 sets · 6 / 8') && t.includes('3 +1'), t.split("TODAY'S EXERCISES")[1]);
  await a.close();
}

// 13: resting HR +5 over the 30-day median for 3 days -> two-days-off alert; accepting shifts two days
{
  const a = await fresh('2026-10-14', { setup: d => window.__dev.update(s => {
    const add = (n, hr) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - n); const k = x.toISOString().slice(0, 10); s.garminDays[k] = { date: k, restingHr: hr, hrv: 40, sleepHours: 7, sleepScore: 80, readiness: 80, trainingLoad: 100 }; };
    for (let n = 32; n >= 3; n--) add(n, 50);
    add(2, 55); add(1, 56); add(0, 55);
  }) });
  check('13: alert appears', (await a.text()).includes('5 or more beats above normal for three days'));
  await a.shot('rhr-alert');
  await a.click('Take two days off');
  check('13: accepting moves the schedule two days', (await a.on('2026-10-14')).length === 0 && (await a.on('2026-10-16')).join() === 'intervals');
  await a.close();
}

// 14: "back worse" after Gym C -> -10% on back-tagged lifts next time, and the back-flare swap for the week
{
  const a = await fresh('2026-10-16', { setup: () => window.__dev.update(s => {
    const slot = s.schedule.find(x => x.type === 'gymC'); slot.done = true;
    // The computer's real clock is earlier than the pretend date, so "logged yesterday" is yesterday in real time.
    const at = Date.now() - 86400000;
    s.sessions.push({ id: 'c1', slotIdx: slot.idx, type: 'gymC', date: '2026-10-15', gymId: 'fifo', week: 1, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
    const set = (id, exId, setNo, weight, reps, side) => s.sets.push({ id, sessionId: 'c1', exId, plannedExId: exId, setNo, side, weight, reps, rir: 3, suggestedWeight: null, suggestedReps: reps, ts: at });
    set('d1', 'deadlift', 1, 100, 6); set('d2', 'deadlift', 2, 90, 8); set('d3', 'deadlift', 3, 80, 10);
    set('b1', 'db_bench', 1, 30, 6);
    set('s1', 'suitcase_carry', 1, 30, 30, 'L'); set('s2', 'suitcase_carry', 1, 30, 30, 'R');
  }) });
  check('14: morning check-in is asked after Gym C', /morning check-in · after gym c/i.test(await a.text()));
  await a.click('Worse', 1); // second row = back
  await a.shot('checkin');
  await a.click('Save check-in');
  const t = await a.text();
  check('14: proposes 10% lighter on the back-tagged lifts only', t.includes('Go 10% lighter next time') && t.includes('Conventional Deadlift, Suitcase Carry') && !t.includes('Flat Dumbbell Bench Press,'), t.split('Go 10% lighter')[1]);
  check('14: offers the back-flare swap for the week', t.includes('Swap deadlift and single-leg RDL for 45° back extension'));
  await a.shot('checkin-offers');
  await a.click('Go lighter'); await a.click('Swap them');
  await a.click('Calendar'); await a.day(18); await a.click('Gym D');
  check('14: this week\'s Gym D now shows the back extension', (await a.text()).includes('Swapped from Single-Leg Romanian Deadlift'));
  await a.click('Back'); await a.day(22); await a.click('Gym C');
  const c = await a.text();
  check('14: next Gym C has deadlift back, 10% lighter (100 -> 90 kg)', /Conventional Deadlift[\s\S]{0,40}90 kg/.test(c) && !c.includes('Swapped from Conventional'), c.split('THE PLAN')[1]);
  check('14: bench (not back-tagged) is unchanged at 30 kg', /Flat Dumbbell Bench Press[\s\S]{0,40}30 kg/.test(c));
  await a.close();
}

// 18: Garmin pull has failed for 2 days -> banner with the last sync date; app otherwise usable
{
  const a = await fresh('2026-10-13', { setup: () => window.__dev.update(s => { s.garminStatus = { ok: false, lastSync: new Date(Date.now() - 2.5 * 86400000).toISOString(), error: 'ConnectionError' }; }) });
  const t = await a.text();
  check('18: banner shows Garmin is out of date with the last sync date', t.includes('Garmin data is out of date. Last synced'));
  await a.click('Start Gym B'); await a.click('Start warm-up'); await a.click('Start lifting');
  check('18: gym logging still works', (await a.text()).includes('Seated Dumbbell Shoulder Press'));
  await a.close();
}

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} flow checks passed` : `\n${results.filter(x => !x).length} of ${results.length} flow checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
