import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openSandbox, paint, settle } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/coast', ...requestedSeeds] = process.argv.slice(2);
const seeds = requestedSeeds.length ? requestedSeeds.map(Number) : [1, 2, 8, 37];
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  const errors = [];
  const page = await openSandbox(browser, base, { errors });
  for (const seed of seeds) {
    await settle(page, seed);
    const map = await page.evaluate(() => window.oikos.map);
    const state = await page.evaluate(() => window.oikos.state);
    assert.equal(state.seed, seed);
    assert.equal(state.cities[0].buildings.length, 0);
    for (let side = 0; side < 4; side++) {
      await paint(page);
      await page.screenshot({ path: `${output}/seed-${seed}-side-${side}.png` });
      await page.keyboard.press('q');
    }
    await page.keyboard.press('g');
    await paint(page);
    await page.screenshot({ path: `${output}/seed-${seed}-grid.png` });
    await page.keyboard.press('g');
    await paint(page, 20);
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page, 20);
    assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'A still coast keeps rendering');
    assert.deepEqual(await page.evaluate(() => window.oikos.map), map, 'Viewing the coast changed the logical terrain');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), state, 'Viewing the coast changed the city');
  }
  await settle(page, 1, { plan: true, seconds: 240 });
  await page.evaluate(() => window.oikos.home());
  await paint(page, 3);
  await page.screenshot({ path: `${output}/village.png` });
  assert.deepEqual(errors, []);
  console.log(`Coast captures passed: seeds ${seeds.join(', ')}, four sides, grid, idle rendering, unchanged simulation. ${output}`);
} finally {
  await browser.close();
}
