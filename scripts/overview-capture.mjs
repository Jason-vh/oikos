import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchGameBrowser, paint } from './sandbox-page.mjs';

const [base = 'http://localhost:5180', output = 'artifacts/overview'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(new URL('/?debug', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="join-form"]:visible');
  await page.screenshot({ path: path.join(output, 'backdrop.png') });
  await page.getByRole('textbox').fill(`Look ${Date.now() % 1000000}`);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error === 'true');
  await page.waitForFunction(() => 'oikos' in window);
  await page.evaluate(() => window.oikos.settled());
  await paint(page, 24);
  await page.screenshot({ path: path.join(output, 'overview.png') });

  const canvas = await page.locator('canvas').boundingBox();
  for (const [name, turns] of [['zoomed-out', 12], ['mid', -10], ['close', -14]]) {
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    for (let step = 0; step < Math.abs(turns); step++) {
      await page.mouse.wheel(0, turns > 0 ? 200 : -200);
      await paint(page, 2);
    }
    await paint(page, 24);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  console.log('cost', await page.evaluate(() => ({ drawCalls: window.oikos.drawCalls, triangles: window.oikos.triangles })));
  console.log('captured', output);
} finally {
  await browser.close();
}
