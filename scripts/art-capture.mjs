import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:5180', output = 'artifacts/art'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, count = 2) => page.evaluate((frames) => new Promise((resolve) => {
  const next = () => { if (--frames <= 0) resolve(null); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);
const cameraEqual = (a, b) => a.every((value, index) => Math.abs(value - b[index]) < 1e-8);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('art-save-sentinel', 'untouched'));
  await page.goto(new URL('/miniature.html', base).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  assert.deepEqual(errors, []);
  const camera = await page.evaluate(() => window.artStudy.camera);
  for (const [name, file] of [['Harbour', 'harbour'], ['Streets', 'streets'], ['Archipelago', 'archipelago']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await paint(page);
    await page.screenshot({ path: path.join(output, `${file}.png`) });
  }
  await page.getByRole('button', { name: 'Harbour', exact: true }).click();
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(1000, 510, { steps: 6 });
  await page.mouse.up();
  assert(!cameraEqual(camera, await page.evaluate(() => window.artStudy.camera)));
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await paint(page);
  assert(cameraEqual(camera, await page.evaluate(() => window.artStudy.camera)), 'Camera reset did not restore the preset');
  const frames = await page.evaluate(() => window.artStudy.frames);
  await paint(page, 8);
  assert.equal(await page.evaluate(() => window.artStudy.frames), frames, 'Paused benchmark still renders continuously');
  await page.getByRole('button', { name: 'Golden hour', exact: true }).click();
  await paint(page);
  await page.screenshot({ path: path.join(output, 'golden-hour.png') });
  await page.getByRole('button', { name: 'Resume life', exact: true }).click();
  await paint(page, 8);
  assert((await page.evaluate(() => window.artStudy.frames)) > frames, 'Animation did not resume');
  await page.getByRole('button', { name: 'Pause life', exact: true }).click();
  await page.goto(new URL('/art.html', base).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  for (const value of ['house:1', 'house:2', 'house:3', 'farm:1', 'granary:1', 'agora:1', 'agora:2', 'fountain:1', 'maintenance:1']) {
    await page.getByLabel('Model', { exact: true }).selectOption(value);
    await paint(page);
    assert.equal(await page.locator('body').getAttribute('data-model'), value);
    await page.screenshot({ path: path.join(output, `model-${value.replace(':', '-')}.png`) });
  }
  await page.getByLabel('Wireframe', { exact: true }).check();
  await page.getByRole('button', { name: 'Turn model', exact: true }).click();
  await paint(page);
  await page.screenshot({ path: path.join(output, 'wireframe.png') });
  const staticFrames = await page.evaluate(() => window.artStudy.frames);
  await paint(page, 8);
  assert.equal(await page.evaluate(() => window.artStudy.frames), staticFrames, 'Static atelier keeps rendering');
  await page.setViewportSize({ width: 390, height: 844 });
  await paint(page);
  await page.screenshot({ path: path.join(output, 'atelier-mobile.png') });
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), { 'art-save-sentinel': 'untouched' });
  assert.equal(await page.evaluate(() => Reflect.has(window, 'thalassa')), false);
  assert.deepEqual(errors, []);
  console.log(`Art checks passed. Captures: ${output}`);
} finally {
  await browser.close();
}
