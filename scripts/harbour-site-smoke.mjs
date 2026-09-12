import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug'] = process.argv.slice(2);
const browser = await chromium.launch();
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  const original = await page.evaluate(() => window.oikos.state);
  await page.getByRole('button', { name: /^Demolish,/ }).click();
  for (const tile of original.roads) {
    const point = await page.evaluate((index) => {
      const width = window.oikos.map.width;
      return window.oikos.projectTile(index % width, Math.floor(index / width));
    }, tile);
    await page.mouse.click(point.x, point.y);
    await paint(page);
  }
  assert.equal((await page.evaluate(() => window.oikos.state)).roads.length, 0);
  await page.keyboard.press('Escape');
  await page.getByTestId('menu').click();
  await page.getByTestId('save').click();
  await paint(page);
  const saved = await page.evaluate(() => window.oikos.state);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  const loaded = await page.evaluate(() => window.oikos.state);
  assert.equal(loaded.harbour.x, original.harbour.x, 'Harbour moved horizontally on reload');
  assert.equal(loaded.harbour.z, original.harbour.z, 'Harbour moved vertically on reload');
  assert.equal(loaded.harbour.connected, false);
  assert.deepEqual(loaded.roads, saved.roads);
  assert.equal(loaded.money, saved.money);
  assert.deepEqual(errors, []);
  console.log('Harbour site smoke passed: removing the entry road cannot move the saved harbour.');
} finally {
  await browser.close();
}
