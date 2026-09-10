import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5180/?debug', output = 'artifacts/smoke'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const state = (page) => page.evaluate(() => window.oikos.state);
const summary = (page) => page.evaluate(() => window.oikos.summary);
const paint = (page, count = 2) => page.evaluate((frames) => new Promise((resolve) => {
  const next = () => { if (--frames <= 0) resolve(null); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);
const tilePoint = (page, x, z) => page.evaluate(([tx, tz]) => window.oikos.projectTile(tx, tz), [x, z]);
const clickTile = async (page, x, z) => {
  const point = await tilePoint(page, x, z);
  await page.mouse.click(point.x, point.y);
  await paint(page);
};
const selectTool = (page, name) => page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
const advance = async (page, seconds) => {
  await page.evaluate((value) => window.oikos.advance(value), seconds);
  await paint(page);
};
const houseAt = (world, x, z) => world.buildings.find((building) => building.kind === 'house' && building.x === x && building.z === z);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  let world = await state(page);
  assert.equal(world.buildings.length, 0);
  assert(world.roads.length > 20, 'Starter roads missing');
  await page.screenshot({ path: path.join(output, '01-empty-island.png') });

  await selectTool(page, 'Dwelling');
  const houses = [[10, 17], [14, 17], [18, 21], [24, 21]];
  for (const [x, z] of houses) await clickTile(page, x, z);
  world = await state(page);
  for (const [x, z] of houses) assert(houseAt(world, x, z), `No house at ${x},${z}`);
  await clickTile(page, 35, 6);
  assert.equal((await state(page)).buildings.length, 4, 'Placed a house on water');
  await selectTool(page, 'Wheat farm');
  await clickTile(page, 10, 12);
  assert.equal((await state(page)).buildings.length, 4, 'Farm accepted outside fertile ground');
  await clickTile(page, 26, 11);
  await selectTool(page, 'Granary');
  await clickTile(page, 24, 17);
  await selectTool(page, 'Road');
  const start = await tilePoint(page, 27, 15);
  const end = await tilePoint(page, 27, 19);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await paint(page);
  world = await state(page);
  for (const z of [15, 16, 17, 18, 19]) assert(world.roads.includes(z * 40 + 27), `Road missing at 27,${z}`);
  await selectTool(page, 'Agora');
  await clickTile(page, 13, 21);
  await selectTool(page, 'Fountain');
  await clickTile(page, 19, 17);
  await selectTool(page, 'Maintenance post');
  await clickTile(page, 22, 17);
  await page.keyboard.press('Escape');
  const agora = (await state(page)).buildings.find((building) => building.kind === 'agora');
  assert(agora, 'Agora missing');
  const agoraPoint = await page.evaluate((id) => window.oikos.projectBuilding(id), agora.id);
  await page.mouse.click(agoraPoint.x, agoraPoint.y);
  await paint(page);
  const vendorButton = page.getByTestId('vendor-toggle');
  await expectVisible(vendorButton);
  const before = (await state(page)).money;
  await vendorButton.click();
  await paint(page);
  world = await state(page);
  const agoraAfter = world.buildings.find((building) => building.id === agora.id);
  assert.equal(agoraAfter.vendorEnabled, true, 'Vendor not enabled');
  assert.equal(before - world.money, 50, 'Vendor did not cost 50');
  assert(world.buildings.every((building) => building.connected), 'A building is disconnected');
  await page.screenshot({ path: path.join(output, '02-neighbourhood.png') });

  await advance(page, 120);
  world = await state(page);
  assert(world.buildings.filter((building) => building.kind === 'house').every((house) => house.residents > 0), 'Settlers did not arrive');
  let delivered = false;
  for (let i = 0; i < 10 && !delivered; i++) {
    await advance(page, 60);
    world = await state(page);
    delivered = world.delivered > 0;
  }
  assert(delivered, 'No food was delivered within 12 simulated minutes');
  assert(world.walkers.length > 0 || world.produced > 0, 'Nothing moved');
  await page.screenshot({ path: path.join(output, '03-first-deliveries.png') });
  let goal = false;
  for (let i = 0; i < 20 && !goal; i++) {
    await advance(page, 60);
    goal = (await summary(page)).goal;
  }
  world = await state(page);
  const courtyards = world.buildings.filter((building) => building.kind === 'house' && building.tier === 3 && building.residents > 0).length;
  assert(goal, `Goal not met after 32 simulated minutes: courtyards=${courtyards}, balance=${(await summary(page)).balance}, money=${world.money}`);
  await expectChecked(page.locator('[data-milestone="courtyards"]'));
  await page.screenshot({ path: path.join(output, '04-thriving.png') });

  await page.getByTestId('save').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.getByRole('button', { name: /pause/i }).first().click();
  const restored = await state(page);
  assert.equal(restored.buildings.length, world.buildings.length, 'Save did not restore buildings');
  assert(restored.time >= world.time, 'Save lost simulation time');
  const tampered = await page.evaluate((key) => { localStorage.setItem(key, '{"version":1,"buildings":"nope"}'); return key; }, await page.evaluate(() => window.oikos.saveKey));
  await page.getByTestId('load').click();
  await paint(page);
  assert.equal((await state(page)).buildings.length, restored.buildings.length, 'Corrupt save replaced the island');
  assert(tampered);
  await page.getByTestId('new-island').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await state(page)).buildings.length, restored.buildings.length, 'Cancelled new island cleared the city');
  await page.getByTestId('new-island').click();
  await page.getByRole('button', { name: 'New island' }).last().click();
  await paint(page);
  assert.equal((await state(page)).buildings.length, 0, 'Confirmed new island kept the old city');
  await page.getByTestId('load').click();
  await paint(page);
  assert.equal((await state(page)).buildings.length, 0, 'New island did not replace the saved island');
  await page.setViewportSize({ width: 390, height: 844 });
  await paint(page);
  await page.screenshot({ path: path.join(output, '05-mobile.png') });
  assert.deepEqual(errors, []);
  console.log(`Smoke passed: build, invalid placement, roads, vendor, deliveries, goal, save/load, corrupt save, mobile. Screenshots: ${output}`);
} finally {
  await browser.close();
}

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 5000 });
}
async function expectChecked(locator) {
  assert.equal(await locator.isChecked(), true, 'Courtyard milestone not shown as complete');
}
