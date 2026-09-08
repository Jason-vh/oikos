import { chromium } from 'playwright';
const [url, out, tick] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Reflect.get(window, 'game') !== undefined);
await page.evaluate((t) => {
  const game = Reflect.get(window, 'game');
  const { world } = game;
  world.treasury = 200000;
  let spot = null;
  for (let y = 2; y < world.grid.size - 6 && !spot; y++) for (let x = 2; x < world.grid.size - 6 && !spot; x++) if (world.canPlace('wheatFarm', x, y).ok) spot = { x, y };
  const row = spot.y + 3;
  for (let x = spot.x - 8; x < spot.x + 12; x++) world.placeRoad(x, row);
  world.place('wheatFarm', spot.x, spot.y);
  const kinds = ['granary', 'fountain', 'statue'];
  for (let x = spot.x - 7; x < spot.x + 11; x++) for (const y of [row - 1, row + 1]) {
    if (kinds.length && world.place(kinds[0], x, y)) { kinds.shift(); continue; }
    world.place('house', x, y);
  }
  game.camera.scale = 1;
  game.camera.centreOnTile(spot.x, row, 1440, 900);
  game.speed = 0;
  for (let i = 0; i < 4000; i++) world.update();
  world.tick = Number(t);
}, tick);
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
await browser.close();
