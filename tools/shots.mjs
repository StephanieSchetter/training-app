// Walks a practice gym session at phone size and saves a picture of each screen.
// Usage: node tools/shots.mjs <output-folder>   (the dev server must be running)
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
await page.goto('http://localhost:5173/?local&practice', { waitUntil: 'networkidle0' });

let n = 0;
const shot = async name => { await new Promise(r => setTimeout(r, 350)); await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
const click = async (text, nth = 0) => {
  const ok = await page.evaluate((text, nth) => {
    const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(text) || b.getAttribute('aria-label') === text)[nth];
    if (!b) return false;
    b.click();
    return true;
  }, text, nth);
  if (!ok) throw new Error(`No button "${text}" on: ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`);
  await new Promise(r => setTimeout(r, 150));
};
const top = () => page.evaluate(() => window.scrollTo(0, 0));

const day = async num => {
  await page.evaluate(num => [...document.querySelectorAll('.cal-day:not(.out)')].find(b => b.querySelector('.cal-num').textContent === String(num)).click(), num);
  await new Promise(r => setTimeout(r, 150));
};
await shot('home');
await click('Calendar'); await day(14); await shot('calendar');
await click('Intervals'); await shot('run-preview'); await click('Back');
await day(15); await click('Gym C'); await shot('gym-preview'); await click('Back');
await click('Settings'); await shot('settings');
await click('Today');
await click('Gym B', 1); await shot('start');
await click('Start warm-up'); await click('Cat-cow'); await click('Thoracic'); await shot('warmup');
await click('Start lifting');
// Tuesday now opens with medicine-ball throws and pull-up practice; log those to reach the first lift
for (let i = 0; i < 3; i++) await click('Done');
await click('Next exercise');
for (let i = 0; i < 2; i++) await click('Done');
await click('Next exercise');
await click('Skip');
await shot('first-set');
for (let i = 0; i < 8; i++) await click('More Weight');
await click('Log as ramp-up');
for (let i = 0; i < 2; i++) await click('More Weight');
await click('2', 0); await shot('ready-to-log');
await click('Done'); await shot('resting');
await click('Done'); await click('Done'); await click('Skip'); await shot('exercise-done');
await page.evaluate(() => window.scrollTo(0, 9999)); await shot('full-plan');
await top(); await click('Next exercise'); await shot('machine-question');
await click('5'); await click('Next exercise'); await shot('each-side');
await click('Swap'); await shot('swap-sheet'); await click('Cancel');
await click('Next exercise'); await click('5'); await click('Next exercise'); await click('2.5');
for (let i = 0; i < 4; i++) await click('More Weight');
await click('Done'); await shot('pair-a2');
await click('Next exercise'); await shot('leg-raise');
await click('Finish'); await shot('summary');
await click('Finish session'); await shot('home-after');
await browser.close();
console.log(`${n} pictures saved to ${out}`);
