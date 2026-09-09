import { HOUSE_TIERS } from './sim/buildings';
import { TICKS_PER_MONTH } from './sim/time';
import type { BuildingKind } from './sim/types';
import { World } from './sim/world';

const world = new World(60, 5);
world.treasury = 20000;

const rows = [20, 30];
for (const row of rows) for (let x = 2; x < 58; x++) world.placeRoad(x, row);
for (let y = 20; y < 31; y++) world.placeRoad(30, y);

const connected = (row: number) => {
  const g = world.grid;
  let run = 0;
  let best = 0;
  for (let x = 2; x < 58; x++) {
    run = g.isRoad(g.index(x, row)) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
};
console.log('longest road run', rows.map(connected).join('/'));

const built: Record<string, number> = {};
function placeSome(kind: BuildingKind, count: number): void {
  let placed = 0;
  for (const y of [18, 21, 28, 31]) {
    for (let x = 3; x < 57 && placed < count; x++) {
      if (!world.place(kind, x, y)) continue;
      placed += 1;
      built[kind] = (built[kind] ?? 0) + 1;
    }
  }
}

placeSome('house', 24);
placeSome('wheatFarm', 6);
placeSome('granary', 2);
placeSome('agora', 2);
placeSome('fountain', 4);
placeSome('college', 2);
placeSome('podium', 3);
placeSome('gymnasium', 2);
placeSome('dramaSchool', 1);
placeSome('theatre', 1);
placeSome('cardingShed', 3);
placeSome('growersLodge', 2);
placeSome('olivePress', 2);
placeSome('maintenanceOffice', 3);
placeSome('infirmary', 2);
placeSome('watchpost', 3);
placeSome('taxOffice', 0);

const snapshots: string[] = [];
for (let month = 0; month < 12 * 20; month++) {
  for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
  if (month % 12 === 0) {
    const tiers = HOUSE_TIERS.map((tier, index) => {
      const count = [...world.buildings.values()].filter((b) => b.kind === 'house' && b.tier === index).length;
      return count === 0 ? '' : `${tier.name}:${count}`;
    }).filter(Boolean).join(' ');
    snapshots.push(
      `${world.dateLabel} pop ${world.population} dr ${Math.round(world.treasury)} pop% ${world.sentiment.popularity} | ${tiers}`,
    );
  }
}

console.log('placed', built);
console.log(snapshots.slice(0, 8).join('\n'));
console.log(world.messages.slice(0, 12).join('\n'));
console.log('buildings left', world.buildings.size, 'walkers', world.walkers.size);
