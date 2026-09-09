import { HOUSE_TIERS } from '../src/sim/buildings';
import { TICKS_PER_MONTH } from '../src/sim/time';
import type { BuildingKind } from '../src/sim/types';
import { World } from '../src/sim/world';

const YEARS = Number(process.argv[2] ?? 12);
const SEED = Number(process.argv[3] ?? 5);

const world = new World(64, SEED);
world.treasury = 20000;

const street = bestStreet(world);
for (let x = street.from; x <= street.to; x++) world.placeRoad(x, street.y);

const built: Partial<Record<BuildingKind, number>> = {};
const reasons = new Map<string, number>();
let cursor = street.from + 1;

function along(kind: BuildingKind, count: number, side: 'north' | 'south'): void {
  for (let placed = 0; placed < count; placed += 1) {
    const size = world.buildings.size === 0 ? 2 : sizeOf(kind);
    const y = side === 'north' ? street.y - size : street.y + 1;
    let found = false;

    for (let x = cursor; x <= street.to - size && !found; x++) {
      if (!world.place(kind, x, y)) continue;
      found = true;
      cursor = x + size;
      built[kind] = (built[kind] ?? 0) + 1;
    }
    if (!found) return;
  }
}

function sizeOf(kind: BuildingKind): number {
  const probe = world.canPlace(kind, street.from, street.y + 1);
  void probe;
  return kind === 'agora' || kind === 'college' ? 3 : 2;
}

along('maintenanceOffice', 1, 'south');
along('fountain', 1, 'south');
along('granary', 1, 'south');
along('agora', 1, 'south');
cursor = street.from + 1;
along('house', 8, 'north');

farmsNearby(3);

console.log(`street row ${street.y}, x ${street.from}–${street.to}, meadow within reach: ${street.meadow}`);
console.log('placed', built);
if (built.wheatFarm === undefined) console.log('farm refusals', [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 4));

for (let year = 0; year < YEARS; year++) {
  for (let month = 0; month < 12; month++) {
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
  }
  console.log(
    `${world.dateLabel}  people ${String(world.population).padStart(4)}` +
      `  treasury ${String(Math.round(world.treasury)).padStart(6)}` +
      `  popularity ${String(world.sentiment.popularity).padStart(3)}  ${tierCounts(world)}  | ${flows(world)}`,
  );
}

const grown = [...world.buildings.values()].some((building) => building.kind === 'house' && building.tier > 0);
console.log(grown ? '\nHouses grew past a hut.' : '\nNothing grew — the chain is broken somewhere.');
if (!grown) process.exit(1);

function farmsNearby(count: number): void {
  const middle = Math.floor((street.from + street.to) / 2);
  const spots: { x: number; y: number; distance: number }[] = [];

  for (let y = 4; y < world.grid.size - 6; y++) {
    for (let x = 4; x < world.grid.size - 6; x++) {
      const check = world.canPlace('wheatFarm', x, y);
      if (!check.ok && check.reason !== 'Must touch a road') continue;
      spots.push({ x, y, distance: Math.abs(x - middle) + Math.abs(y - street.y) });
    }
  }
  spots.sort((a, b) => a.distance - b.distance);

  let placed = 0;
  for (const spot of spots) {
    if (placed >= count) break;

    const step = spot.y > street.y ? -1 : 1;
    const start = step > 0 ? spot.y + 2 : spot.y - 1;
    for (let row = start; row !== street.y + step; row += step) world.placeRoad(spot.x, row);
    if (!world.place('wheatFarm', spot.x, spot.y)) continue;

    placed += 1;
    built.wheatFarm = (built.wheatFarm ?? 0) + 1;
  }
}

function flows(city: World): string {
  const of = (kind: BuildingKind) => [...city.buildings.values()].filter((b) => b.kind === kind);
  const stock = (kind: BuildingKind) => of(kind).reduce((total, b) => total + b.stock.food, 0);
  const houses = of('house');
  const fed = houses.filter((house) => house.supply.food > 0).length;
  const farms = of('wheatFarm');

  return `farms ${farms.length} (staff ${farms.map((f) => f.staff).join('/') || '—'}, food ${Math.round(stock('wheatFarm'))})` +
    ` granary ${Math.round(stock('granary'))} agora ${Math.round(stock('agora'))} fed ${fed}/${houses.length}`;
}

function tierCounts(city: World): string {
  return HOUSE_TIERS.map((tier, index) => {
    const count = [...city.buildings.values()].filter(
      (building) => building.kind === 'house' && building.tier === index,
    ).length;
    return count === 0 ? '' : `${tier.name} ${count}`;
  })
    .filter(Boolean)
    .join(' · ');
}

function bestStreet(city: World): { y: number; from: number; to: number; meadow: number } {
  let best = { y: 0, from: 0, to: 0, meadow: -1 };

  for (let y = 14; y < city.grid.size - 14; y++) {
    let start = -1;
    for (let x = 6; x < city.grid.size - 6; x++) {
      const clear = city.grid.isFree(x, y) && city.grid.heightAt(x, y) === city.grid.heightAt(6, y);
      if (clear && start === -1) start = x;
      if (!clear) start = -1;
      if (!clear || x - start < 20) continue;

      const meadow = meadowNear(city, y);
      if (meadow > best.meadow) best = { y, from: start, to: x, meadow };
    }
  }
  return best;
}

function meadowNear(city: World, y: number): number {
  let count = 0;
  for (let row = y - 10; row < y + 10; row++) {
    for (let x = 6; x < city.grid.size - 6; x++) {
      if (!city.grid.contains(x, row)) continue;
      if (city.grid.terrain[city.grid.index(x, row)] === 2) count += 1;
    }
  }
  return count;
}
