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
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('art-save-sentinel', 'untouched'));
  await page.goto(new URL('/art.html', base).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  for (const value of ['house:1', 'house:2', 'house:3', 'farm:1:0', 'farm:1:2', 'farm:1:3', 'granary:1:empty', 'granary:1:mixed', 'granary:1:full', 'agora:1', 'agora:2:empty', 'agora:2:mixed', 'fountain:1', 'maintenance:1', 'lodge:1', 'woodcutter:1', 'stockpile:1:materials', 'road:straight', 'road:bend', 'road:junction', 'road:cross', 'road:stairs', 'outcrop:1', 'bush:cushion', 'bush:upright', 'bush:paired']) {
    await page.getByLabel('Model', { exact: true }).selectOption(value);
    await paint(page);
    assert.equal(await page.locator('body').getAttribute('data-model'), value);
    await page.screenshot({ path: path.join(output, `model-${value.replaceAll(':', '-')}.png`) });
    if (value.startsWith('bush:') || value.startsWith('outcrop:') || value.startsWith('road:')) {
      for (let side = 1; side < 4; side++) {
        await page.getByRole('button', { name: 'Turn model', exact: true }).click();
        await paint(page);
        await page.screenshot({ path: path.join(output, `model-${value.replaceAll(':', '-')}-side-${side}.png`) });
      }
    }
  }
  await page.getByLabel('Wireframe', { exact: true }).check();
  await page.getByRole('button', { name: 'Turn model', exact: true }).click();
  await paint(page);
  await page.screenshot({ path: path.join(output, 'wireframe.png') });
  const staticFrames = await page.evaluate(() => window.artStudy.frames);
  await paint(page, 8);
  assert.equal(await page.evaluate(() => window.artStudy.frames), staticFrames, 'Static atelier keeps rendering');
  await page.getByLabel('Wireframe', { exact: true }).uncheck();
  for (const value of ['person:jar', 'animal:boar', 'animal:rabbit', 'animal:fish', 'animal:gull', 'boat:large']) {
    await page.getByLabel('Model', { exact: true }).selectOption(value);
    await paint(page, 4);
    assert.equal(await page.locator('body').getAttribute('data-model'), value);
    assert.equal(new URL(page.url()).searchParams.get('model'), value, 'Selected model not written to the URL');
    await page.screenshot({ path: path.join(output, `model-${value.replaceAll(':', '-')}.png`) });
  }
  const stillFrames = await page.evaluate(() => window.artStudy.frames);
  await paint(page, 8);
  assert.equal(await page.evaluate(() => window.artStudy.frames), stillFrames, 'Reduced motion should keep animated models still');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready);
  assert.equal(await page.locator('body').getAttribute('data-model'), 'boat:large', 'Model selection did not survive a reload');
  await page.setViewportSize({ width: 390, height: 844 });
  await paint(page);
  await page.screenshot({ path: path.join(output, 'atelier-mobile.png') });
  assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), { 'art-save-sentinel': 'untouched' });
  assert.equal(await page.evaluate(() => Reflect.has(window, 'oikos')), false);
  assert.deepEqual(errors, []);
  console.log(`Art checks passed. Captures: ${output}`);
} finally {
  await browser.close();
}
