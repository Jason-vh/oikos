import { BUILDINGS } from './buildings';
import type { BuildingDef } from './buildings';
import { NO_ROAD_ROW } from './types';
import type { Building, BuildingKind, Good } from './types';

export const AGORA_KINDS: BuildingKind[] = ['agora', 'grandAgora'];
export const STALL_SIZE = 2;
export const STALL_WORKERS = 4;
export const VENDOR_COST = 20;

export const VENDOR_GOODS: Good[] = ['food', 'fleece', 'oil', 'wine', 'armour', 'horses'];

export interface Tile {
  x: number;
  y: number;
}

export interface Plot {
  x: number;
  y: number;
  width: number;
  height: number;
  roadRow: number;
}

export function isAgora(kind: BuildingKind): boolean {
  return AGORA_KINDS.includes(kind);
}

export function stallCountOf(kind: BuildingKind): number {
  return BUILDINGS[kind].stalls ?? 0;
}

export function strip(def: BuildingDef, x: number, y: number, alongX: boolean, offset: number): Plot {
  const length = def.alongRoad ?? def.size;
  if (alongX) return { x, y: y - offset, width: length, height: def.size, roadRow: offset };
  return { x: x - offset, y, width: def.size, height: length, roadRow: offset };
}

export function roadRowOffsets(def: BuildingDef): number[] {
  const bands = bandsOf(def);
  if (bands === 1) return [0, def.size - 1];
  return [(def.size - 1) / 2];
}

export function plotTiles(plot: Plot): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = 0; dy < plot.height; dy++) {
    for (let dx = 0; dx < plot.width; dx++) tiles.push({ x: plot.x + dx, y: plot.y + dy });
  }
  return tiles;
}

export function roadRowTiles(plot: Plot): Tile[] {
  if (plot.roadRow === NO_ROAD_ROW) return [];
  if (plot.width >= plot.height) {
    return along(plot.width, (step) => ({ x: plot.x + step, y: plot.y + plot.roadRow }));
  }
  return along(plot.height, (step) => ({ x: plot.x + plot.roadRow, y: plot.y + step }));
}

export function stallSlots(building: Building): Tile[] {
  const def = BUILDINGS[building.kind];
  if (!def.stalls || building.roadRow === NO_ROAD_ROW) return [];

  const alongX = building.width >= building.height;
  const length = alongX ? building.width : building.height;
  const slots: Tile[] = [];

  for (const band of bandOffsets(def, building.roadRow)) {
    for (let step = 0; step < length; step += STALL_SIZE) {
      slots.push(
        alongX
          ? { x: building.x + step, y: building.y + band }
          : { x: building.x + band, y: building.y + step },
      );
    }
  }
  return slots;
}

export function stallAt(building: Building, x: number, y: number): number {
  return stallSlots(building).findIndex(
    (slot) => x >= slot.x && x < slot.x + STALL_SIZE && y >= slot.y && y < slot.y + STALL_SIZE,
  );
}

export function stallGoods(building: Building): Good[] {
  return building.stalls.filter((good): good is Good => good !== null);
}

export function freeStalls(building: Building): number {
  return building.stalls.filter((good) => good === null).length;
}

function bandsOf(def: BuildingDef): number {
  const perBand = (def.alongRoad ?? def.size) / STALL_SIZE;
  return Math.round((def.stalls ?? 0) / perBand);
}

function bandOffsets(def: BuildingDef, roadRow: number): number[] {
  if (bandsOf(def) === 1) return [roadRow === 0 ? 1 : 0];
  return [0, roadRow + 1];
}

function along(count: number, tile: (step: number) => Tile): Tile[] {
  const tiles: Tile[] = [];
  for (let step = 0; step < count; step++) tiles.push(tile(step));
  return tiles;
}
