import type { City, World } from './types';
import { footprintTiles } from './grid';
import { harbourTiles } from './harbour';
import { islandFor } from './island';

export interface ForeignOccupancy {
  roads: Set<number>;
  buildings: Set<number>;
}

export function foreignOccupancy(world: World, city: City): ForeignOccupancy {
  const map = islandFor(world.seed);
  const roads = new Set<number>();
  const buildings = new Set<number>();
  for (const other of world.cities) {
    if (other.id === city.id) continue;
    for (const tile of other.roads) roads.add(tile);
    for (const tile of harbourTiles(world, other)) buildings.add(tile);
    for (const building of other.buildings) for (const tile of footprintTiles(map, building)) buildings.add(tile);
  }
  return { roads, buildings };
}
