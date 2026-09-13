import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openSandbox, paint, settle } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/roads'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  const errors = [];
  const page = await openSandbox(browser, base, { errors });
  for (const seed of [1, 2, 8, 37]) {
    await settle(page, seed, { plan: true, seconds: 240 });
    await page.evaluate(() => window.oikos.home());
    const world = await page.evaluate(() => window.oikos.state);
    const map = await page.evaluate(() => window.oikos.map);
    for (let side = 0; side < 4; side++) {
      await paint(page);
      await page.screenshot({ path: `${output}/seed-${seed}-city-${side}.png` });
      await page.keyboard.press('q');
    }
    await paint(page, 20);
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page, 20);
    assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'A still street keeps rendering');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), world, 'Viewing roads changed the city');
    assert.deepEqual(await page.evaluate(() => window.oikos.map), map, 'Viewing roads changed the map');
  }
  const candidate = await page.evaluate(async () => {
    const { placement } = await import('/src/sim/world.ts');
    const { islandFor, tileAtOn, groundHeight } = await import('/src/sim/island.ts');
    const world = window.oikos.state;
    const city = world.cities[0];
    const map = islandFor(world.seed);
    for (const index of city.roads) {
      const tile = tileAtOn(map, index);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: tile.x + dx, z: tile.z + dz };
        if (city.roads.includes(next.z * map.width + next.x)) continue;
        if (groundHeight(map, tile.x, tile.z) !== groundHeight(map, next.x, next.z)) continue;
        if (placement(world, city, 'road', next.x, next.z).ok) return next;
      }
    }
  });
  assert(candidate, 'No spare tile for road rebuild check');
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), candidate);
  await paint(page, 5);
  const originalRoads = await page.evaluate(() => window.oikos.state.cities[0].roads);
  const before = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-before.png` });
  assert((await page.evaluate((tile) => window.oikos.road([tile]), candidate)).ok);
  await paint(page, 5);
  const placed = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-placed.png` });
  assert(!before.equals(placed), 'Road placement did not change the rendered surface');
  await page.evaluate(({ x, z }) => window.oikos.previewDemolition(x, z), candidate);
  await paint(page);
  await page.screenshot({ path: `${output}/demolition-preview.png` });
  await page.evaluate(({ x, z }) => window.oikos.demolish(x, z), candidate);
  await page.evaluate(() => window.oikos.hidePreview());
  await paint(page, 8);
  assert.deepEqual(await page.evaluate(() => window.oikos.state.cities[0].roads), originalRoads);
  const removed = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-removed.png` });
  assert(before.equals(removed), 'Demolition did not restore the original road surface and scenery');
  assert.deepEqual(errors, []);
  console.log(`Road captures passed: four seeds, four sides, idle rendering, unchanged simulation, placement and demolition restore pixels. ${output}`);
} finally {
  await browser.close();
}
