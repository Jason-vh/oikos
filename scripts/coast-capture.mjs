import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/coast', ...requestedSeeds] = process.argv.slice(2);
const seeds = requestedSeeds.length ? requestedSeeds.map(Number) : [1, 2, 8, 37];
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, frames = 35) => page.evaluate((count) => new Promise((resolve) => {
  function frame() {
    if (--count === 0) resolve();
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}), frames);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  for (const seed of seeds) {
    const raw = await page.evaluate(async (value) => {
      const { createWorld } = await import('/src/sim/world.ts');
      const { serializeWorld } = await import('/src/sim/save.ts');
      return serializeWorld(createWorld(value));
    }, seed);
    await page.getByTestId('import-file').setInputFiles({ name: 'coast.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await page.waitForFunction((value) => window.oikos.state.seed === value && window.oikos.state.time === 0, seed);
    const map = await page.evaluate(() => window.oikos.map);
    const state = await page.evaluate(() => window.oikos.state);
    assert.equal(state.seed, seed);
    assert.equal(state.buildings.length, 0);
    for (let side = 0; side < 4; side++) {
      await paint(page, 3);
      await page.screenshot({ path: `${output}/seed-${seed}-side-${side}.png`, style: '.hud-toast-region { visibility: hidden; }' });
      await page.keyboard.press('q');
    }
    await page.keyboard.press('g');
    await paint(page, 3);
    await page.screenshot({ path: `${output}/seed-${seed}-grid.png`, style: '.hud-toast-region { visibility: hidden; }' });
    await page.keyboard.press('g');
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page);
    const settledFrames = await page.evaluate(() => window.oikos.frames);
    await paint(page);
    assert.equal(await page.evaluate(() => window.oikos.frames), settledFrames, 'Paused coast keeps rendering');
    assert(settledFrames >= frames);
    assert.deepEqual(await page.evaluate(() => window.oikos.map), map, 'Viewing the coast changed the logical terrain');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), state, 'Viewing the coast changed the city');
    if (seed === 1) {
      await page.evaluate(() => { window.oikos.buildPlan(); window.oikos.advance(240); });
      await page.getByRole('button', { name: /Return to village/ }).click();
      await paint(page, 3);
      await page.screenshot({ path: `${output}/village.png`, style: '.hud-toast-region { visibility: hidden; }' });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Coast captures passed: seeds ${seeds.join(', ')}, four sides, grid, paused rendering, unchanged simulation. ${output}`);
} finally {
  await browser.close();
}
