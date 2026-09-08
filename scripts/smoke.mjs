import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5180';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

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
  const { grid } = world;

  world.treasury = 200000;

  const farmSpot = findSpot(world, 'wheatFarm');
  if (!farmSpot) return { fatal: 'no meadow for a farm' };

  const row = farmSpot.y + 2;
  for (let x = farmSpot.x - 8; x < farmSpot.x + 12; x++) world.placeRoad(x, row);

  const farmPlaced = world.place('wheatFarm', farmSpot.x, farmSpot.y);
  const placed = { granary: false, fountain: false, statue: false, houses: 0 };

  for (let x = farmSpot.x - 7; x < farmSpot.x + 11; x++) {
    for (const y of [row - 1, row + 1]) {
      if (!placed.granary && world.place('granary', x, y)) {
        placed.granary = true;
        continue;
      }
      if (placed.granary && !placed.fountain && world.place('fountain', x, y)) {
        placed.fountain = true;
        continue;
      }
      if (placed.fountain && !placed.statue && world.place('statue', x, y)) {
        placed.statue = true;
        continue;
      }
      if (world.place('house', x, y)) placed.houses += 1;
    }
  }

  game.camera.scale = 0.85;
  game.camera.centreOnTile(farmSpot.x, row, 1440, 900);
  game.speed = 0;

  for (let tick = 0; tick < 4000; tick++) world.update();

  const houses = [...world.buildings.values()].filter((b) => b.kind === 'house');
  return {
    farmPlaced,
    placed,
    population: world.population,
    tiers: houses.reduce((counts, house) => {
      counts[house.tier] = (counts[house.tier] ?? 0) + 1;
      return counts;
    }, {}),
    walkers: world.walkers.size,
    heights: [...grid.height].reduce((counts, h) => {
      counts[h] = (counts[h] ?? 0) + 1;
      return counts;
    }, {}),
    date: world.dateLabel,
  };

  function findSpot(world, kind) {
    const { grid } = world;
    for (let y = 2; y < grid.size - 6; y++) {
      for (let x = 2; x < grid.size - 6; x++) {
        if (world.canPlace(kind, x, y).ok) return { x, y };
      }
    }
    return null;
  }
});

await page.waitForTimeout(1500);
await page.screenshot({ path: new URL('./shot-day.png', import.meta.url).pathname });

await page.evaluate(() => Reflect.get(window, 'game').toggleOverlay('appeal'));
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('./shot-overlay.png', import.meta.url).pathname });

await browser.close();
console.log(JSON.stringify({ report, errors: errors.slice(0, 8) }, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
