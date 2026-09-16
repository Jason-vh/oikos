import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchGameBrowser, openSandbox, paint, settle } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/sea'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await launchGameBrowser();
const errors = [];
const page = await openSandbox(browser, base, { reducedMotion: 'no-preference', errors });

try {
  await settle(page, 1, { seconds: 30 });
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const water = await page.evaluate(() => {
    const { entry } = window.oikos.map;
    for (let away = 6; away < 40; away++) {
      const tile = { x: entry.x, z: entry.z - away };
      if (window.oikos.terrainAt(tile.x, tile.z) === 'water') return tile;
    }
    return entry;
  });
  await page.evaluate((tile) => window.oikos.focusTile(tile.x, tile.z), water);
  await paint(page, 24);
  await page.screenshot({ path: path.join(output, 'open-water.png') });

  for (let step = 0; step < 6; step++) {
    await page.mouse.wheel(0, 200);
    await paint(page, 2);
  }
  await paint(page, 24);
  await page.screenshot({ path: path.join(output, 'wider.png') });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log('captured', output);
} finally {
  await browser.close();
}
