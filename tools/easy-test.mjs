// Checks the easy-pace rule on screen: no suggestion before a time trial; after one, three easy runs
// at 145 bpm or under suggest +0.2; accepting changes the next easy run; a run at 152+ suggests -0.2.
// Usage: node tools/easy-test.mjs   (dev server running)
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 384, height: 824, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 160) : ''}`); };
const URL = 'http://localhost:5173/?local&nocatchup&today=2026-11-09';
const text = () => page.evaluate(() => document.body.innerText);
const click = async label => { await page.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label)).click(), label); await wait(250); };
// Adds finished easy runs at a speed with a matching watch activity at the given average heart rates.
const addRuns = (speed, hrs, startDay) => page.evaluate((speed, hrs, startDay) => window.__dev.update(s => {
  hrs.forEach((hr, i) => {
    const d = new Date('2026-11-09T00:00:00Z'); d.setUTCDate(d.getUTCDate() + startDay + i); const date = d.toISOString().slice(0, 10);
    const at = Date.now() - (30 - startDay - i) * 86400000;
    s.runs.push({ id: `e${startDay}-${i}`, slotIdx: null, type: 'easy', date, week: 5, title: 'Easy Run', startedAt: at, finishedAt: at + 2400000, segs: [{ section: 'Main run', text: '40 min', work: true, prescribed: speed, actual: speed, km: 6.8, done: true }] });
    s.garminActs.push({ id: 5000 + startDay * 10 + i, type: 'run', startLocal: `${date} 06:00:00`, date, durationSec: 2400, avgHr: hr, maxHr: hr + 15, trainingLoad: 60, distanceKm: 6.8, laps: [] });
  });
}), speed, hrs, startDay);

await page.goto(URL, { waitUntil: 'networkidle0' }); await wait(200);
await addRuns(10.2, [140, 142, 144], 0); await wait(400);
check('No easy-pace suggestion before any time trial', !/easy pace/i.test(await text()));
await page.evaluate(() => window.__dev.update(s => { s.speeds = { intervals: 14.8, threshold: 13.5, strides: 16.5, easyCeiling: 11.0 }; })); await wait(400);
let t = await text();
check('After a time trial, three easy runs at 145 or under suggest +0.2', t.includes('Try your next easy run at 10.4 km/h') && t.includes('averaged 140, 142, 144 bpm'), t.split(/SUGGESTION · EASY PACE/i)[1]);
check('It states the ceiling', t.includes('11.0 km/h'));
await click('Use 10.4');
t = await text();
check('Accepting changes upcoming easy runs to 10.4', /Easy Run\s*40 min at 10\.4 km\/h/.test(t) && !/easy pace/i.test(t), t.split('TODAY')[1]);
check('The answer is stored', (await page.evaluate(() => window.__dev.getState().alerts.filter(a => a.kind === 'easy-pace').map(a => a.status).join())) === 'accepted');
await addRuns(10.4, [146, 153, 147], 5); await wait(400);
t = await text();
check('A run at 152 or over at the new speed suggests easing back 0.2', t.includes('Ease your next easy run back to 10.2 km/h'), t.split(/SUGGESTION · EASY PACE/i)[1]);
await click('Keep 10.4');
check('Ignoring keeps the speed and clears the card until the next easy run', !/easy pace/i.test(await text()) && (await page.evaluate(() => window.__dev.getState().speeds.easy)) === 10.4);
await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} easy-pace checks passed` : `\n${results.filter(x => !x).length} of ${results.length} easy-pace checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
