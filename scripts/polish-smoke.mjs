import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/polish'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const paint = (page, frames = 4) => page.evaluate((count) => new Promise((resolve) => {
  const next = () => { if (--count === 0) resolve(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), frames);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.getByRole('button', { name: 'Fast speed', exact: true }).click();
  await page.getByTestId('menu').click();
  await paint(page);
  const paused = await page.evaluate(() => window.oikos.state.time);
  await paint(page, 30);
  assert.equal(await page.evaluate(() => window.oikos.state.time), paused, 'Menu did not pause');
  await page.keyboard.press('Escape');
  await paint(page);
  assert.equal(await page.getByRole('button', { name: 'Fast speed', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Pause, shortcut Space', exact: true }).click();
  await page.screenshot({ path: `${output}/01-harbour-opening.png` });
  const beforeBuild = await page.evaluate(() => window.oikos.state);
  const house = await page.evaluate(() => window.oikos.plan.buildings.find((building) => building.kind === 'house'));
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), house);
  await page.keyboard.press('2');
  await paint(page);
  const point = await page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), house);
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.evaluate(() => window.oikos.state.buildings.length), 1);
  await page.getByTestId('undo').click();
  assert.deepEqual(await page.evaluate(() => window.oikos.state), beforeBuild, 'Undo lost money or changed the paused world');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.oikos.buildPlan());
  await page.evaluate(() => window.oikos.advance(180));
  const saved = await page.evaluate(() => window.oikos.state);
  await page.getByTestId('menu').click();
  await page.getByTestId('sound-toggle').click();
  assert.equal(await page.getByTestId('sound-toggle').getAttribute('aria-pressed'), 'false');
  const downloading = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const download = await downloading;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported, saved, 'Export changed the city');

  await page.getByTestId('import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await page.waitForFunction(() => document.querySelector('[data-testid="toast-region"]').textContent.includes('could not be read'));
  assert.deepEqual(await page.evaluate(() => window.oikos.state), saved, 'Invalid import changed the city');
  await page.evaluate(() => window.oikos.advance(10));
  await page.getByTestId('import-file').setInputFiles({ name: 'island.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForFunction((time) => window.oikos.state.time === time, saved.time);
  assert.deepEqual(await page.evaluate(() => window.oikos.state), saved, 'Import did not round-trip');

  await page.keyboard.press('q');
  await paint(page, 90);
  const camera = await page.evaluate(() => window.oikos.camera);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.getByRole('button', { name: 'Pause, shortcut Space', exact: true }).click();
  const restoredCamera = await page.evaluate(() => window.oikos.camera);
  camera.forEach((value, index) => assert(Math.abs(value - restoredCamera[index]) < .001, 'Camera was not restored'));
  await page.keyboard.press('q');
  await paint(page, 2);
  const snapped = await page.evaluate(() => window.oikos.camera);
  await paint(page, 30);
  const settled = await page.evaluate(() => window.oikos.camera);
  snapped.forEach((value, index) => assert(Math.abs(value - settled[index]) < .0005, 'Camera still eases under reduced motion'));
  assert(Math.abs(snapped[0] - restoredCamera[0]) + Math.abs(snapped[2] - restoredCamera[2]) > .5, 'Q did not rotate the view');
  await page.getByTestId('menu').click();
  assert.equal(await page.getByTestId('sound-toggle').getAttribute('aria-pressed'), 'false', 'Sound preference was not restored');
  await page.screenshot({ path: `${output}/02-menu.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Return to village, shortcut H' }).click();
  await paint(page, 60);
  await page.screenshot({ path: `${output}/03-village.png` });
  assert.deepEqual(errors, []);
  console.log(`Polish smoke passed: menu pause/resume, construction undo, export/import, corrupt import, camera, sound preference. ${output}`);
} finally {
  await browser.close();
}
