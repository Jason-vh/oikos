import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/founding'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const state = (page) => page.evaluate(() => window.oikos.state);
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const menuChoice = async (page, action) => {
  await page.getByTestId('menu').click();
  await page.getByTestId(action).click();
  await paint(page);
};
const pointAt = (page, site) => page.evaluate(({ x, z }) => window.oikos.projectTile(x, z), site);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await menuChoice(page, 'new-island');
  await page.getByLabel('Starting island').selectOption('0');
  await page.getByRole('button', { name: 'New island', exact: true }).click();
  await page.waitForFunction(() => window.oikos.state.seed === 2);
  await page.getByRole('button', { name: /pause/i }).first().click();
  assert.equal((await state(page)).cities[0].founded, false);
  assert(await page.getByRole('button', { name: /^Dwelling,/ }).isDisabled());
  assert.match(await page.getByTestId('guide').textContent(), /Found your city/);
  await menuChoice(page, 'save');
  const pending = await state(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  assert.deepEqual(await state(page), pending, 'Reload lost or advanced the unfinished founding');
  for (const corruption of [{ roads: [] }, { cities: [{ ...pending.cities[0], money: pending.cities[0].money + 1 }] }]) {
    await menuChoice(page, 'import');
    await page.getByTestId('import-file').setInputFiles({ name: 'invalid-founding.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...pending, ...corruption })) });
    await paint(page);
    assert.deepEqual(await state(page), pending, 'An invalid unfinished save replaced the founding');
    assert.match(await page.getByTestId('toast-region').textContent(), /could not be read/);
  }

  const road = await page.evaluate(() => ({ x: window.oikos.map.entry.x, z: window.oikos.map.entry.z - 4 }));
  const roadPoint = await pointAt(page, road);
  await page.mouse.click(roadPoint.x, roadPoint.y);
  await paint(page);
  assert.deepEqual(await state(page), pending, 'Invalid placement changed the founding');
  assert.match(await page.getByTestId('toast-region').textContent(), /beside the road/);

  const site = await page.evaluate(() => {
    const world = window.oikos.state;
    const entry = window.oikos.map.entry;
    for (let z = entry.z - 16; z < entry.z; z++) {
      for (let x = entry.x - 16; x <= entry.x + 16; x++) {
        if (x === world.cities[0].harbour.x && z === world.cities[0].harbour.z) continue;
        if (window.oikos.foundingPlacement(x, z).ok) return { x, z };
      }
    }
    return null;
  });
  assert(site, 'No alternate harbour site');
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), site);
  const point = await pointAt(page, site);
  await page.mouse.move(point.x, point.y);
  await paint(page);
  await page.screenshot({ path: path.join(output, '01-harbour-preview.png') });
  await page.mouse.click(point.x, point.y);
  await paint(page);
  let founded = await state(page);
  assert.equal(founded.cities[0].founded, true);
  assert.equal(founded.cities[0].harbour.x, site.x);
  assert.equal(founded.cities[0].harbour.z, site.z);
  assert.equal(founded.cities[0].harbour.connected, true);
  assert.equal(founded.cities[0].money, pending.cities[0].money);
  assert.equal(await page.getByRole('button', { name: /^Dwelling,/ }).isDisabled(), false);
  await page.screenshot({ path: path.join(output, '02-founded.png') });

  await menuChoice(page, 'load');
  assert.deepEqual(await state(page), pending, 'Founding replaced the manual checkpoint');
  assert(await page.getByRole('button', { name: /^Dwelling,/ }).isDisabled());
  await page.evaluate(({ x, z }) => window.oikos.focusTile(x, z), site);
  const restoredPoint = await pointAt(page, site);
  await page.mouse.click(restoredPoint.x, restoredPoint.y);
  await paint(page);
  assert.equal((await state(page)).cities[0].founded, true);
  const built = await page.evaluate(() => window.oikos.buildPlan());
  assert(built.ok, built.reason);
  await page.evaluate(() => window.oikos.advance(180));
  assert(await page.evaluate(() => window.oikos.summary.goal), 'The chosen harbour did not support a thriving city');
  await menuChoice(page, 'save');
  founded = await state(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  const reloaded = await state(page);
  assert.equal(reloaded.cities[0].harbour.x, site.x);
  assert.equal(reloaded.cities[0].harbour.z, site.z);
  assert(reloaded.cities[0].delivered >= founded.cities[0].delivered);
  await page.screenshot({ path: path.join(output, '03-founded-city.png') });
  assert.deepEqual(errors, []);
  console.log('Founding smoke passed: preview, invalid sites, placement, pending saves, checkpoint restoration, and city growth.');
} finally {
  await browser.close();
}
