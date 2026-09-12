import type { ActionResult, BuildingKind, Tile, World } from './types';
import { footprint } from './catalog';
import { primaryCity } from './city';
import { buildable, islandFor, levelOn, terrainOn, tileIndexOn, type IslandMap } from './island';
import { neighbours } from './grid';
import { harbourTiles } from './harbour';
import { build, placement, placeRoadPath, setVendor } from './world';

type PlaceableKind = Exclude<BuildingKind, 'harbour'>;
export interface PlannedBuilding { kind: PlaceableKind; x: number; z: number; }
export interface StarterPlan { buildings: PlannedBuilding[]; roads: Tile[]; }

const ORDER: PlaceableKind[] = ['farm', 'granary', 'house', 'house', 'house', 'house', 'agora', 'fountain', 'maintenance'];

function ringAround(map: IslandMap, centre: Tile, radius: number): Tile[] {
  const tiles: Tile[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = centre.x + dx;
      const z = centre.z + dz;
      if (x >= 0 && z >= 0 && x < map.width && z < map.depth) tiles.push({ x, z });
    }
  }
  return tiles;
}

function roadReachable(world: World, map: IslandMap, roads: Set<number>, from: Tile, to: Tile, excluded: Set<number>): Tile[] | null {
  const passable = (index: number) => {
    const x = index % map.width;
    const z = Math.floor(index / map.width);
    if (roads.has(index)) return true;
    if (!buildable(terrainOn(map, x, z))) return false;
    if (harbourTiles(world).includes(index)) return false;
    if (excluded.has(index)) return false;
    return !world.buildings.some((building) => {
      const size = footprint(building.kind, building.rotation);
      return x >= building.x && x < building.x + size.width && z >= building.z && z < building.z + size.depth;
    });
  };
  const start = tileIndexOn(map, from.x, from.z);
  const goal = tileIndexOn(map, to.x, to.z);
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === goal) {
      const path: Tile[] = [];
      let node = current;
      while (node !== -1) {
        path.push({ x: node % map.width, z: Math.floor(node / map.width) });
        node = cameFrom.get(node) ?? -1;
      }
      return path.reverse();
    }
    for (const next of neighbours(map, current)) {
      if (cameFrom.has(next) || !passable(next)) continue;
      if (levelOn(map, next % map.width, Math.floor(next / map.width)) !== levelOn(map, current % map.width, Math.floor(current / map.width))) continue;
      cameFrom.set(next, current);
      queue.push(next);
    }
  }
  return null;
}

function frontDoor(kind: BuildingKind, x: number, z: number): Tile {
  const size = footprint(kind, 0);
  return { x: x + Math.floor(size.width / 2), z: z + size.depth };
}

export function planStarterNeighbourhood(world: World): StarterPlan | null {
  if (!primaryCity(world).founded) return null;
  const map = islandFor(world.seed, primaryCity(world).home);
  const trial = structuredClone(world);
  const roads = new Set(trial.roads);
  const plan: StarterPlan = { buildings: [], roads: [] };
  const roadTop = { x: map.entry.x, z: Math.min(...trial.roads.map((index) => Math.floor(index / map.width))) };
  for (const kind of ORDER) {
    let placed = false;
    for (let radius = 2; radius <= 22 && !placed; radius++) {
      for (const tile of ringAround(map, roadTop, radius)) {
        const check = placement(trial, kind, tile.x, tile.z, 0);
        if (!check.ok) continue;
        const door = frontDoor(kind, tile.x, tile.z);
        if (!buildable(terrainOn(map, door.x, door.z)) && !roads.has(tileIndexOn(map, door.x, door.z))) continue;
        const nearest = [...roads].map((index) => ({ x: index % map.width, z: Math.floor(index / map.width) }))
          .sort((a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z))[0];
        const { width: candidateWidth, depth: candidateDepth } = footprint(kind, 0);
        const ownFootprint = new Set<number>();
        for (let dz = 0; dz < candidateDepth; dz++) {
          for (let dx = 0; dx < candidateWidth; dx++) ownFootprint.add(tileIndexOn(map, tile.x + dx, tile.z + dz));
        }
        const path = roadReachable(trial, map, roads, nearest, door, ownFootprint);
        if (!path || path.length > 24) continue;
        const built = build(trial, kind, tile.x, tile.z, 0);
        if (!built.ok) continue;
        const laid = placeRoadPath(trial, path);
        if (!laid.ok) continue;
        for (const step of path) {
          const index = tileIndexOn(map, step.x, step.z);
          if (!roads.has(index)) {
            roads.add(index);
            plan.roads.push(step);
          }
        }
        plan.buildings.push({ kind, x: tile.x, z: tile.z });
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }
  return plan;
}

export function buildStarterNeighbourhood(world: World): ActionResult {
  const plan = planStarterNeighbourhood(world);
  if (!plan) return { ok: false, reason: 'No room for a starter neighbourhood on this island.' };
  for (const item of plan.buildings) {
    const result = build(world, item.kind, item.x, item.z, 0);
    if (!result.ok) return result;
  }
  const laid = placeRoadPath(world, plan.roads);
  if (!laid.ok) return laid;
  const agora = world.buildings.find((building) => building.kind === 'agora');
  if (!agora) return { ok: false, reason: 'agora missing' };
  return setVendor(world, agora.id, true);
}
