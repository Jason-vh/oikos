import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:5182/pipeline/bench.html', out = '/tmp/zeus-house-proof/bench.png', atlasDirectory] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (atlasDirectory) {
    for (const extension of ['json', 'png']) {
      await page.route(`**/assets/structures.${extension}`, (route) => route.fulfill({ path: path.resolve(atlasDirectory, `structures.${extension}`) }));
    }
  }
  await page.addInitScript(() => localStorage.setItem('art-bench-sentinel', 'keep'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true', await page.locator('#error').textContent());
  assert.equal(await page.evaluate(() => Reflect.has(window, 'game')), false);
  const initial = await page.locator('canvas').screenshot();
  assert(initial.equals(await page.locator('canvas').screenshot()), 'The paused bench changed between captures');
  await page.getByRole('button', { name: 'Switch orientation' }).click();
  assert(!initial.equals(await page.locator('canvas').screenshot()), 'Orientation did not change');
  await page.getByRole('button', { name: 'Switch orientation' }).click();
  assert(initial.equals(await page.locator('canvas').screenshot()), 'Returning to the original orientation was not deterministic');
  await page.getByRole('button', { name: 'Toggle overlay' }).click();
  assert(!initial.equals(await page.locator('canvas').screenshot()), 'Overlay did not change');
  await page.getByRole('button', { name: 'Toggle overlay' }).click();
  await page.getByLabel('Enlargement').selectOption('3');
  await page.getByLabel('Enlargement').selectOption('2');
  assert(initial.equals(await page.locator('canvas').screenshot()), 'Zoom round-trip changed the render');
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), { 'art-bench-sentinel': 'keep' });
  assert.deepEqual(errors, []);
  await mkdir(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: true });
  if (await page.locator('body').getAttribute('data-ai-study') === 'true') {
    assert.match(await page.locator('#study-note').textContent(), /proportions unchanged/);
    assert.equal(await page.locator('body').getAttribute('data-ai-sampling'), 'high-resolution');
    const canvasBounds = await page.locator('canvas').boundingBox();
    const leftPanels = { ...canvasBounds, width: 760 };
    const unchanged = await page.screenshot({ clip: leftPanels });
    await page.getByLabel('AI sampling').selectOption('pixel-density');
    assert.equal(await page.locator('body').getAttribute('data-ai-sampling'), 'pixel-density');
    assert(!initial.equals(await page.locator('canvas').screenshot()), 'AI sampling did not change the enlarged image');
    assert.deepEqual(await page.locator('canvas').boundingBox(), canvasBounds);
    assert(unchanged.equals(await page.screenshot({ clip: leftPanels })), 'AI sampling changed the original or replacement');
    await page.getByLabel('AI sampling').selectOption('high-resolution');
    assert(initial.equals(await page.locator('canvas').screenshot()), 'AI sampling round-trip changed the render');
    await page.getByLabel('Enlargement').selectOption('1');
    const native = await page.locator('canvas').screenshot();
    await page.getByLabel('AI sampling').selectOption('pixel-density');
    await page.getByLabel('AI sampling').selectOption('high-resolution');
    assert(native.equals(await page.locator('canvas').screenshot()), 'Native sampling round-trip changed the render');
    await page.getByLabel('Enlargement').selectOption('4');
    await page.getByLabel('Enlargement').selectOption('2');
    assert(initial.equals(await page.locator('canvas').screenshot()), 'High-resolution zoom round-trip changed the render');
    await page.route('**/reference/studies/ai-house.json', (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
    assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
    assert.match(await page.locator('#study-note').textContent(), /not loaded/);
  }
  console.log(`Art bench passed: deterministic pixels, orientation, overlay, zoom, no game/save side effects. ${out}`);
} finally {
  await browser.close();
}
