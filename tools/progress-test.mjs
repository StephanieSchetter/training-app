// Fills a fresh copy of the app with made-up history, then checks the Progress screen, the home
// trend tiles, the Excel export and the computer view-only mode.
// Usage: node tools/progress-test.mjs <output-folder>   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const out = resolve(process.argv[2] ?? 'shots');
mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 150) : ''}`); };
const URL = 'http://localhost:5173/?local&nocatchup&today=2026-11-20';

// Six weeks of invented data: lifts going up, a machine at two gyms, runs, a time trial, Garmin days, body weight.
const seed = () => window.__dev.update(s => {
  const real = Date.now();
  const iso = n => { const d = new Date('2026-10-12T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let k = 0;
  const id = () => `t${++k}`;
  for (let w = 0; w < 6; w++) {
    const gym = w < 2 ? 'fifo' : 'adelaide';
    const at = real - (60 - w * 7) * 86400000;
    const add = (type, day, sets) => {
      const sid = id();
      s.sessions.push({ id: sid, slotIdx: null, type, date: iso(w * 7 + day), gymId: gym, week: w + 1, swaps: {}, warmup: [], startedAt: at + day * 86400000, finishedAt: at + day * 86400000 + 3000000 });
      for (const [exId, setNo, weight, reps, extra] of sets) s.sets.push({ id: id(), sessionId: sid, exId, plannedExId: exId, setNo, weight, reps, rir: 2, suggestedWeight: weight, suggestedReps: reps, ts: at, ...(extra ?? {}) });
    };
    add('gymB', 1, [['db_shoulder_press', 1, 22 + w * (gym === 'fifo' ? 2 : 2.5) / 2, 6 + (w % 3)], ['leg_extension', 1, (gym === 'fifo' ? 30 : 50) + w * 2.5, 12], ['hanging_leg_raise', 1, null, 10, { level: w < 3 ? 1 : 2, controlled: true }]]);
    add('gymC', 3, [['deadlift', 1, 100 + w * 5, 6], ['pull_up', 1, null, 3 + Math.floor(w / 2)], ['pull_up', 2, null, 3 + Math.floor(w / 2)], ['pull_up', 3, null, 3]]);
    add('gymD', 6, [['nordic', 1, null, 6, { assist: w < 4 ? 'band' : 'partial' }]]);
    const run = (type, day, title, speed, n, extra = {}) => s.runs.push({ id: id(), slotIdx: null, type, date: iso(w * 7 + day), week: w + 1, title, startedAt: at + day * 86400000, finishedAt: at + day * 86400000 + 2400000,
      segs: Array.from({ length: n }, (_, i) => ({ section: 'Main set', text: `Rep ${i + 1}`, work: true, prescribed: speed, actual: speed - (w === 2 && i === n - 1 ? 0.3 : 0), km: 0.8, done: true })), ...extra });
    run('easy', 0, 'Easy Run', w < 3 ? 10 : 10.2, 1);
    s.garminActs.push({ id: 1000 + w, type: 'run', startLocal: `${iso(w * 7)} 06:00:00`, date: iso(w * 7), durationSec: 1800, avgHr: 142 - w, maxHr: 160, trainingLoad: 60, distanceKm: 5, laps: [] });
    if (w === 3) s.runs.push({ id: id(), slotIdx: null, type: 'intervals', date: iso(w * 7 + 2), week: 4, title: '5 km Time Trial', timeTrial: true, timeTrialSec: 21 * 60 + 20, segs: [], startedAt: at + 2 * 86400000, finishedAt: at + 2 * 86400000 + 1 });
    else run('intervals', 2, 'Intervals', 13.8 + w * 0.3, 5, { answer: 'yes' });
    run('threshold', 5, 'Threshold Run', 12.6 + (w > 2 ? 0.3 : 0), 2, { answer: 'no' });
    s.weights.push({ date: iso(w * 7 + 1), kg: 84 - w * 0.4 });
  }
  for (let n = 0; n < 120; n++) {
    const d = new Date('2026-11-20T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); const key = d.toISOString().slice(0, 10);
    s.garminDays[key] = { date: key, restingHr: 48 + (n % 5), hrv: 40 + (n % 9), sleepHours: 6.5 + (n % 4) * 0.4, sleepScore: 70 + (n % 20), readiness: 55 + (n % 40), trainingLoad: 300 };
  }
  s.garminStatus = { ok: true, lastSync: new Date().toISOString() };
  s.speeds = { intervals: 15.3, threshold: 12.9, strides: 16 };
});

// ---- Phone ----
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (label, nth = 0) => {
    const ok = await page.evaluate((label, nth) => { const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)[nth]; if (!b) return false; b.click(); return true; }, label, nth);
    if (!ok) throw new Error(`No button "${label}" on: ${(await text()).slice(0, 300)}`);
    await wait(200);
  };
  const shot = async (name, full = false) => { await wait(250); await page.screenshot({ path: join(out, `progress-${name}.png`), fullPage: full }); };
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(seed); await wait(600);
  await page.goto(URL, { waitUntil: 'networkidle0' }); await wait(300);

  const home = await text();
  check('Home tiles: interval speed with change since block start', /INTERVAL SPEED\s*15\.3 km\/h[\s\S]{0,30}\+1\.5 since block start/.test(home), home.split('TRENDS')[1]);
  check('Home tiles: body weight, HRV and main lifts filled in', /BODY WEIGHT\s*82 kg/.test(home) && /HRV, 7-DAY\s*\d+/.test(home) && /MAIN LIFTS\s*\+\d/.test(home));
  check('Home tiles: easy-run heart rate at the same speed', /EASY-RUN HR\s*137 bpm[\s\S]{0,30}-2 bpm at 10\.2 km\/h/.test(home));
  await shot('home-tiles', true);

  await click('Progress');
  const prog = await text();
  check('Progress shows recovery, running and strength sections', ['RECOVERY', 'RUNNING', 'STRENGTH', 'Training Readiness', '5 km time trials'].every(x => prog.includes(x)));
  check('Charts are drawn (not empty states)', (await page.evaluate(() => document.querySelectorAll('.chart svg path').length)) >= 9, await page.evaluate(() => document.querySelectorAll('.chart svg path').length));
  check('FIFO stints are shaded on time charts', (await page.evaluate(() => document.querySelectorAll('.c-band').length)) > 0);
  check('Time trial shows 21:20 against the 20:00 line', prog.includes('21:20') && (await page.evaluate(() => [...document.querySelectorAll('.c-tick')].some(t => t.textContent === '20:00'))));
  await shot('recovery');
  await page.evaluate(() => document.querySelectorAll('h2')[1].scrollIntoView()); await shot('running');

  await click('Conventional Deadlift');
  const dl = await text();
  check('Deadlift opens with estimated max (125 kg x 6 -> 150 kg)', dl.includes('150 kg') && dl.includes('weight × (1 + reps ÷ 30)'));
  await click('Leg Extension');
  check('Machine lift shows one line per gym as % change', (await page.evaluate(() => [...document.querySelectorAll('.chart-legend')].some(l => l.textContent.includes('FIFO') && l.textContent.includes('Adelaide')))));
  await click('Pull-Up (Strict)'); await click('Hanging Leg Raise'); await click('Nordic Curl');
  const more = await text();
  check('Pull-ups show total reps; leg raises and Nordics show level', more.includes('Total reps per session') && more.includes('Level reached'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Conventional Deadlift')).scrollIntoView()); await shot('lifts');
  // hover read-out
  const box = await page.evaluate(() => { const el = document.querySelector('.lift-body svg'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.9, y: r.y + r.height / 2, under: document.elementFromPoint(r.x + r.width * 0.9, r.y + r.height / 2)?.tagName }; });
  await page.touchscreen.tap(box.x, box.y); await wait(250);
  if (!(await page.evaluate(() => document.querySelector('.chart-tip')))) console.log('   (tap landed on', box.under, 'at', Math.round(box.x), Math.round(box.y), ')');
  check('Touching a chart shows the value and the set behind it', /kg × \d/.test(await page.evaluate(() => document.querySelector('.chart-tip')?.textContent ?? '')), await page.evaluate(() => document.querySelector('.chart-tip')?.textContent));
  await click('Show as table');
  check('Each chart has a table view', (await page.evaluate(() => document.querySelectorAll('.chart-table tr').length)) > 3);

  // Export
  const dl2 = join(out, 'downloads');
  rmSync(dl2, { recursive: true, force: true }); mkdirSync(dl2, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl2 });
  await click('Settings'); await click('Export all to Excel'); await wait(3000);
  const file = readdirSync(dl2).find(f => f.endsWith('.xlsx'));
  check('Export saves an .xlsx file', !!file, file);
  if (file) {
    const zip = unzipSync(new Uint8Array(readFileSync(join(dl2, file))));
    const wb = strFromU8(zip['xl/workbook.xml']);
    const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
    check('Workbook has a sheet per table', ['Gym sessions', 'Sets', 'Runs', 'Garmin daily', 'Garmin laps', 'Body weight', 'Schedule', 'FIFO stints', 'Morning check-ins'].every(n => names.includes(n)), `${names.length} sheets`);
    const sets = strFromU8(zip[`xl/worksheets/sheet${names.indexOf('Sets') + 1}.xml`]);
    check('Sets sheet has a header row and one row per set', sets.includes('Weight kg') && (sets.match(/<row /g) ?? []).length === 1 + (await page.evaluate(() => window.__dev.getState().sets.length)), `${(sets.match(/<row /g) ?? []).length} rows`);
    check('Sheets are well-formed XML', Object.keys(zip).filter(k => k.endsWith('.xml')).every(k => { const x = strFromU8(zip[k]); return x.startsWith('<?xml') && !/&(?!amp;|lt;|gt;|quot;)/.test(x); }));
  }
  await ctx.close();
}

// ---- Computer: view only, charts side by side ----
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const text = () => page.evaluate(() => document.body.innerText);
  await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-13', { waitUntil: 'networkidle0' });
  await page.evaluate(seed); await wait(600);
  await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-13', { waitUntil: 'networkidle0' }); await wait(300);
  const home = await text();
  check('Computer: says it is view only', home.includes('view only'));
  check('Computer: no Start, check-in, stretch or body-weight entry', !home.includes('Start Gym B') && !/morning check-in/i.test(home) && !home.includes('Evening stretch') && !/weekly body weight/i.test(home));
  await page.evaluate(() => [...document.querySelectorAll('.tabbar button')].find(b => b.textContent === 'Progress').click()); await wait(400);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.chart-grid')).gridTemplateColumns.split(' ').length);
  check('Computer: charts laid out two across', cols === 2, cols);
  await page.screenshot({ path: join(out, 'progress-computer.png') });
  await ctx.close();
}

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} progress checks passed` : `\n${results.filter(x => !x).length} of ${results.length} progress checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
