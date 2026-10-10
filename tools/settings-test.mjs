// Checks Settings, the weekly body-weight prompt and the evening stretch screen on screen.
// Usage: node tools/settings-test.mjs <output-folder>   (dev server running)
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 140) : ''}`); };
const text = () => page.evaluate(() => document.body.innerText);
const shot = name => wait(250).then(() => page.screenshot({ path: join(out, `settings-${name}.png`) }));
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

await page.goto('http://localhost:5173/?local&nocatchup&today=2026-10-13', { waitUntil: 'networkidle0' });
await wait(200);

// Weekly body weight
check('Body weight is asked for when none has been entered', /weekly body weight/i.test(await text()));
await page.type('input[aria-label="Body weight in kg"]', '82.4');
await click('Save');
check('Saving it removes the prompt for the week', !/weekly body weight/i.test(await text()));

// Evening stretch
await click('Evening mobility');
await click('Start 45 sec timer');
await wait(1200);
const num = await page.evaluate(() => document.querySelector('.timer-num')?.textContent);
check('Stretch timer counts down from 45', Number(num) <= 45 && Number(num) >= 42, num);
await shot('stretch');
await click('Stop');
const before = await text();
check('Mobility routine: physio movements first, then stretches, with the weekly target', /PHYSIO-PRESCRIBED[\s\S]*Prayer stretch[\s\S]*Standing side bend[\s\S]*Lumbar rock[\s\S]*THEN[\s\S]*Half-kneeling hip flexor/i.test(before) && before.includes('4–5 a week') && !before.includes("Child's pose"));
for (const s of ['Prayer stretch', 'Standing side bend', 'Lumbar rock', 'Half-kneeling', 'Seated hamstring', 'Calf against', 'Thread-the-needle', 'Side-lying']) await click(s);
check('Ticking all eight logs the day and counts 1 for the week', (await text()).includes('Routine done') && (await text()).includes('1 session'));
await click('Back');
check('Home shows the stretch as done for today', (await text()).includes('Done for today'));

// Settings
await click('Settings');
await shot('main');
check('Settings shows the saved weight', (await text()).includes('82.4 kg on'));
await click('Rest times');
await click('More Seated Dumbbell Shoulder Press rest');
check('Rest time changes in 15-second steps', (await text()).includes('3:15'));
await click('Back to settings');
await click('Gym equipment');
await click('More dumbbell step', 1); // second gym = FIFO
await shot('gyms');
check('FIFO dumbbell step can be changed', (await page.evaluate(() => window.__dev.getState().profiles.find(p => p.id === 'fifo').dumbbellStep)) === 2.5);
await click('Less dumbbell step', 1);
await click('Back to settings');
await click('Exercise swaps');
await page.select('select', 'leg_extension');
await page.evaluate(() => { const s = document.querySelectorAll('select')[1]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'goblet_squat'); s.dispatchEvent(new Event('change', { bubbles: true })); });
await wait(150);
await click('Add swap');
await shot('swaps');
await click('Back to settings');
await click('Physio findings');
await page.type('textarea', 'Example finding for the test.');
await click('Save finding');
check('Physio finding is saved with its date', (await text()).includes('Example finding for the test.'));
await click('Back to settings');

// The changes show up in a session
await click('Today');
await click('Start Gym B');
const start = await text();
check('The new FIFO swap shows on the session start screen', /Leg Extension[\s\S]{0,30}Light Raised Goblet Squat/.test(start), start.split('SWAPS AT THIS GYM')[1]);
await click('Start warm-up'); await click('Start lifting');
await click('Next exercise'); await click('Next exercise'); // past the throws and pull-up practice
check('The changed rest time is used in the session', (await text()).includes('Rest 3:15'));

await browser.close();
console.log(results.every(Boolean) ? `\nAll ${results.length} settings checks passed` : `\n${results.filter(x => !x).length} of ${results.length} settings checks FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
