// On-screen checks for the physio program update of 8 Oct 2026: session order, the graded deadlift
// return, the morning-check hold, the back extension and lateral bend progressions, and the
// back-flare week. Each check starts from a fresh copy of the app on a pretend date.
// Usage: node tools/physio-test.mjs <output-folder>   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 170) : ''}`); };

// Runs inside the page. Adds finished sessions with sets and, optionally, a morning check.
// spec: [{ id, type, date, week, daysAgo, sets: [[exId, setNo, weight, reps, extra]], check: { knee, back } }]
const seed = spec => window.__dev.update(s => {
  for (const x of spec) {
    const at = Date.now() - x.daysAgo * 86400000;
    const slot = s.schedule.find(z => z.type === x.type && z.week === x.week);
    if (slot) slot.done = true;
    s.sessions.push({ id: x.id, slotIdx: slot ? slot.idx : null, type: x.type, date: x.date, gymId: x.gym ?? 'fifo', week: x.week, swaps: {}, warmup: [], startedAt: at, finishedAt: at + 3600000 });
    x.sets.forEach(([exId, setNo, weight, reps, extra], i) => s.sets.push({ id: `${x.id}-${i}`, sessionId: x.id, exId, plannedExId: exId, setNo, weight, reps, rir: 3, suggestedWeight: null, suggestedReps: reps, ts: at, ...(extra ?? {}) }));
    if (x.check) s.checkins.push({ id: x.id, sessionId: x.id, date: x.date, knee: x.check.knee ?? 'ok', back: x.check.back ?? 'ok' });
  }
});

async function fresh(date, spec, extra) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const url = `http://localhost:5173/?local&nocatchup&today=${date}`;
  await page.goto(url, { waitUntil: 'networkidle0' }); await wait(200);
  if (spec) { await page.evaluate(seed, spec); await wait(300); }
  if (extra) { await page.evaluate(extra); await wait(300); }
  if (spec || extra) { await wait(400); await page.goto(url, { waitUntil: 'networkidle0' }); await wait(300); }
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (label, nth = 0) => {
    const ok = await page.evaluate((label, nth) => { const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth]; if (!b) return false; b.click(); return true; }, label, nth);
    if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 400)}`);
    await wait(160);
  };
  const day = async num => { await page.evaluate(num => [...document.querySelectorAll('.cal-day:not(.out)')].find(b => b.querySelector('.cal-num').textContent === String(num)).click(), num); await wait(150); };
  // Opens the preview of the session on a given day of the visible month and returns its "plan" text.
  const plan = async (num, name) => { await click('Calendar'); await day(num); await click(name); const t = await text(); await click('Back'); await click('Today'); return t.split('THE PLAN')[1] ?? t; };
  const shot = name => wait(250).then(() => page.screenshot({ path: join(out, `physio-${name}.png`) }));
  return { page, text, click, day, plan, shot, close: () => ctx.close() };
}

const dl = (w, reps = [8, 8, 8]) => reps.map((r, i) => ['deadlift', i + 1, w, r]);
const wk1C = (check, sets = dl(60)) => ({ id: 'c1', type: 'gymC', date: '2026-10-15', week: 1, daysAgo: 8, sets, check });

// 2. Thursday order, primer as a warm-up, deadlift 3 x 8 at RIR 4+, no suitcase carry
{
  const a = await fresh('2026-10-15');
  await a.click('Start Gym C');
  const t = (await a.text()).split("TODAY'S EXERCISES")[1];
  const order = ['45° Back Extension (Primer)', 'Conventional Deadlift', 'Flat Dumbbell Bench Press', 'Pull-Up (Strict)', 'Lat Pulldown', 'Single-Leg Box-To-Stand', 'Seated'];
  check('Thursday: primer first, then the six lifts in order, no suitcase carry', order.every((n, i) => i === 0 || t.indexOf(order[i - 1]) < t.indexOf(n)) && t.indexOf(order[0]) >= 0 && !t.includes('Suitcase'), t);
  check('Thursday: primer is 2 × 10 and marked as a warm-up', /Warm-up\s*45° Back Extension \(Primer\)\s*2 × 10/.test(t));
  check('Thursday weeks 1–2: deadlift is 3 × 8 at RIR 4+', /Conventional Deadlift\s*3 × 8 · RIR 4\+/.test(t));
  await a.shot('thursday');
  await a.click('Start warm-up'); await a.click('Start lifting');
  for (let i = 0; i < 2; i++) await a.click('Done');
  await a.click('Finish');
  check('Thursday: the primer is not counted in the session totals', /EXERCISES\s*0 of 6/.test(await a.text()) && /SETS\s*0/.test(await a.text()), (await a.text()).slice(0, 120));
  await a.close();
}

// Deadlift week 2: goes up only after an OK morning check
{
  const none = await fresh('2026-10-16', [wk1C(undefined)]);
  const t0 = await none.plan(22, 'Gym C');
  check('Deadlift week 2, no morning check answered: held at 60 kg', /Conventional Deadlift[\s\S]{0,90}60 kg/.test(t0) && t0.includes('Held: no morning check-in'), t0.slice(0, 200));
  await none.close();
  const ok = await fresh('2026-10-16', [wk1C({})]);
  const t1 = await ok.plan(22, 'Gym C');
  check('Deadlift week 2, check OK and all 3 × 8 done: +5 kg to 65', /Conventional Deadlift\s*3 × 8 · RIR 4\+\s*65 kg/.test(t1), t1.slice(0, 200));
  await ok.close();
  const worse = await fresh('2026-10-16', [wk1C({ knee: 'worse' })]);
  const t2 = await worse.plan(22, 'Gym C');
  check('Deadlift week 2, knee worse next morning: held at 60 kg', /Conventional Deadlift[\s\S]{0,90}60 kg/.test(t2) && t2.includes('Held: knee or back was worse'), t2.slice(0, 200));
  await worse.close();
  const short = await fresh('2026-10-16', [wk1C({}, dl(60, [8, 8, 6]))]);
  check('Deadlift week 2, a set short of 8: same weight', /Conventional Deadlift\s*3 × 8 · RIR 4\+\s*60 kg/.test(await short.plan(22, 'Gym C')));
  await short.close();
}

// Deadlift week 3: first reverse-pyramid week, RIR 3; week 5 back to the normal RIR
{
  const two = [wk1C({}), { id: 'c2', type: 'gymC', date: '2026-10-22', week: 2, daysAgo: 2, sets: dl(65), check: {} }];
  const a = await fresh('2026-10-23', two);
  const t = await a.plan(29, 'Gym C');
  check('Deadlift week 3: 6/8/10 reverse pyramid at RIR 3, top set 70 kg (65 + 5)', /Conventional Deadlift\s*3 sets · 6 \/ 8 \/ 10 · RIR 3\s*70 kg/.test(t), t.slice(0, 220));
  await a.close();
  const b = await fresh('2026-10-23', [wk1C({}), { id: 'c2', type: 'gymC', date: '2026-10-22', week: 2, daysAgo: 2, sets: dl(65, [8, 7, 8]), check: {} }]);
  check('Deadlift week 3 when week 2 was not all 3 × 8: top set stays 65 kg', /Conventional Deadlift\s*3 sets · 6 \/ 8 \/ 10 · RIR 3\s*65 kg/.test(await b.plan(29, 'Gym C')));
  await b.close();
}

// 3 and 4. Friday and Sunday order and pairs
{
  const a = await fresh('2026-10-16');
  await a.click('Start Gym A');
  const t = (await a.text()).split("TODAY'S EXERCISES")[1];
  const order = ['Kettlebell Swing', 'Incline Barbell Press', 'Barbell Hip Thrust', 'A1', '45° Back Extension', 'A2', '45° Lateral Bend', 'B1', 'Dumbbell Lateral Raise', 'B2', 'Overhead Cable Triceps', 'Pallof Press'];
  check('Friday: order and pairs (A1 back extension / A2 lateral bend, B1 lateral raise / B2 triceps)', order.every((n, i) => i === 0 || t.indexOf(order[i - 1]) < t.indexOf(n, t.indexOf(order[i - 1]))), t);
  check('Friday: lateral bend starts at stage 1, hands by sides, 3 × 10–12 each side', /45° Lateral Bend · Stage 1: Hands by sides\s*3 × 10–12 each side/.test(t));
  await a.shot('friday');
  await a.close();
  const d = await fresh('2026-10-18');
  await d.click('Start Gym D');
  const s = (await d.text()).split("TODAY'S EXERCISES")[1];
  const od = ['Single-Leg Romanian Deadlift', 'Dips', 'Nordic Curl', 'A1', 'Face Pull', 'A2', 'Hammer Curl', 'Single-Leg Calf Raise', 'B1', '45° Back Extension', 'B2', '45° Lateral Bend'];
  check('Sunday: order and pairs, side plank removed', od.every((n, i) => i === 0 || s.indexOf(od[i - 1]) < s.indexOf(n, s.indexOf(od[i - 1]))) && !s.includes('Side Plank'), s);
  await d.close();
}

// 5. Back extension: bodyweight until 3 × 12 with RIR 3 or 4+ on every set, then 2.5 kg steps; carries Fri -> Sun
{
  const be = (rirs, weight = null, reps = 12) => rirs.map((rir, i) => ['back_ext_45', i + 1, weight, reps, { rir }]);
  const fri = sets => [{ id: 'a1', type: 'gymA', date: '2026-10-16', week: 1, daysAgo: 2, sets }];
  const easy = await fresh('2026-10-17', fri(be([3, 4, 3])));
  check('Back extension: 3 × 12 all at RIR 3 or 4+ on Friday -> 2.5 kg on Sunday', /45° Back Extension \(weighted\)\s*3 × 10–12\s*2\.5 kg/.test(await easy.plan(18, 'Gym D')), (await easy.plan(18, 'Gym D')).slice(-160));
  await easy.close();
  const hard = await fresh('2026-10-17', fri(be([3, 3, 2])));
  check('Back extension: one set at RIR 2 -> stays bodyweight', /45° Back Extension\s*3 × 10–12\s*Bodyweight/.test(await hard.plan(18, 'Gym D')));
  await hard.close();
  const up = await fresh('2026-10-17', fri(be([2, 2, 2], 2.5)));
  check('Back extension weighted: all sets at 12 -> +2.5 kg to 5', /45° Back Extension \(weighted\)\s*3 × 10–12\s*5 kg/.test(await up.plan(18, 'Gym D')));
  await up.close();
}

// 5. Lateral bend: up a stage only at 12 on every set, both sides, all controlled
{
  const lb = (reps, controlled = true, level = 1) => [1, 2, 3].flatMap(n => ['L', 'R'].map(side => ['lateral_bend_45', n, null, typeof reps === 'function' ? reps(n, side) : reps, { side, controlled, level }]));
  const fri = sets => [{ id: 'a1', type: 'gymA', date: '2026-10-16', week: 1, daysAgo: 2, sets }];
  const full = await fresh('2026-10-17', fri(lb(12)));
  check('Lateral bend: 12 on every set, both sides, controlled -> stage 2, hands crossed over chest', (await full.plan(18, 'Gym D')).includes('Stage 2: Hands crossed over chest'));
  await full.close();
  const eleven = await fresh('2026-10-17', fri(lb((n, side) => (n === 3 && side === 'R' ? 11 : 12))));
  check('Lateral bend: one side of one set at 11 -> stays at stage 1', (await eleven.plan(18, 'Gym D')).includes('Stage 1: Hands by sides'));
  await eleven.close();
  const loose = await fresh('2026-10-17', fri(lb(12, false)));
  check('Lateral bend: 12s but not ticked controlled -> stays at stage 1', (await loose.plan(18, 'Gym D')).includes('Stage 1: Hands by sides'));
  await loose.close();
  // 4. Back-flare week: lateral bend drops one stage, back extension holds the last load that didn't aggravate
  const flare = await fresh('2026-10-17', fri([...lb(12), ...[1, 2, 3].map(n => ['back_ext_45', n, 5, 12, { rir: 1 }])]),
    () => window.__dev.update(s => { s.tempSwaps.push({ id: 'f', kind: 'back-flare', week: 1, createdAt: Date.now() }); }));
  const f = await flare.plan(18, 'Gym D');
  check('Back-flare week: lateral bend shows one stage easier (stage 1 instead of 2)', f.includes('Stage 1: Hands by sides'), f.slice(-260));
  check('Back-flare week: back extension held at the last load (5 kg), not increased', /45° Back Extension \(weighted\)\s*3 × 10–12\s*5 kg/.test(f));
  const thu = await flare.plan(22, 'Gym C');
  check('The week after a flare: lateral bend is back at stage 2', (await flare.plan(25, 'Gym D')).includes('Stage 2: Hands crossed over chest'));
  check('The week after a flare: deadlift is back in the plan', thu.includes('Conventional Deadlift') && !thu.includes('Swapped from Conventional'), thu.slice(0, 200));
  await flare.close();
}

// 4. Back-flare week on Thursday: deadlift becomes 3 sets of back extension on top of the primer
{
  const a = await fresh('2026-10-15', null, () => window.__dev.update(s => { s.tempSwaps.push({ id: 'f', kind: 'back-flare', week: 1, createdAt: Date.now() }); }));
  await a.click('Start Gym C');
  const t = (await a.text()).split("TODAY'S EXERCISES")[1];
  check('Back-flare Thursday: primer stays, deadlift is replaced by 3 sets of back extension', /45° Back Extension \(Primer\)\s*2 × 10[\s\S]*?45° Back Extension\s*3 × 10–12/.test(t) && !t.includes('Conventional Deadlift'), t.slice(0, 220));
  await a.close();
}

// 6. Morning check: OK / Worse; "worse" holds that session's main lifts and is flagged on Progress
{
  const sets = [...dl(60), ['db_bench', 1, 30, 8], ['db_bench', 2, 26, 10], ['db_bench', 3, 24, 12]];
  const ok = await fresh('2026-10-16', [{ id: 'c1', type: 'gymC', date: '2026-10-15', week: 1, daysAgo: 1, sets }]);
  const card = await ok.text();
  check('Morning check-in offers OK / Worse for knee and back', /MORNING CHECK-IN · AFTER GYM C/i.test(card) && /Knee\s*OK\s*Worse\s*Back\s*OK\s*Worse/i.test(card) && !/Better|Same/.test(card.split(/MORNING CHECK-IN/i)[1].slice(0, 200)));
  await ok.shot('checkin');
  await ok.click('Save check-in');
  check('Check OK: bench hit the top of its range, so next week goes up a step (30 -> 32 kg at FIFO)', /Flat Dumbbell Bench Press\s*3 sets · 6 \/ 8 \/ 10\s*32 kg/.test(await ok.plan(22, 'Gym C')));
  await ok.close();
  const bad = await fresh('2026-10-16', [{ id: 'c1', type: 'gymC', date: '2026-10-15', week: 1, daysAgo: 1, sets }]);
  await bad.click('Worse', 0); await bad.click('Save check-in');
  for (const b of ['No thanks', 'No thanks']) { try { await bad.click(b); } catch { /* fewer offers than expected is fine */ } }
  const p2 = await bad.plan(22, 'Gym C');
  check('Check "knee worse": bench is held at 30 kg next week even though it earned an increase', /Flat Dumbbell Bench Press[\s\S]{0,80}30 kg/.test(p2) && p2.includes('Held: knee or back was worse'), p2.slice(0, 320));
  await bad.click('Progress'); await bad.click('Flat Dumbbell Bench Press');
  check('Progress flags the held lift', (await bad.text()).includes('Weight held: knee or back was worse'));
  await bad.shot('held');
  await bad.close();
}

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} physio checks passed` : `\n${results.filter(x => !x).length} of ${results.length} physio checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
