// Checks a machine whose weight step changes part-way up the stack (5 kg steps to 60, then 10s): the
// first-use question, the plus/minus buttons on the set screen, and the Settings editor.
// Usage: node tools/stack-test.mjs [output-folder]   (dev server running)
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
const weight = () => page.evaluate(() => document.querySelector('.stepper input, .stepper .num')?.value ?? document.querySelector('.stepper .num')?.textContent);
const row = () => page.evaluate(() => JSON.stringify(window.__dev.getState().profiles.find(p => p.id === 'fifo')));

// Tuesday at Port Hedland: Gym B, where the row is the plate-loaded machine
await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-13', { waitUntil: 'networkidle0' }); await wait(250);
await click('Start Gym B'); await click('Start warm-up'); await click('Start lifting');
await click('Next exercise'); await click('Next exercise');   // past the throws and pull-up practice
await click('Next exercise');                                  // past the shoulder press, to the row machine
let t = await text();
check('The machine question offers a step that changes higher up', /smallest weight jump/i.test(t) && t.includes('The step changes higher up the stack'), t.slice(0, 200));
await click('The step changes higher up the stack');
await click('5');
check('Choosing a step no longer saves straight away', (await text()).includes('Save and continue') && !JSON.parse(await row()).machineSteps.iso_row);
await page.type('input[aria-label="Step changes from"]', '60');
await page.type('input[aria-label="Step above that"]', '10');
await shot('question');
await click('Save and continue');
const saved = JSON.parse(await row());
check('Both parts are stored for this gym', saved.machineSteps.iso_row === 5 && saved.machineChange?.iso_row?.from === 60 && saved.machineChange?.iso_row?.step === 10, JSON.stringify(saved.machineChange));

const seen = [];
for (let i = 0; i < 14; i++) { await click('More Weight'); seen.push(Number(await weight())); }
check('Plus goes up in 5s to 60, then in 10s', seen.join() === '5,10,15,20,25,30,35,40,45,50,55,60,70,80', seen.join());
await click('Less Weight'); await click('Less Weight'); await click('Less Weight');
check('Minus comes back down the same way', Number(await weight()) === 55, await weight());
await shot('set-screen');

// Log a top set of 60 x 10, then check next week's suggestion crosses the change by one pin
for (let i = 0; i < 1; i++) await click('More Weight');
check('Back at 60', Number(await weight()) === 60);

await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-13', { waitUntil: 'networkidle0' }); await wait(250);
await page.evaluate(() => window.__dev.update(s => { s.activeSessionId = null; })); await wait(200);   // step out of the open session
await click('Settings'); await click('Gym equipment');
t = await text();
check('Settings shows the machine with its change point', /Iso-Lateral Row/i.test(t) && await page.evaluate(() => [...document.querySelectorAll('input')].some(i => i.getAttribute('aria-label')?.includes('step changes at') && i.value === '60')));
await shot('settings');
// Clearing both boxes makes it an even stack again
for (const label of ['step changes at', 'step above that']) {
  const sel = `input[aria-label*="${label}"]`;
  await page.evaluate(sel => { const el = document.querySelector(sel); el.focus(); el.select(); }, sel); await page.keyboard.press('Backspace'); await page.keyboard.press('Tab'); await wait(200);
}
check('Clearing both boxes removes the change', !JSON.parse(await row()).machineChange?.iso_row, await row());

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} stack checks passed` : `\n${results.filter(x => !x).length} of ${results.length} stack checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
