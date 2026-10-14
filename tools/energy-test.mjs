// Checks the calorie features on screen: the morning weigh-in with optional protein, Garmin's estimate
// while data builds up, the measured maintenance once there is enough, and the Progress charts.
// Usage: node tools/energy-test.mjs   (dev server running)
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
const shot = async name => { if (out) { await wait(300); await page.screenshot({ path: join(out, `energy-${name}.png`) }); } };
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
const seed = (n, end, withWeights) => page.evaluate((n, end, withWeights) => window.__dev.update(s => {
  for (let i = 1; i <= n; i++) {
    const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i); const date = d.toISOString().slice(0, 10);
    s.garminDays[date] = { ...(s.garminDays[date] ?? { date, restingHr: 46, hrv: 40, sleepHours: 7.5, sleepScore: 85, readiness: 80, trainingLoad: null }), steps: 12000, kcalOut: 3000, kcalIn: 2600 };
    if (withWeights) s.weights = [...s.weights.filter(w => w.date !== date), { date, kg: Math.round((96 + 0.05 * i + (i % 2 ? 0.2 : -0.2)) * 10) / 10 }];
  }
}), n, end, withWeights);

await on('2026-10-15');
await seed(4, '2026-10-15', false);
await wait(300);
let t = await text();
check('Morning weigh-in card with optional protein', /MORNING WEIGH-IN/i.test(t) && await page.$('input[aria-label="Yesterday\'s protein in grams"]') !== null);
check("Before enough data: Garmin's estimate, labelled", t.includes("Maintenance about 3,000 kcal a day (Garmin's estimate for now)") && t.includes('So far: 4 full days logged, 0 weigh-ins'), t.split(/CALORIES · FROM YOUR DATA/i)[1]?.slice(0, 300));
await page.type('input[aria-label="Body weight in kg"]', '96.1');
await page.type('input[aria-label="Yesterday\'s protein in grams"]', '180');
await click('Save');
check('Weight and yesterday\'s protein are saved', await page.evaluate(() => { const s = window.__dev.getState(); return s.weights.some(w => w.date === '2026-10-15' && w.kg === 96.1) && s.nutrition.protein['2026-10-14'] === 180; }));
t = await text();
check('Targets appear once there is a weight: lose / maintain / build, and protein', /LOSE FAT\s*2,4\d0/.test(t) && /MAINTAIN\s*3,000/.test(t) && /BUILD MUSCLE\s*3,2\d0/.test(t) && t.includes('Protein: about 190 g a day'), t.split(/CALORIES · FROM YOUR DATA/i)[1]?.slice(0, 500));

// Four weeks later, with daily weigh-ins: losing 0.35 kg a week on 2,600 a day -> about 2,985
await on('2026-11-12');
await seed(28, '2026-11-12', true);
await wait(400);
t = await text();
const card = t.split(/CALORIES · FROM YOUR DATA/i)[1]?.slice(0, 600) ?? '';
check('Measured maintenance from weight trend and food', /Maintenance about 2,9[5-9]0 kcal a day\n/.test(card) && card.includes('Likely between') && card.includes("Garmin's estimate for the same days was 3,000"), card);
check('Last 7 days shown against the targets', card.includes('Last 7 days: 2,600 kcal a day on average (7 logged)'));
await click('Progress');
t = await text();
check('Progress has daily weight with trend, and calories eaten against burned', /WEIGHT AND CALORIES/i.test(t) && t.includes('Daily weight') && t.includes("Eaten (MyFitnessPal, through Garmin) against Garmin's burn estimate"));

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} calorie checks passed` : `\n${results.filter(x => !x).length} of ${results.length} calorie checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
