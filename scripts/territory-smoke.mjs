import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/territory'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  const before = await page.evaluate(() => window.oikos.state);
  const foreign = await page.evaluate(() => {
    const map = window.oikos.map;
    const island = map.islands[(map.home + 1) % map.islands.length];
    for (let z = island.z; z < island.z + island.depth - 3; z++) {
      for (let x = island.x; x < island.x + island.width - 3; x++) {
        let clear = true;
        for (let dz = 0; dz < 3; dz++) {
          for (let dx = 0; dx < 3; dx++) {
            const tile = (z + dz) * map.width + x + dx;
            if (!['grass', 'fertile', 'sand', 'scrub'].includes(map.terrain[tile]) || map.level[tile] !== map.level[z * map.width + x]) clear = false;
          }
        }
        if (clear) return { x, z };
      }
    }
    return null;
  });
  assert(foreign, 'No valid foreign construction site');
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), foreign);
  for (const tool of ['Dwelling', 'Road']) {
    await page.getByRole('button', { name: new RegExp(`^${tool},`) }).click();
    await paint(page);
    const point = await page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), foreign);
    await page.mouse.click(point.x, point.y);
    await paint(page);
    assert.match(await page.getByTestId('toast-region').textContent(), /settled island/);
    assert.deepEqual(await page.evaluate(() => window.oikos.state), before, `${tool} changed the city from another island`);
  }
  await page.screenshot({ path: path.join(output, '01-unsettled-island.png') });
  await page.keyboard.press('Escape');
  const home = await page.evaluate(() => window.oikos.plan.buildings.find((building) => building.kind === 'house'));
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), home);
  await page.getByRole('button', { name: /^Dwelling,/ }).click();
  await paint(page);
  const point = await page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), home);
  await page.mouse.click(point.x, point.y);
  await paint(page);
  assert.equal((await page.evaluate(() => window.oikos.state)).buildings.length, 1, 'Home-island construction was blocked');
  await page.screenshot({ path: path.join(output, '02-home-construction.png') });
  assert.deepEqual(errors, []);
  console.log('Territory smoke passed: foreign houses and roads refused, home construction allowed.');
} finally {
  await browser.close();
}
