import type { Animal, Building, Walker, World } from './types';
import { footprint } from './catalog';
import { primaryCity } from './city';
import { buildable, islandFor, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import { accessTiles, footprintTiles, mapOf } from './grid';
import { addStore, hasActiveWalker, sendCart, spawnWalker, totalStock } from './world';
import { alive, killAnimal } from './wildlife';
import { mixedEdgeAllowed, stairLayout } from './stairs';

export const GATHER_RANGE = 14;
export const GATHER_STOCK_CAP = 200;
export const LUMBER_PER_TREE = 25;
export const REGROW_SECONDS = 480;
export const CATCH_RADIUS = 2;

function passable(world: World, map: IslandMap, roads: Set<number>, index: number): boolean {
  if (roads.has(index)) return true;
  const { x, z } = tileAtOn(map, index);
  const terrain = terrainOn(map, x, z);
  if (terrain === 'water' || terrain === 'rock') return false;
  if (!buildable(terrain) && terrain !== 'forest' && terrain !== 'cliff') return false;
  return !world.buildings.some((building) => {
    const size = footprint(building.kind, building.rotation);
    return x >= building.x && x < building.x + size.width && z >= building.z && z < building.z + size.depth;
  });
}

export function overlandPath(world: World, start: number, isGoal: (tile: number) => boolean, limit: number): number[] | null {
  const map = mapOf(world);
  const roads = new Set(world.roads);
  const stairs = stairLayout(map, roads);
  const cameFrom = new Map<number, number>([[start, -1]]);
  const distance = new Map<number, number>([[start, 0]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (isGoal(current)) {
      const path: number[] = [];
      let node = current;
      while (node !== -1) {
        path.push(node);
        node = cameFrom.get(node) ?? -1;
      }
      return path.reverse();
    }
    if ((distance.get(current) ?? 0) >= limit) continue;
    const { x, z } = tileAtOn(map, current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
      const next = tileIndexOn(map, nx, nz);
      if (cameFrom.has(next) || !passable(world, map, roads, next) || !mixedEdgeAllowed(map, roads, stairs, current, next)) continue;
      cameFrom.set(next, current);
      distance.set(next, (distance.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  return null;
}

function animalTile(map: IslandMap, animal: Animal): number {
  return tileIndexOn(map, Math.floor(animal.x), Math.floor(animal.z));
}

function huntable(animal: Animal): boolean {
  return alive(animal) && (animal.kind === 'boar' || animal.kind === 'rabbit');
}

function standingForest(world: World, map: IslandMap, index: number): boolean {
  const { x, z } = tileAtOn(map, index);
  return terrainOn(map, x, z) === 'forest' && !world.felled.includes(index);
}

function nearestAdjacentToForest(world: World, map: IslandMap, index: number): boolean {
  const { x, z } = tileAtOn(map, index);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) return false;
    return standingForest(world, map, tileIndexOn(map, nx, nz));
  });
}

export function updateGatherer(world: World, building: Building): void {
  if (!building.connected || building.workers <= 0) return;
  sendCart(world, building);
  const kind = building.kind === 'lodge' ? 'hunter' : 'woodcutter';
  if (hasActiveWalker(world, building.id, kind)) return;
  if (totalStock(building) >= GATHER_STOCK_CAP) return;
  const map = mapOf(world);
  const doors = accessTiles(world, building);
  if (doors.length === 0) return;
  const start = doors[0];
  const path = kind === 'hunter'
    ? overlandPath(world, start, (tile) => world.wildlife.some((animal) => huntable(animal) && animalTile(map, animal) === tile), GATHER_RANGE)
    : overlandPath(world, start, (tile) => !new Set(footprintTiles(map, building)).has(tile) && nearestAdjacentToForest(world, map, tile), GATHER_RANGE);
  if (!path) return;
  let quarry: number | null = null;
  if (kind === 'hunter') {
    const goal = path[path.length - 1];
    quarry = world.wildlife.find((animal) => huntable(animal) && animalTile(map, animal) === goal)?.id ?? null;
  } else {
    const goal = tileAtOn(map, path[path.length - 1]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const candidate = tileIndexOn(map, goal.x + dx, goal.z + dz);
      if (standingForest(world, map, candidate)) { quarry = candidate; break; }
    }
  }
  const roads = new Set(world.roads);
  spawnWalker(world, {
    kind,
    homeId: building.id,
    targetId: null,
    path,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
    overland: path.filter((tile) => !roads.has(tile)),
    quarry,
  });
}

export const HUNT_SECONDS = 2;
export const FELL_SECONDS = 4;

export function gatherArrival(world: World, walker: Walker): boolean {
  if (walker.returning) {
    const home = world.buildings.find((building) => building.id === walker.homeId);
    if (home && walker.food && walker.cargo > 0) addStore(home, walker.food, Math.min(walker.cargo, GATHER_STOCK_CAP - totalStock(home)));
    return true;
  }
  const map = mapOf(world);
  if (walker.kind === 'hunter') {
    const prey = world.wildlife.find((animal) => animal.id === walker.quarry);
    if (prey && huntable(prey) && withinReach(map, walker, prey)) {
      prey.cornered = true;
      walker.working = HUNT_SECONDS;
      return false;
    }
  } else if (walker.quarry !== null && standingForest(world, map, walker.quarry)) {
    walker.working = FELL_SECONDS;
    return false;
  }
  turnHome(walker);
  return false;
}

export function gatherFinished(world: World, walker: Walker): boolean {
  const map = mapOf(world);
  if (walker.kind === 'hunter') {
    const prey = world.wildlife.find((animal) => animal.id === walker.quarry);
    if (prey && huntable(prey) && withinReach(map, walker, prey)) {
      walker.cargo = killAnimal(prey);
      walker.food = 'meat';
      primaryCity(world).produced += walker.cargo;
    }
    if (prey) prey.cornered = false;
  } else if (walker.quarry !== null && standingForest(world, map, walker.quarry)) {
    world.felled.push(walker.quarry);
    walker.cargo = LUMBER_PER_TREE;
    walker.food = 'lumber';
    primaryCity(world).produced += walker.cargo;
  }
  turnHome(walker);
  return false;
}

function withinReach(map: IslandMap, walker: Walker, prey: Animal): boolean {
  const here = tileAtOn(map, walker.path[walker.path.length - 1]);
  return Math.hypot(prey.x - here.x - .5, prey.z - here.z - .5) < CATCH_RADIUS;
}

function turnHome(walker: Walker): void {
  walker.path = [...walker.path].reverse();
  walker.step = 0;
  walker.progress = 0;
  walker.returning = true;
  walker.quarry = null;
}

export function regrowForest(world: World, dt: number): void {
  if (world.felled.length === 0) return;
  world.regrowth += dt;
  if (world.regrowth < REGROW_SECONDS) return;
  world.regrowth = 0;
  const map = islandFor(world.seed);
  const occupied = new Set(world.roads);
  for (const building of world.buildings) for (const tile of footprintTiles(map, building)) occupied.add(tile);
  const oldest = world.felled.find((tile) => !occupied.has(tile));
  if (oldest !== undefined) world.felled = world.felled.filter((tile) => tile !== oldest);
}
