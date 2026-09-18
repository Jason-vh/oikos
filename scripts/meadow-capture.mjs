import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchGameBrowser, openSandbox, paint, settle } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/meadow'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await launchGameBrowser();
const page = await openSandbox(browser, base);

try {
  await settle(page, 1, { plan: true, seconds: 120 });
  const patch = await page.evaluate(() => {
    const map = window.oikos.map;
    let best = null;
    for (let z = 2; z < map.depth - 2; z++) {
      for (let x = 2; x < map.width - 2; x++) {
        let fertile = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (map.terrain[(z + dz) * map.width + x + dx] === 'fertile') fertile++;
        }
        const distance = Math.hypot(x - map.entry.x, z - map.entry.z);
        const score = fertile - distance / 8;
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    return best;
  });
  console.log('patch', patch);
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), patch);
  await paint(page, 24);
  await page.screenshot({ path: path.join(output, 'close.png') });

  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (const [name, steps] of [['city', 5], ['wide', 6]]) {
    for (let step = 0; step < steps; step++) {
      await page.mouse.wheel(0, 200);
      await paint(page, 2);
    }
    await paint(page, 24);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  console.log('span', await page.evaluate(() => window.oikos.camera[6]));
  console.log('captured', output);
} finally {
  await browser.close();
}
