import type { BuildingKind, Rotation, Tile } from './types';
import { BUILDINGS, footprint } from './catalog';

export const SEAWARD: Record<Rotation, Tile> = {
  0: { x: 0, z: 1 },
  1: { x: -1, z: 0 },
  2: { x: 0, z: -1 },
  3: { x: 1, z: 0 },
};

export interface ShoreSite {
  land: Tile[];
  water: Tile[];
  offshore: Tile[];
}

export function shoreSite(kind: BuildingKind, x: number, z: number, rotation: Rotation): ShoreSite {
  const definition = BUILDINGS[kind];
  const landRows = definition.shore?.land ?? 0;
  const seaward = SEAWARD[rotation];
  const along = { x: Math.abs(seaward.z), z: Math.abs(seaward.x) };
  const { width, depth } = footprint(kind, rotation);
  const start = {
    x: x + (seaward.x < 0 ? width - 1 : 0),
    z: z + (seaward.z < 0 ? depth - 1 : 0),
  };
  const rows = definition.depth;
  const site: ShoreSite = { land: [], water: [], offshore: [] };
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < definition.width; step++) {
      const tile = {
        x: start.x + seaward.x * row + along.x * step,
        z: start.z + seaward.z * row + along.z * step,
      };
      if (row < landRows) site.land.push(tile);
      else site.water.push(tile);
      if (row === rows - 1) site.offshore.push(tile);
    }
  }
  return site;
}

export function seawardOf(tile: Tile, rotation: Rotation, steps = 1): Tile {
  const seaward = SEAWARD[rotation];
  return { x: tile.x + seaward.x * steps, z: tile.z + seaward.z * steps };
}
