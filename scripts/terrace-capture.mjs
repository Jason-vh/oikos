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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.evaluate(() => window.oikos.advance(0));
  const crossing = await page.evaluate(async () => {
    const { islandFor, fractal } = await import('/src/sim/island.ts');
    const { placeRoadPath } = await import('/src/sim/world.ts');
    const state = window.oikos.state;
    const map = islandFor(state.seed);
    const candidates = [];
    for (let z = 1; z < map.depth - 1; z++) {
      for (let x = 1; x < map.width - 1; x++) {
        const index = z * map.width + x;
        if (map.terrain[index] !== 'cliff' || map.level[index] !== 1) continue;
        if (fractal(x, z, map.seed + 967, 2, 4) <= .59) continue;
        if (fractal(x * 3.7 + 20, z * 2.9 - 20, map.seed + 20, 1, 1) <= .45) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (map.level[(z + dz) * map.width + x + dx] !== 0) continue;
          const tiles = [{ x, z }, { x: x + dx, z: z + dz }];
          if (placeRoadPath(structuredClone(state), tiles).ok) candidates.push(tiles);
        }
      }
    }
    candidates.sort((a, b) => {
      const distance = (tile) => Math.hypot(tile.x - map.entry.x, tile.z - map.entry.z + 10);
      return distance(a[0]) - distance(b[0]);
    });
    return candidates[0];
  });
  assert(crossing, 'No legal decorated terrace crossing');
  await page.evaluate(([tile]) => window.oikos.focusTile(tile.x, tile.z), crossing);
  for (const phase of ['bare', 'stairs']) {
    if (phase === 'stairs') assert((await page.evaluate((tiles) => window.oikos.road(tiles), crossing)).ok);
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
  }
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, -600);
  await paint(page, 20);
  await page.screenshot({ path: `${output}/stairs-close.png`, style: '.hud-toast-region { visibility: hidden; }' });
  assert.deepEqual(errors, []);
  console.log(`Terrace captures passed: four sides, stairs through an outcrop, paused rendering, unchanged simulation. ${output}`);
} finally {
  await browser.close();
}
