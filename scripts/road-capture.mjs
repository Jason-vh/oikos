import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/roads'] = process.argv.slice(2);
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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.evaluate(() => window.oikos.advance(0));
  for (const seed of [1, 2, 8, 37]) {
    const raw = await page.evaluate(async (seed) => {
      const { createWorld, advance } = await import('/src/sim/world.ts');
      const { buildStarterNeighbourhood } = await import('/src/sim/scenario.ts');
      const { serializeWorld } = await import('/src/sim/save.ts');
      const world = createWorld(seed);
      buildStarterNeighbourhood(world);
      advance(world, 240);
      return serializeWorld(world);
    }, seed);
    await page.getByTestId('import-file').setInputFiles({ name: 'roads.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await page.waitForFunction((seed) => window.oikos.state.seed === seed && window.oikos.state.time === 240, seed);
    await page.getByRole('button', { name: /Return to village/ }).click();
    await page.mouse.move(1, 1);
    const world = await page.evaluate(() => window.oikos.state);
    const map = await page.evaluate(() => window.oikos.map);
    for (let side = 0; side < 4; side++) {
      await paint(page);
      await page.screenshot({ path: `${output}/seed-${seed}-city-${side}.png`, style: '.hud-toast-region { visibility: hidden; }' });
      await page.keyboard.press('q');
    }
    await paint(page, 10);
    const frames = await page.evaluate(() => window.oikos.frames);
    await paint(page, 20);
    assert.equal(await page.evaluate(() => window.oikos.frames), frames, 'Paused roads keep rendering');
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
  await page.mouse.move(1, 1);
  await paint(page, 5);
  const originalRoads = await page.evaluate(() => window.oikos.state.cities[0].roads);
  const before = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-before.png`, style: '#ui { visibility: hidden; }' });
  assert((await page.evaluate((tile) => window.oikos.road([tile]), candidate)).ok);
  await paint(page, 5);
  const placed = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-placed.png`, style: '#ui { visibility: hidden; }' });
  assert(!before.equals(placed), 'Road placement did not change the rendered surface');
  await page.getByRole('button', { name: /^Demolish,/ }).click();
  const point = await page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), candidate);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await paint(page, 8);
  assert.deepEqual(await page.evaluate(() => window.oikos.state.cities[0].roads), originalRoads);
  const removed = await page.locator('#app > canvas').screenshot({ path: `${output}/rebuild-removed.png`, style: '#ui { visibility: hidden; }' });
  assert(before.equals(removed), 'Demolition did not restore the original road surface and scenery');
  await page.screenshot({ path: `${output}/after-demolition.png`, style: '.hud-toast-region { visibility: hidden; }' });
  const save = await page.evaluate(async () => {
    const { serializeWorld } = await import('/src/sim/save.ts');
    return serializeWorld(window.oikos.state);
  });
  await page.goto(new URL('/art.html?model=road:junction', url).href);
  await page.waitForFunction(() => document.body.dataset.model === 'road:junction');
  await paint(page, 5);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.model === 'road:junction');
  assert.equal(await page.evaluate(() => localStorage.getItem('oikos.island.v1')), save, 'Road atelier changed the game save');
  assert.deepEqual(errors, []);
  console.log(`Road captures passed: four seeds, four sides, paused rendering, unchanged simulation, placement/demolition restores pixels, atelier save isolation. ${output}`);
} finally {
  await browser.close();
}
