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
const selectTool = (page, name) => page.getByRole('button', { name: new RegExp(`^${name},`) }).first().click();
const menuChoice = async (page, testId) => {
  await page.keyboard.press('Escape');
  await page.getByTestId(testId).click();
  await paint(page);
};
const advance = async (page, seconds) => {
  await page.evaluate((value) => window.oikos.advance(value), seconds);
  await paint(page);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
  await page.getByRole('button', { name: /pause/i }).first().click();
  assert.match(await page.locator('[data-field="time"]').textContent(), /^[1-3] Jan 421 BC$/);
  let world = await state(page);
  assert.equal(world.buildings.length, 0);
  assert(world.roads.length >= 5, 'Starter roads missing');
  await page.screenshot({ path: path.join(output, '01-empty-island.png') });

  const plan = await page.evaluate(() => window.oikos.plan);
  assert(plan, 'No starter plan for this island');
  const island = await page.evaluate(() => window.oikos.map);
  const waterTile = (() => { for (let z = 0; z < island.depth; z++) for (let x = 0; x < island.width; x++) if (island.terrain[z * island.width + x] === 'water' && x > 4 && z > 4 && x < island.width - 4 && z < island.depth - 4) return [x, z]; })();
  const grassTile = (() => { for (let z = 0; z < island.depth; z++) for (let x = 0; x < island.width; x++) if (island.terrain[z * island.width + x] === 'grass') return [x, z]; })();
  const labels = { house: 'Dwelling', farm: 'Wheat farm', granary: 'Granary', agora: 'Agora', fountain: 'Fountain', maintenance: 'Maintenance post' };
  const roadStrokes = [];
  let stroke = [];
  for (const tile of plan.roads) {
    const last = stroke[stroke.length - 1];
    if (last && Math.abs(last.x - tile.x) + Math.abs(last.z - tile.z) !== 1) { roadStrokes.push(stroke); stroke = []; }
    stroke.push(tile);
  }
  if (stroke.length) roadStrokes.push(stroke);
  for (const item of plan.buildings) {
    await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [item.x, item.z]);
    await paint(page);
    await selectTool(page, labels[item.kind]);
    await clickTile(page, item.x, item.z);
    world = await state(page);
    assert(world.buildings.some((building) => building.kind === item.kind && building.x === item.x && building.z === item.z), `Could not place ${item.kind} at ${item.x},${item.z}`);
  }
  await selectTool(page, 'Dwelling');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), waterTile);
  await paint(page);
  await clickTile(page, waterTile[0], waterTile[1]);
  assert.equal((await state(page)).buildings.length, plan.buildings.length, 'Placed a house on water');
  await selectTool(page, 'Wheat farm');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), grassTile);
  await paint(page);
  await clickTile(page, grassTile[0], grassTile[1]);
  assert.equal((await state(page)).buildings.length, plan.buildings.length, 'Farm accepted outside fertile ground');
  await selectTool(page, 'Road');
  for (const run of roadStrokes) {
    const straight = run.every((tile) => tile.x === run[0].x) || run.every((tile) => tile.z === run[0].z);
    const segments = straight ? [run] : run.map((tile) => [tile]);
    for (const segment of segments) {
      const first = segment[0];
      const last = segment[segment.length - 1];
      await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [first.x, first.z]);
      await paint(page);
      const start = await tilePoint(page, first.x, first.z);
      const end = await tilePoint(page, last.x, last.z);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 6 });
      await page.mouse.up();
      await paint(page);
    }
  }
  world = await state(page);
  for (const tile of plan.roads) assert(world.roads.includes(tile.z * island.width + tile.x), `Road missing at ${tile.x},${tile.z}`);
  await page.keyboard.press('Escape');
  const agora = (await state(page)).buildings.find((building) => building.kind === 'agora');
  assert(agora, 'Agora missing');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [agora.x, agora.z]);
  await paint(page);
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
  const roamer = world.walkers.find((walker) => walker.kind === 'vendor' || walker.kind === 'water' || walker.kind === 'maintenance');
  assert(roamer, 'No service walker on the streets');
  const roamerTile = roamer.path[Math.min(roamer.step, roamer.path.length - 1)];
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [roamerTile % island.width, Math.floor(roamerTile / island.width)]);
  await paint(page);
  const roamerPoint = await tilePoint(page, roamerTile % island.width, Math.floor(roamerTile / island.width));
  await page.mouse.click(roamerPoint.x, roamerPoint.y - 6);
  await paint(page);
  assert.match(await page.locator('[data-field="inspector-tier"]').textContent(), /vendor|carrier|caretaker/i, 'Clicking a walker did not inspect them');
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

  await menuChoice(page, 'save');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready);
  await page.getByRole('button', { name: /pause/i }).first().click();
  const restored = await state(page);
  assert.equal(restored.buildings.length, world.buildings.length, 'Save did not restore buildings');
  assert(restored.time >= world.time, 'Save lost simulation time');
  const tampered = await page.evaluate((key) => { localStorage.setItem(key, '{"version":1,"buildings":"nope"}'); return key; }, await page.evaluate(() => window.oikos.saveKey));
  await menuChoice(page, 'load');
  assert.equal((await state(page)).buildings.length, restored.buildings.length, 'Corrupt save replaced the island');
  assert(tampered);
  await menuChoice(page, 'new-island');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await state(page)).buildings.length, restored.buildings.length, 'Cancelled new island cleared the city');
  await menuChoice(page, 'new-island');
  await page.getByRole('button', { name: 'New island' }).last().click();
  await paint(page);
  assert.equal((await state(page)).buildings.length, 0, 'Confirmed new island kept the old city');
  await menuChoice(page, 'load');
  assert.equal((await state(page)).buildings.length, 0, 'New island did not replace the saved island');
  await page.keyboard.press('g');
  await menuChoice(page, 'grid-toggle');
  assert.equal(await page.getByTestId('grid-toggle').getAttribute('aria-pressed'), 'false', 'Grid toggle state not reflected');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('menu-dialog').evaluate((dialog) => dialog.open), true, 'Escape did not open the menu');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('menu-dialog').evaluate((dialog) => dialog.open), false, 'Escape did not close the menu');
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
