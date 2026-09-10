import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5185/?debug', output = 'artifacts/logistics'] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const state = (page) => page.evaluate(() => window.oikos.state);
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
const advance = async (page, seconds) => {
  await page.evaluate((value) => window.oikos.advance(value), seconds);
  await paint(page);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error);
  await page.getByRole('button', { name: /pause/i }).first().click();

  const plan = await page.evaluate(() => window.oikos.plan);
  const labels = { house: 'Dwelling', farm: 'Wheat farm', granary: 'Granary', agora: 'Agora', fountain: 'Fountain', maintenance: 'Caretaker' };
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
  }
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
  await page.keyboard.press('Escape');

  let world = await state(page);
  const agora = world.buildings.find((building) => building.kind === 'agora');
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [agora.x, agora.z]);
  await paint(page);
  const agoraPoint = await page.evaluate((id) => window.oikos.projectBuilding(id), agora.id);
  await page.mouse.click(agoraPoint.x, agoraPoint.y);
  await paint(page);
  const vendorButton = page.getByTestId('vendor-toggle');
  await vendorButton.waitFor({ state: 'visible', timeout: 5000 });
  await vendorButton.click();
  await paint(page);

  await advance(page, 200);

  const centre = { x: (await page.evaluate(() => window.oikos.map)).entry.x, z: (await page.evaluate(() => window.oikos.map)).entry.z };
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [centre.x, centre.z]);
  await paint(page);
  await page.screenshot({ path: path.join(output, '00-city-idle.png') });

  world = await state(page);
  const fountain = world.buildings.find((building) => building.kind === 'fountain');
  const fountainPoint = await page.evaluate((id) => window.oikos.projectBuilding(id), fountain.id);
  await page.mouse.click(fountainPoint.x, fountainPoint.y);
  await paint(page);
  await page.screenshot({ path: path.join(output, '01-fountain-selected.png') });

  const maintenance = world.buildings.find((building) => building.kind === 'maintenance');
  const maintenancePoint = await page.evaluate((id) => window.oikos.projectBuilding(id), maintenance.id);
  await page.mouse.click(maintenancePoint.x, maintenancePoint.y);
  await paint(page);
  await page.screenshot({ path: path.join(output, '02-maintenance-selected.png') });

  const agoraAfter = world.buildings.find((building) => building.kind === 'agora');
  const agoraPoint2 = await page.evaluate((id) => window.oikos.projectBuilding(id), agoraAfter.id);
  await page.mouse.click(agoraPoint2.x, agoraPoint2.y);
  await paint(page);
  await page.screenshot({ path: path.join(output, '03-agora-selected.png') });

  let roamer = null;
  for (let i = 0; i < 20 && !roamer; i++) {
    world = await state(page);
    roamer = world.walkers.find((walker) => walker.kind === 'vendor' || walker.kind === 'water' || walker.kind === 'maintenance');
    if (!roamer) await advance(page, 30);
  }
  if (roamer) {
    const roamerTile = roamer.path[Math.min(roamer.step, roamer.path.length - 1)];
    const island = await page.evaluate(() => window.oikos.map);
    await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [roamerTile % island.width, Math.floor(roamerTile / island.width)]);
    await paint(page);
    const roamerPoint = await tilePoint(page, roamerTile % island.width, Math.floor(roamerTile / island.width));
    await page.mouse.click(roamerPoint.x, roamerPoint.y - 6);
    await paint(page);
    await page.screenshot({ path: path.join(output, '04-walker-selected.png') });
  } else {
    console.log('No roaming walker found for the walker-route screenshot.');
  }

  await advance(page, 300);
  const houses = (await state(page)).buildings.filter((building) => building.kind === 'house');
  for (const house of houses.slice(0, 4)) {
    const point = await page.evaluate((id) => window.oikos.projectBuilding(id), house.id);
    await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [house.x, house.z]);
    await paint(page);
  }
  await page.evaluate(([x, z]) => window.oikos.focusTile(x, z), [centre.x, centre.z]);
  await paint(page);
  await page.screenshot({ path: path.join(output, '05-houses-supplied.png') });

  console.log(`Logistics capture complete. Screenshots: ${output}`);
} finally {
  await browser.close();
}
