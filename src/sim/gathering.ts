import type { Animal, Building, BuildingKind, City, Rotation, Walker, WalkerKind, World } from './types';
import { footprint } from './catalog';
import { buildable, islandFor, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import { accessTiles, footprintTiles, mapOf, neighbours, perimeterTiles, siteBuilding } from './grid';
import { shoreSite } from './shore';
import { addStore, departOn, hasActiveWalker, sendCart, setTask, spawnWalker, totalStock } from './world';
import { alive, animalAt, animalQuarry, killAnimal, wildlifeObstacles } from './wildlife';
import { mixedEdgeAllowed, stairLayout } from './stairs';

export type GatherWay = 'land' | 'sea';
export type GathererKind = Extract<WalkerKind, 'hunter' | 'woodcutter' | 'fisher'>;

const GATHERERS: Partial<Record<BuildingKind, GathererKind>> = {
  lodge: 'hunter',
  woodcutter: 'woodcutter',
  wharf: 'fisher',
};

export function gatherWay(kind: GathererKind): GatherWay {
  return kind === 'fisher' ? 'sea' : 'land';
}

export const GATHER_RANGE = 14;
export const FISH_RANGE = 16;
export const GATHER_STOCK_CAP = 200;
export const LUMBER_PER_TREE = 25;
export const REGROW_SECONDS = 480;
export const CATCH_RADIUS = 2;

function passable(world: World, map: IslandMap, roads: Set<number>, index: number, way: GatherWay): boolean {
  const { x, z } = tileAtOn(map, index);
  const onAnyCityBuilding = world.cities.some((candidateCity) => [...candidateCity.buildings, candidateCity.harbour].some((building) => {
    const size = footprint(building.kind, building.rotation);
    return x >= building.x && x < building.x + size.width && z >= building.z && z < building.z + size.depth;
  }));
  if (onAnyCityBuilding) return false;
  const terrain = terrainOn(map, x, z);
  if (way === 'sea') return terrain === 'water';
  if (roads.has(index)) return true;
  if (terrain === 'water' || terrain === 'rock') return false;
  return buildable(terrain) || terrain === 'forest' || terrain === 'cliff';
}

function walkOverland(world: World, city: City, starts: readonly number[], limit: number, isGoal: (tile: number) => boolean, way: GatherWay): Map<number, number> {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const stairs = stairLayout(map, roads);
  const cameFrom = new Map<number, number>();
  const distance = new Map<number, number>();
  const queue = [...starts];
  for (const start of starts) {
    cameFrom.set(start, -1);
    distance.set(start, 0);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (isGoal(current)) break;
    if ((distance.get(current) ?? 0) >= limit) continue;
    const { x, z } = tileAtOn(map, current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
      const next = tileIndexOn(map, nx, nz);
      if (cameFrom.has(next) || !passable(world, map, roads, next, way) || !mixedEdgeAllowed(map, roads, stairs, current, next)) continue;
      cameFrom.set(next, current);
      distance.set(next, (distance.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  return cameFrom;
}

export function overlandPath(world: World, city: City, start: number, isGoal: (tile: number) => boolean, limit: number, way: GatherWay = 'land'): number[] | null {
  const cameFrom = walkOverland(world, city, [start], limit, isGoal, way);
  const goal = [...cameFrom.keys()].find(isGoal);
  if (goal === undefined) return null;
  const path: number[] = [];
  let node = goal;
  while (node !== -1) {
    path.push(node);
    node = cameFrom.get(node) ?? -1;
  }
  return path.reverse();
}

function animalTile(world: World, map: IslandMap, occupied: ReadonlySet<number>, animal: Animal): number {
  const place = animalAt(map, occupied, animal, world.time);
  return tileIndexOn(map, Math.floor(place.x), Math.floor(place.z));
}

function huntable(world: World, animal: Animal, way: GatherWay): boolean {
  if (!alive(animal, world.time)) return false;
  if (way === 'sea') return animal.kind === 'fish';
  return animal.kind === 'boar' || animal.kind === 'rabbit';
}

function preyByTile(world: World, map: IslandMap, way: GatherWay): Map<number, number> {
  const occupied = wildlifeObstacles(world);
  const grazing = new Map<number, number>();
  for (const animal of world.wildlife) {
    if (!huntable(world, animal, way)) continue;
    grazing.set(animalTile(world, map, occupied, animal), animal.id);
  }
  return grazing;
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

function berthTiles(map: IslandMap, site: Building): Set<number> {
  return new Set(shoreSite(site.kind, site.x, site.z, site.rotation).water.map((tile) => tileIndexOn(map, tile.x, tile.z)));
}

function gatherOrigins(world: World, city: City, site: Building, way: GatherWay): number[] {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  if (way === 'sea') {
    const berths = berthTiles(map, site);
    return perimeterTiles(map, site)
      .filter((tile) => passable(world, map, roads, tile, way))
      .filter((tile) => neighbours(map, tile).some((next) => berths.has(next)));
  }
  const doors = accessTiles(world, city, site);
  if (doors.length > 0) return [doors[0]];
  return perimeterTiles(map, site).filter((tile) => passable(world, map, roads, tile, way));
}

export function gatherRange(kind: GathererKind): number {
  return kind === 'fisher' ? FISH_RANGE : GATHER_RANGE;
}

export function gatherReach(world: World, city: City, kind: BuildingKind, x: number, z: number, rotation: Rotation): number[] {
  const gatherer = GATHERERS[kind];
  if (!gatherer) return [];
  const way = gatherWay(gatherer);
  const site = siteBuilding(kind, rotation, x, z);
  const origins = gatherOrigins(world, city, site, way);
  if (origins.length === 0) return [];
  const own = new Set(footprintTiles(mapOf(world, city), site));
  const walked = walkOverland(world, city, origins, gatherRange(gatherer), () => false, way);
  return [...walked.keys()].filter((tile) => !own.has(tile));
}

export function isGatherer(kind: BuildingKind): boolean {
  return GATHERERS[kind] !== undefined;
}

export function gatherKind(building: Building): GathererKind {
  return GATHERERS[building.kind] ?? 'woodcutter';
}

export function gatherErrand(world: World, city: City, building: Building): { path: number[]; quarry: number | null } | null {
  const kind = gatherKind(building);
  const way = gatherWay(kind);
  const map = mapOf(world, city);
  const range = gatherRange(kind);
  const origins = gatherOrigins(world, city, building, way);
  if (origins.length === 0) return null;
  if (kind === 'woodcutter') {
    const own = new Set(footprintTiles(map, building));
    const path = overlandPath(world, city, origins[0], (tile) => !own.has(tile) && nearestAdjacentToForest(world, map, tile), range);
    if (!path) return null;
    const goal = tileAtOn(map, path[path.length - 1]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const candidate = tileIndexOn(map, goal.x + dx, goal.z + dz);
      if (standingForest(world, map, candidate)) return { path, quarry: candidate };
    }
    return { path, quarry: null };
  }
  const grazing = preyByTile(world, map, way);
  const cameFrom = walkOverland(world, city, origins, range, (tile) => grazing.has(tile), way);
  const goal = [...cameFrom.keys()].find((tile) => grazing.has(tile));
  if (goal === undefined) return null;
  const path: number[] = [];
  let node = goal;
  while (node !== -1) {
    path.push(node);
    node = cameFrom.get(node) ?? -1;
  }
  path.reverse();
  return { path, quarry: grazing.get(goal) ?? null };
}

export function updateGatherer(world: World, city: City, building: Building): void {
  if (!building.connected || building.workers <= 0) return;
  sendCart(world, city, building);
  if (hasActiveWalker(city, building.id, gatherKind(building))) return;
  if (totalStock(building) >= GATHER_STOCK_CAP) return;
  const errand = gatherErrand(world, city, building);
  if (!errand) return;
  const roads = new Set(city.roads);
  spawnWalker(world, city, {
    kind: gatherKind(building),
    homeId: building.id,
    targetId: null,
    path: errand.path,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
    overland: errand.path.filter((tile) => !roads.has(tile)),
    quarry: errand.quarry,
  });
}

export const HUNT_SECONDS = 2;
export const FELL_SECONDS = 4;
export const NET_SECONDS = 5;

function chase(kind: GathererKind): { task: 'hunt' | 'net'; seconds: number } {
  if (kind === 'fisher') return { task: 'net', seconds: NET_SECONDS };
  return { task: 'hunt', seconds: HUNT_SECONDS };
}

export function gatherArrival(world: World, city: City, walker: Walker): boolean {
  if (walker.returning) {
    const home = city.buildings.find((building) => building.id === walker.homeId);
    if (home && walker.food && walker.cargo > 0) addStore(home, walker.food, Math.min(walker.cargo, GATHER_STOCK_CAP - totalStock(home)));
    return true;
  }
  const map = mapOf(world, city);
  if (walker.kind === 'hunter' || walker.kind === 'fisher') {
    const way = gatherWay(walker.kind);
    const prey = world.wildlife.find((animal) => animal.id === walker.quarry);
    if (prey && huntable(world, prey, way) && withinReach(world, map, walker, prey)) {
      prey.cornered = true;
      const { task, seconds } = chase(walker.kind);
      setTask(world, walker, task, seconds);
      return false;
    }
  } else if (walker.quarry !== null && standingForest(world, map, walker.quarry)) {
    setTask(world, walker, 'chop', FELL_SECONDS);
    return false;
  }
  turnHome(world, walker);
  return false;
}

export function gatherFinished(world: World, city: City, walker: Walker): boolean {
  const map = mapOf(world, city);
  if (walker.kind === 'hunter' || walker.kind === 'fisher') {
    const prey = world.wildlife.find((animal) => animal.id === walker.quarry);
    if (prey && huntable(world, prey, gatherWay(walker.kind)) && withinReach(world, map, walker, prey)) {
      const haul = animalQuarry(prey);
      walker.cargo = killAnimal(world, prey);
      walker.food = haul?.food ?? null;
      city.produced += walker.cargo;
    }
    if (prey) prey.cornered = false;
  } else if (walker.quarry !== null && standingForest(world, map, walker.quarry)) {
    world.felled.push(walker.quarry);
    walker.cargo = LUMBER_PER_TREE;
    walker.food = 'lumber';
    city.produced += walker.cargo;
  }
  turnHome(world, walker);
  return false;
}

function withinReach(world: World, map: IslandMap, walker: Walker, prey: Animal): boolean {
  const here = tileAtOn(map, walker.path[walker.path.length - 1]);
  const place = animalAt(map, wildlifeObstacles(world), prey, world.time);
  return Math.hypot(place.x - here.x - .5, place.z - here.z - .5) < CATCH_RADIUS;
}

function turnHome(world: World, walker: Walker): void {
  departOn(world, walker, [...walker.path].reverse());
  walker.task = null;
  walker.returning = true;
  walker.quarry = null;
}

export function regrowForest(world: World, dt: number): void {
  if (world.felled.length === 0) return;
  world.regrowth += dt;
  if (world.regrowth < REGROW_SECONDS) return;
  world.regrowth = 0;
  const map = islandFor(world.seed);
  const occupied = new Set<number>();
  for (const city of world.cities) {
    for (const road of city.roads) occupied.add(road);
    for (const building of city.buildings) for (const tile of footprintTiles(map, building)) occupied.add(tile);
  }
  const oldest = world.felled.find((tile) => !occupied.has(tile));
  if (oldest !== undefined) world.felled = world.felled.filter((tile) => tile !== oldest);
}
