import { chromium } from 'playwright';
const [url, out, tick, zoom = '1', liveMs = '0'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Reflect.get(window, 'game') !== undefined);
await page.evaluate(({ tick: t, zoom: z }) => {
  const game = Reflect.get(window, 'game');
  const { world } = game;
  world.treasury = 200000;
  let spot = null;
  for (let y = 2; y < world.grid.size - 6 && !spot; y++) for (let x = 2; x < world.grid.size - 6 && !spot; x++) if (world.canPlace('wheatFarm', x, y).ok) spot = { x, y };
  const { grid } = world;
  const clear = (x, y, w, h) => { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (!grid.isFree(x + dx, y + dy)) return false; return grid.isFlat(x, y, w, h); };
  for (let y = 10; y < grid.size - 20 && !spot; y++) for (let x = 10; x < grid.size - 20 && !spot; x++) if (clear(x - 8, y - 2, 20, 10)) spot = { x, y };
  const row = spot.y + 3;
  for (let x = spot.x - 8; x < spot.x + 12; x++) world.placeRoad(x, row);
  for (let y = row - 6; y < row + 8; y++) world.placeRoad(spot.x + 2, y);
  world.place('wheatFarm', spot.x, spot.y);
  for (let x = spot.x + 11; x > spot.x - 8; x--) if (world.place('palace', x, row + 1)) break;
  const kinds = ['granary', 'fountain', 'maintenanceOffice', 'taxOffice', 'olivePress', 'college'];
  for (let x = spot.x - 7; x < spot.x + 11; x += 2) for (const y of [row - 2, row + 1]) {
    if (kinds.length && world.place(kinds[0], x, y)) { kinds.shift(); continue; }
    world.place('house', x, y);
  }
  for (const y of [row - 6, row - 4, row + 3, row + 5]) for (const x of [spot.x - 1, spot.x + 3]) {
    if (kinds.length && world.place(kinds[0], x, y)) { kinds.shift(); continue; }
    world.place('house', x, y);
  }
  game.camera.scale = Number(z);
  game.camera.centreOnTile(spot.x, row, 1440, 900);
  game.speed = 0;
  for (let i = 0; i < 4000; i++) world.update();
  world.tick = Number(t);
}, { tick, zoom });
if (Number(liveMs) > 0) {
  await page.evaluate(() => {
    Reflect.get(window, 'game').speed = 1;
  });
  await page.waitForTimeout(Number(liveMs));
  await page.evaluate(() => {
    Reflect.get(window, 'game').speed = 0;
  });
}
await page.evaluate(() => {
  const { world } = Reflect.get(window, 'game');
  let tier = 0;
  for (const building of world.buildings.values()) {
    if (building.kind !== 'house') continue;
    building.tier = tier;
    building.population = 8;
    tier = (tier + 1) % 7;
  }
});
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();
