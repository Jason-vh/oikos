import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(process.argv[2], { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
console.log('canvas:', await page.evaluate(() => document.querySelectorAll('canvas').length));
await page.screenshot({ path: process.argv[3] });
await browser.close();
