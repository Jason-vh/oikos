import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/terraces'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, frames = 3) => page.evaluate((count) => new Promise((resolve) => {
  function frame() {
    if (--count === 0) resolve();
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}), frames);
const pointAt = (page, tile) => page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), tile);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.evaluate(() => window.oikos.advance(0));
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
      await page.getByRole('button', { name: /^Road,/ }).click();
      const start = await pointAt(page, foot);
      const end = await pointAt(page, landing);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 4 });
      await paint(page);
      assert.deepEqual(await page.evaluate(() => window.oikos.state), before, 'Preview changed simulation');
      await page.screenshot({ path: `${output}/stairs-preview.png`, style: '.hud-toast-region { visibility: hidden; }' });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      const roads = await page.evaluate(() => window.oikos.state.cities[0].roads);
      for (const tile of crossing) assert(roads.includes(tile.z * originalMap.width + tile.x), 'Stair drag failed');
    }
    const state = await page.evaluate(() => window.oikos.state);
    for (let side = 0; side < 4; side++) {
      await paint(page);
      await page.screenshot({ path: `${output}/${phase}-side-${side}.png`, style: '.hud-toast-region { visibility: hidden; }' });
      await page.keyboard.press('q');
    }
    await paint(page, 8);
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page, 12);
    assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'Paused terraces keep rendering');
    assert.deepEqual(await page.evaluate(() => window.oikos.state), state, 'Viewing terraces changed the city');
    if (phase === 'bare') bare = await page.locator('#app > canvas').screenshot({ style: '#ui { visibility: hidden; }' });
  }
  const beforeRejected = await page.evaluate(() => window.oikos.state);
  const dx = foot.x - stair.x;
  const dz = foot.z - stair.z;
  const side = { x: stair.x + dz, z: stair.z - dx };
  assert.equal((await page.evaluate((tile) => window.oikos.road([tile]), side)).ok, false, 'Stairs accepted a side-road entrance');
  assert.deepEqual(await page.evaluate(() => window.oikos.state), beforeRejected, 'Rejected side road changed the city');
  await page.getByRole('button', { name: /^Demolish,/ }).click();
  const centre = await pointAt(page, stair);
  await page.mouse.move(centre.x, centre.y);
  await paint(page);
  await page.screenshot({ path: `${output}/stairs-demolition-preview.png`, style: '.hud-toast-region { visibility: hidden; }' });
  for (const tile of [stair, landing, foot]) {
    const point = await pointAt(page, tile);
    await page.mouse.click(point.x, point.y);
    await paint(page);
  }
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await paint(page, 8);
  assert.deepEqual(await page.evaluate(() => window.oikos.state.cities[0].roads), originalRoads, 'Demolition picked the wrong tile');
  assert.deepEqual(await page.evaluate(() => window.oikos.map), originalMap, 'Stairs mutated the island');
  const restored = await page.locator('#app > canvas').screenshot({ path: `${output}/restored.png`, style: '#ui { visibility: hidden; }' });
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
    await page.screenshot({ path: `${output}/stairs-close-${side}.png`, style: '.hud-toast-region { visibility: hidden; }' });
    await page.keyboard.press('q');
  }
  assert.deepEqual(errors, []);
  console.log(`Terrace captures passed: four sides, full-cell stairs, drag preview, blocked side entry, correct demolition picking, exact terrain restoration, save round-trip and paused rendering. ${output}`);
} finally {
  await browser.close();
}
