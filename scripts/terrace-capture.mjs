import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openSandbox, paint } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/terraces'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  const errors = [];
  const page = await openSandbox(browser, base, { errors });
  const crossing = await page.evaluate(async () => {
    const { islandFor, fractal } = await import('/src/sim/island.ts');
    const { placeRoadPath } = await import('/src/sim/world.ts');
    const { stairLayout } = await import('/src/sim/stairs.ts');
    const state = window.oikos.state;
    const map = islandFor(state.seed);
    const candidates = [];
    for (let z = 1; z < map.depth - 1; z++) {
      for (let x = 1; x < map.width - 1; x++) {
        const index = z * map.width + x;
        if (map.terrain[index] !== 'cliff' || map.level[index] !== 1) continue;
        if (fractal(x, z, map.seed + 967, 2, 4) <= .59) continue;
        if (fractal(x * 3.7 + 20, z * 2.9 - 20, map.seed + 20, 1, 1) <= .45) continue;
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          if (map.level[(z + dz) * map.width + x + dx] !== 0) continue;
          const tiles = [{ x: x + dx, z: z + dz }, { x, z }, { x: x - dx, z: z - dz }];
          if (tiles.some((tile) => state.cities[0].roads.includes(tile.z * map.width + tile.x) || map.terrain[tile.z * map.width + tile.x] === 'forest')) continue;
          const prospective = structuredClone(state);
          if (!placeRoadPath(prospective, prospective.cities[0], tiles).ok) continue;
          if (stairLayout(map, new Set(prospective.cities[0].roads)).get(index)?.down !== tiles[0].z * map.width + tiles[0].x) continue;
          candidates.push(tiles);
        }
      }
    }
    candidates.sort((a, b) => {
      const distance = (tile) => Math.hypot(tile.x - map.entry.x, tile.z - map.entry.z + 10);
      return distance(a[1]) - distance(b[1]);
    });
    return candidates[0];
  });
  assert(crossing, 'No legal decorated terrace crossing');
  const [foot, stair, landing] = crossing;
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), stair);
  const originalRoads = await page.evaluate(() => window.oikos.state.cities[0].roads);
  const originalMap = await page.evaluate(() => window.oikos.map);
  let bare;
  for (const phase of ['bare', 'stairs']) {
    if (phase === 'stairs') {
      const before = await page.evaluate(() => window.oikos.state);
      assert.equal((await page.evaluate((tiles) => window.oikos.previewRoad(tiles), crossing)).ok, true);
      await paint(page);
      assert.deepEqual(await page.evaluate(() => window.oikos.state), before, 'Preview changed simulation');
      await page.screenshot({ path: `${output}/stairs-preview.png` });
      await page.evaluate(() => window.oikos.hidePreview());
      assert.equal((await page.evaluate((tiles) => window.oikos.road(tiles), crossing)).ok, true);
    }
    const state = await page.evaluate(() => window.oikos.state);
    for (let side = 0; side < 4; side++) {
      await paint(page);
      await page.screenshot({ path: `${output}/${phase}-side-${side}.png` });
      await page.keyboard.press('q');
    }
    await paint(page, 20);
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page, 20);
    assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'Still terraces keep rendering');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), state, 'Viewing terraces changed the city');
    if (phase === 'bare') bare = await page.locator('#app > canvas').screenshot();
  }
  const beforeRejected = await page.evaluate(() => window.oikos.state);
  const dx = foot.x - stair.x;
  const dz = foot.z - stair.z;
  const side = { x: stair.x + dz, z: stair.z - dx };
  assert.equal((await page.evaluate((tile) => window.oikos.road([tile]), side)).ok, false, 'Stairs accepted a side-road entrance');
  assert.deepEqual(await page.evaluate(() => window.oikos.state), beforeRejected, 'Rejected side road changed the city');
  await page.evaluate(({ x, z }) => window.oikos.previewDemolition(x, z), stair);
  await paint(page);
  await page.screenshot({ path: `${output}/stairs-demolition-preview.png` });
  await page.evaluate(() => window.oikos.hidePreview());
  for (const tile of [stair, landing, foot]) {
    await page.evaluate(({ x, z }) => window.oikos.demolish(x, z), tile);
    await paint(page);
  }
  await paint(page, 8);
  assert.deepEqual(await page.evaluate(() => window.oikos.state.cities[0].roads), originalRoads, 'Demolition removed the wrong tile');
  assert.deepEqual(await page.evaluate(() => window.oikos.map), originalMap, 'Stairs mutated the island');
  const restored = await page.locator('#app > canvas').screenshot({ path: `${output}/restored.png` });
  assert(bare.equals(restored), 'Demolition did not restore the exact cliffs and outcrops');
  assert((await page.evaluate((tiles) => window.oikos.road(tiles), crossing)).ok);
  const roundTrip = await page.evaluate(async () => {
    const { serializeWorld, deserializeWorld } = await import('/src/sim/save.ts');
    const state = window.oikos.state;
    return { state, restored: deserializeWorld(serializeWorld(state)) };
  });
  assert.deepEqual(roundTrip.restored, roundTrip.state, 'Stair save did not round-trip');
  await page.mouse.move(800, 500);
  for (let zoom = 0; zoom < 6; zoom++) {
    await page.mouse.wheel(0, -900);
    await paint(page);
  }
  for (let side = 0; side < 4; side++) {
    await paint(page);
    await page.screenshot({ path: `${output}/stairs-close-${side}.png` });
    await page.keyboard.press('q');
  }
  assert.deepEqual(errors, []);
  console.log(`Terrace captures passed: four sides, full-cell stairs, drag preview, blocked side entry, exact terrain restoration, save round-trip and idle rendering. ${output}`);
} finally {
  await browser.close();
}
