import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchGameBrowser, openSandbox, paint, settle } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/zoom'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await launchGameBrowser();
const page = await openSandbox(browser, base, { reducedMotion: 'no-preference' });

try {
  await settle(page, 1, { plan: true, seconds: 120 });
  await paint(page, 24);
  await page.screenshot({ path: path.join(output, 'city.png') });

  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (const [name, steps] of [['out-1', 4], ['out-2', 4], ['out-3', 6], ['out-4', 8], ['out-5', 12]]) {
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
