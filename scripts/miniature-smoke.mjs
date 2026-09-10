import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:5180/miniature.html', output = '/tmp/zeus-miniature'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('miniature-sentinel', 'untouched'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  assert.deepEqual(errors, []);
  const canvas = page.locator('canvas');
  const harbour = await canvas.screenshot();
  assert(harbour.equals(await canvas.screenshot()), 'Reduced motion did not freeze the scene');
  await page.screenshot({ path: `${output}/harbour.png` });
  for (const [name, view] of [['Streets', 'streets'], ['Archipelago', 'islands']]) {
    await page.getByRole('button', { name, exact: true }).click();
    assert.equal(await page.locator('body').getAttribute('data-view'), view);
    assert(!harbour.equals(await canvas.screenshot()), `${name} did not change camera`);
    await page.screenshot({ path: `${output}/${view}.png` });
  }
  await page.getByRole('button', { name: 'Harbour', exact: true }).click();
  assert(harbour.equals(await canvas.screenshot()), 'Camera preset was not deterministic');
  await page.getByRole('button', { name: 'Golden hour', exact: true }).click();
  assert(!harbour.equals(await canvas.screenshot()), 'Lighting did not change');
  await page.screenshot({ path: `${output}/golden.png` });
  await page.getByRole('button', { name: 'Golden hour', exact: true }).click();
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(1000, 520, { steps: 12 });
  await page.mouse.up();
  assert(!harbour.equals(await canvas.screenshot()), 'Orbit did not change camera');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  assert(harbour.equals(await canvas.screenshot()), 'Reset did not restore the camera after orbit');
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, -400);
  assert(!harbour.equals(await canvas.screenshot()), 'Zoom did not change camera');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByRole('button', { name: 'Resume life', exact: true }).click();
  const animated = await canvas.screenshot();
  assert(!animated.equals(await canvas.screenshot()), 'Animation did not advance');
  await page.getByRole('button', { name: 'Pause life', exact: true }).click();
  const paused = await canvas.screenshot();
  assert(paused.equals(await canvas.screenshot()), 'Pause did not freeze the scene');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), { 'miniature-sentinel': 'untouched' });
  assert.equal(await page.evaluate(() => Reflect.has(window, 'game')), false);
  assert.deepEqual(errors, []);
  console.log(`Miniature passed: rendering, camera presets, orbit, zoom, lighting, animation, reduced motion, mobile, save isolation. Screenshots: ${output}`);
} finally {
  await browser.close();
}
