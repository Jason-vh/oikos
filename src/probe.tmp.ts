import { World } from './sim/world';
const world = new World(64, 5);
world.treasury = 20000;
for (let x = 17; x <= 38; x++) world.placeRoad(x, 55);
let agora = null, granary = null;
const houses: any[] = [];
for (let x = 17; x < 30 && !agora; x++) if (world.place('agora', x, 56)) agora = [...world.buildings.values()].at(-1)!;
for (let x = 30; x < 38 && !granary; x++) if (world.place('granary', x, 56)) granary = [...world.buildings.values()].at(-1)!;
for (let x = 17; x < 38 && houses.length < 4; x++) if (world.place('house', x, 53)) houses.push([...world.buildings.values()].at(-1)!);
console.log('agora', agora?.x, 'granary', granary?.x, 'houses', houses.map(h => `${h.x},${h.y}`).join(' '));
if (granary) granary.stock.food = 24;
for (let t = 0; t < 9000; t++) {
  world.update();
  if (granary) granary.stock.food = 24;
  if (t % 900 === 0)
    console.log(t, 'pop', world.population, 'timer', Math.round(agora!.spawnTimer), 'agoraStaff', agora!.staff, 'agoraFood', Math.round(agora!.stock.food), 'houseFood', houses.map(h => Math.round(h.supply.food)).join(','),
      'walkers', [...world.walkers.values()].map(w => `${w.kind}:${w.state}`).join(','));
}
