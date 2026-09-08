import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5180';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Reflect.get(window, 'game') !== undefined);

const report = await page.evaluate(async () => {
  const game = Reflect.get(window, 'game');
  const { world } = game;

  world.treasury = 100000;
  const size = world.grid.size;
  const centre = Math.floor(size / 2);

  const meadow = [];
  for (let y = 1; y < size - 3; y++) {
    for (let x = 1; x < size - 3; x++) {
      if (world.grid.terrain[world.grid.index(x, y)] === 1) meadow.push({ x, y });
    }
  }
  const farmSpot = meadow.find(
    (spot) => world.canPlace('wheatFarm', spot.x, spot.y).ok,
  );
  if (!farmSpot) return { fatal: 'no meadow for a farm' };

  const row = farmSpot.y + 2;
  for (let x = farmSpot.x - 6; x < farmSpot.x + 14; x++) world.placeRoad(x, row);

  const farmPlaced = world.place('wheatFarm', farmSpot.x, farmSpot.y);

  world.place('granary', farmSpot.x + 4, row + 1);
  world.place('fountain', farmSpot.x + 8, row + 1);
  for (let x = farmSpot.x - 4; x < farmSpot.x + 3; x++) world.place('house', x, row + 1);
  world.place('statue', farmSpot.x - 1, row - 1);

  game.camera.centreOnTile(farmSpot.x, row, 1280, 800);
  void centre;
  game.speed = 0;

  for (let tick = 0; tick < 3000; tick++) world.update();

  const houses = [...world.buildings.values()].filter((b) => b.kind === 'house');
  return {
    farmPlaced,
    granaryStock: [...world.buildings.values()].find((b) => b.kind === 'granary')?.stock ?? -1,
    population: world.population,
    tiers: houses.map((house) => house.tier),
    walkers: world.walkers.size,
    treasury: Math.floor(world.treasury),
    date: world.dateLabel,
  };
});

await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/smoke.png' });
await browser.close();

console.log(JSON.stringify({ report, errors }, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
