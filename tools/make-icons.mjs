// Renders public/icon.svg into the PNG sizes Android needs for the home-screen icon.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.12]]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#0c1014;display:grid;place-items:center;height:100vh"><div style="width:${100 - pad * 200}%">${svg}</div></body>`);
  await page.screenshot({ path: `public/${name}.png` });
}
await browser.close();
console.log('Icons written');
