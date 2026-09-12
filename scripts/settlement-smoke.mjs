import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/settlement'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const state = (page) => page.evaluate(() => window.oikos.state);
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const menuChoice = async (page, testId) => {
  await page.getByTestId('menu').click();
  await page.getByTestId(testId).click();
  await paint(page);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  const initial = await state(page);
  await menuChoice(page, 'new-island');
  await page.getByLabel('Starting island').selectOption('0');
  await page.screenshot({ path: path.join(output, '01-island-choice.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await paint(page);
  assert.deepEqual(await state(page), initial, 'Cancelling changed the city or advanced the paused clock');

  await menuChoice(page, 'new-island');
  await page.getByLabel('Starting island').selectOption('0');
  await page.getByRole('button', { name: 'New island', exact: true }).click();
  await page.waitForFunction(() => window.oikos.state.seed === 2 && window.oikos.state.home === 0);
  await page.getByRole('button', { name: /pause/i }).first().click();
  const chosen = await state(page);
  const map = await page.evaluate(() => window.oikos.map);
  assert.equal(map.home, 0);
  assert.deepEqual(map.entry, map.islands[0].entry);
  assert(chosen.harbour.connected, 'The chosen landing is disconnected');
  const entry = await page.evaluate(() => window.oikos.projectTile(window.oikos.map.entry.x, window.oikos.map.entry.z - 4));
  assert(entry.x > 0 && entry.x < 1440 && entry.y > 0 && entry.y < 1000, 'Camera did not follow the chosen island');
  await page.screenshot({ path: path.join(output, '02-new-landing.png') });

  const built = await page.evaluate(() => window.oikos.buildPlan());
  assert(built.ok, built.reason);
  await page.evaluate(() => window.oikos.advance(180));
  assert(await page.evaluate(() => window.oikos.summary.goal), 'Chosen island did not sustain the village loop');
  await menuChoice(page, 'save');
  const checkpoint = await state(page);
  await page.screenshot({ path: path.join(output, '03-thriving-island.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  assert.equal((await state(page)).home, 0, 'Reload forgot the chosen island');
  assert.deepEqual((await page.evaluate(() => window.oikos.map)).entry, map.entry);
  assert((await state(page)).delivered >= checkpoint.delivered, 'Reload lost the economy');

  const anotherHome = await page.evaluate(() => JSON.stringify(window.oikos.freshWorld(2, 7)));
  await menuChoice(page, 'import');
  await page.getByTestId('import-file').setInputFiles({ name: 'another-home.json', mimeType: 'application/json', buffer: Buffer.from(anotherHome) });
  await page.waitForFunction(() => window.oikos.state.home === 7);
  assert.equal((await state(page)).seed, 2);
  assert.equal((await page.evaluate(() => window.oikos.map)).home, 7, 'Same-seed import did not change the scene');
  await menuChoice(page, 'load');
  assert.deepEqual(await state(page), checkpoint, 'Starting elsewhere overwrote the manual checkpoint');
  assert.deepEqual((await page.evaluate(() => window.oikos.map)).entry, map.entry, 'Restoring did not rebuild the chosen map');
  await page.getByRole('button', { name: /return to village/i }).click();
  await paint(page);
  await page.screenshot({ path: path.join(output, '04-restored-island.png') });
  assert.deepEqual(errors, [], 'Browser errors');
  console.log('Settlement smoke passed: choice, cancellation, camera, growth, reload, and checkpoint isolation.');
} finally {
  await browser.close();
}
