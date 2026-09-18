import { CURRENT_VERSION, WORLD_LABEL, type ActionResult, type Building, type BuildingKind, type BuildTool, type City, type Food, type Placement, type Resource, type Rotation, type StallGood, type Stores, type Summary, type TaskKind, type Tile, type Walker, type WalkerKind, type World } from './types';
import { BUILDINGS, HOUSE_CAPACITY, MONTH_SECONDS, ROAD_COST, SCENARIO_MONEY, TOP_TIER, VENDOR_COST, footprint, isFood } from './catalog';
import { retireRespawned, wildlifeRoster } from './wildlife';
import type { CityColor } from './colors';
import { gatherArrival, gatherErrand, gatherFinished, gatherKind, GATHER_STOCK_CAP, isGatherer, regrowForest, updateGatherer, type GathererKind } from './gathering';
import { findHarbourSite, harbourApron } from './founding';
import { freshHarbour, HARBOUR_DOCK_CAP, harbourStatus, harbourTiles, setHarbourTrade, updateHarbour } from './harbour';
import { pressStatus, updatePress } from './olives';
import { setStall, stallGoodOf, stallOf, stallServing, stallsInstalled, STALL_GOODS, STALL_TRADES } from './stalls';
import { unlockRefusal } from './unlocks';
import { buildable, insideMapOn, islandFor, levelOn, onHomeIsland, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import {
  accessDoors,
  accessTiles,
  bfsReachable,
  bfsShortest,
  buildServiceCircuit,
  harbourDoors,
  exitTile,
  findNearestConnected,
  footprintTiles,
  neighbours,
} from './grid';
import { mixedEdgeAllowed, stairLayout, stairPlacementConflict, type Stair, type StairIssue } from './stairs';
import { shoreSite } from './shore';
import { foreignOccupancy, type ForeignOccupancy } from './occupancy';
import {
  AGORA_CAP,
  ARRIVAL_INTERVAL,
  IMMIGRANT_PARTY,
  BUYER_FETCH_CAPACITY,
  CART_CAPACITY,
  CONDITION_DECAY_PER_SECOND,
  EMPLOYMENT_SHARE,
  FARM_GROW_SECONDS,
  FARM_STOCK_CAP,
  ORCHARD_GROW_SECONDS,
  PRESS_CAP,
  FOOD_CONSUMPTION_PER_RESIDENT,
  GRACE_SECONDS,
  GRANARY_CAP,
  HARVEST_UNITS,
  HOUSE_WATER_CAP,
  OIL_CONSUMPTION_PER_RESIDENT,
  INCOME_PER_RESIDENT,
  REPAIR_AMOUNT,
  ROAD_BUDGET,
  STEP,
  UPGRADE_GRACE,
  VENDOR_TRIP_CAPACITY,
  WALKER_SPEED,
  WATER_DECAY_PER_SECOND,
} from './balance';

export const DEFAULT_SEED = 1;

export function createWorld(seed = DEFAULT_SEED, home?: number, name = 'Oikos', color: CityColor = 'terracotta'): World {
  const map = islandFor(seed, home);
  const site = findHarbourSite(map, map.home);
  if (!site) throw new Error('That island has no shore for a harbour.');
  const city: City = {
    id: 1,
    name,
    color,
    home: map.home,
    money: SCENARIO_MONEY,
    harbour: freshHarbour(site),
    produced: 0,
    delivered: 0,
    roads: harbourApron(site.x, site.z, site.rotation).map((tile) => tileIndexOn(map, tile.x, tile.z)),
    buildings: [],
    walkers: [],
  };
  const world: World = {
    version: CURRENT_VERSION,
    island: WORLD_LABEL,
    seed,
    time: 0,
    remainder: 0,
    nextId: 1,
    nextCityId: 2,
    wildlife: [],
    felled: [],
    regrowth: 0,
    cities: [city],
  };
  world.wildlife = wildlifeRoster(seed);
  world.nextId = world.wildlife.length + 1;
  recomputeConnectivity(world, city);
  return world;
}

export function createSharedWorld(seed = DEFAULT_SEED): World {
  const world: World = {
    version: CURRENT_VERSION,
    island: WORLD_LABEL,
    seed,
    time: 0,
    remainder: 0,
    nextId: 1,
    nextCityId: 1,
    wildlife: [],
    felled: [],
    regrowth: 0,
    cities: [],
  };
  world.wildlife = wildlifeRoster(seed);
  world.nextId = world.wildlife.length + 1;
  return world;
}

function mapOf(world: World, city: City): IslandMap {
  return islandFor(world.seed, city.home);
}

const REASON = {
  outOfBounds: 'Out of bounds.',
  unsuitableTerrain: 'Unsuitable terrain.',
  unevenGround: 'Buildings need level ground.',
  roadTooSteep: 'Roads climb only one step at a time, across the cliff edge.',
  stairAmbiguous: 'A stair can only climb in one direction; that cliff edge already has another way down.',
  stairBackland: 'A stair needs solid, dry ground to land on at the top.',
  stairSideEntry: 'Stairs can only be entered from the front or back, not the side.',
  needsFertileGround: 'Farms need fertile ground.',
  needsGrove: 'Olives root in grass, scrub or fertile ground.',
  needsOpenWater: 'The jetty needs open water behind the quay.',
  needsShore: 'A wharf stands on flat, open shore with water behind it.',
  tileOccupied: 'That tile is occupied.',
  tileOccupiedByRoad: 'That tile is occupied by a road.',
  notEnoughMoney: 'Not enough drachmas.',
  nothingToDemolish: 'Nothing to demolish there.',
  noSuchBuilding: 'No such building.',
  onlyAgoraHostsVendor: 'Only an agora can host a vendor.',
  harbourPermanent: 'The harbour is a permanent fixture.',
  unsettledIsland: 'Build on your settled island. Return to your village with H.',
} as const;

function buildingAt(world: World, city: City, tile: number): Building | undefined {
  if (harbourTiles(world, city).includes(tile)) return city.harbour;
  const map = mapOf(world, city);
  return city.buildings.find((building) => footprintTiles(map, building).includes(tile));
}

function terrainAllows(map: IslandMap, kind: BuildTool, x: number, z: number): boolean {
  const terrain = terrainOn(map, x, z);
  if (kind === 'road') return buildable(terrain) || terrain === 'forest' || terrain === 'cliff';
  const ground = BUILDINGS[kind].ground ?? 'buildable';
  if (ground === 'fertile') return terrain === 'fertile';
  if (ground === 'grove') return terrain === 'grass' || terrain === 'scrub' || terrain === 'fertile';
  return buildable(terrain);
}

function gradeAllowed(map: IslandMap, ax: number, az: number, bx: number, bz: number): boolean {
  const levelA = levelOn(map, ax, az);
  const levelB = levelOn(map, bx, bz);
  const difference = Math.abs(levelA - levelB);
  if (difference === 0) return true;
  if (difference > 1) return false;
  const higherTerrain = levelA > levelB ? terrainOn(map, ax, az) : terrainOn(map, bx, bz);
  return higherTerrain === 'cliff';
}

function groundRefusal(tool: BuildTool): string {
  const ground = tool === 'road' ? 'buildable' : BUILDINGS[tool].ground ?? 'buildable';
  if (ground === 'fertile') return REASON.needsFertileGround;
  if (ground === 'grove') return REASON.needsGrove;
  return REASON.unsuitableTerrain;
}

function stairReason(issue: StairIssue): string {
  if (issue === 'ambiguous') return REASON.stairAmbiguous;
  if (issue === 'backland') return REASON.stairBackland;
  return REASON.stairSideEntry;
}

function neighbourGradeIssue(map: IslandMap, roads: ReadonlySet<number>, tile: number): boolean {
  const { x, z } = tileAtOn(map, tile);
  for (const next of neighbours(map, tile)) {
    if (!roads.has(next)) continue;
    const { x: nx, z: nz } = tileAtOn(map, next);
    if (!gradeAllowed(map, x, z, nx, nz)) return true;
  }
  return false;
}

function freshTilesGradeIssue(map: IslandMap, roads: ReadonlySet<number>, freshTiles: readonly number[]): boolean {
  return freshTiles.some((tile) => neighbourGradeIssue(map, roads, tile));
}

function touchedTiles(map: IslandMap, newTiles: readonly number[]): Set<number> {
  const touched = new Set<number>();
  for (const tile of newTiles) {
    touched.add(tile);
    for (const next of neighbours(map, tile)) touched.add(next);
  }
  return touched;
}

function stairPlacementIssue(map: IslandMap, roads: ReadonlySet<number>, newTiles: readonly number[]): StairIssue | null {
  for (const tile of touchedTiles(map, newTiles)) {
    if (!roads.has(tile)) continue;
    const issue = stairPlacementConflict(map, roads, tile);
    if (issue) return issue;
  }
  return null;
}

function occupancyRefusal(world: World, city: City, foreign: ForeignOccupancy, tile: number): string {
  if (city.roads.includes(tile) || foreign.roads.has(tile)) return REASON.tileOccupiedByRoad;
  if (buildingAt(world, city, tile) || foreign.buildings.has(tile)) return REASON.tileOccupied;
  return '';
}

function footprintRefusal(world: World, city: City, foreign: ForeignOccupancy, tool: BuildTool, baseLevel: number, tile: number): string {
  const map = mapOf(world, city);
  const { x, z } = tileAtOn(map, tile);
  if (levelOn(map, x, z) !== baseLevel) return REASON.unevenGround;
  if (!terrainAllows(map, tool, x, z)) return groundRefusal(tool);
  if (!onHomeIsland(map, x, z)) return REASON.unsettledIsland;
  return occupancyRefusal(world, city, foreign, tile);
}

function shoreRefusal(world: World, city: City, foreign: ForeignOccupancy, tile: number, overWater: boolean): string {
  const map = mapOf(world, city);
  const { x, z } = tileAtOn(map, tile);
  if (overWater) {
    if (terrainOn(map, x, z) !== 'water') return REASON.needsOpenWater;
    return occupancyRefusal(world, city, foreign, tile);
  }
  if (!buildable(terrainOn(map, x, z)) || levelOn(map, x, z) !== 0) return REASON.needsShore;
  if (!onHomeIsland(map, x, z)) return REASON.unsettledIsland;
  return occupancyRefusal(world, city, foreign, tile);
}

function shoreWaterTiles(map: IslandMap, tool: BuildTool, x: number, z: number, rotation: Rotation): Set<number> | null {
  if (tool === 'road' || !BUILDINGS[tool].shore) return null;
  return new Set(shoreSite(tool, x, z, rotation).water.map((tile) => tileIndexOn(map, tile.x, tile.z)));
}

function evaluatePlacement(world: World, city: City, tool: BuildTool, x: number, z: number, rotation: Rotation): Placement {
  const locked = unlockRefusal(city, tool);
  if (locked) return { ok: false, reason: locked, cost: 0, tiles: [] };
  const map = mapOf(world, city);
  const foreign = foreignOccupancy(world, city);
  if (tool === 'road') {
    if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds, cost: 0, tiles: [] };
    const tile = tileIndexOn(map, x, z);
    if (!terrainAllows(map, tool, x, z)) return { ok: false, reason: REASON.unsuitableTerrain, cost: 0, tiles: [tile] };
    if (!onHomeIsland(map, x, z)) return { ok: false, reason: REASON.unsettledIsland, cost: 0, tiles: [tile] };
    if (buildingAt(world, city, tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: [tile] };
    if (foreign.buildings.has(tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: [tile] };
    const already = city.roads.includes(tile);
    if (!already && foreign.roads.has(tile)) return { ok: false, reason: REASON.tileOccupiedByRoad, cost: 0, tiles: [tile] };
    if (neighbourGradeIssue(map, new Set(city.roads), tile)) return { ok: false, reason: REASON.roadTooSteep, cost: 0, tiles: [tile] };
    if (!already) {
      const tentative = new Set(city.roads);
      tentative.add(tile);
      const issue = stairPlacementIssue(map, tentative, [tile]);
      if (issue) return { ok: false, reason: stairReason(issue), cost: 0, tiles: [tile] };
    }
    const cost = already ? 0 : ROAD_COST;
    if (cost > city.money) return { ok: false, reason: REASON.notEnoughMoney, cost, tiles: [tile] };
    return { ok: true, reason: '', cost, tiles: [tile] };
  }

  const definition = BUILDINGS[tool];
  const { width, depth } = footprint(tool, rotation);
  const tiles: number[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const tz = z + dz;
      if (!insideMapOn(map, tx, tz)) return { ok: false, reason: REASON.outOfBounds, cost: definition.cost, tiles: [] };
      tiles.push(tileIndexOn(map, tx, tz));
    }
  }
  const baseLevel = levelOn(map, x, z);
  const overWater = shoreWaterTiles(map, tool, x, z, rotation);
  const refusalOf = (tile: number): string => {
    if (!overWater) return footprintRefusal(world, city, foreign, tool, baseLevel, tile);
    return shoreRefusal(world, city, foreign, tile, overWater.has(tile));
  };
  const refusals = tiles.map((tile) => ({ tile, reason: refusalOf(tile) })).filter((entry) => entry.reason !== '');
  if (refusals.length) {
    return { ok: false, reason: refusals[0].reason, cost: definition.cost, tiles, blocked: refusals.map((entry) => entry.tile) };
  }
  if (definition.cost > city.money) return { ok: false, reason: REASON.notEnoughMoney, cost: definition.cost, tiles };
  return { ok: true, reason: '', cost: definition.cost, tiles };
}

export function placement(world: World, city: City, tool: BuildTool, x: number, z: number, rotation: Rotation = 0): Placement {
  return evaluatePlacement(world, city, tool, x, z, rotation);
}

export function build(world: World, city: City, tool: BuildTool, x: number, z: number, rotation: Rotation = 0): ActionResult {
  const result = evaluatePlacement(world, city, tool, x, z, rotation);
  if (!result.ok) return result;
  const beforeStairs = stairLayout(mapOf(world, city), new Set(city.roads));

  city.money -= result.cost;
  let reason: string;
  if (tool === 'road') {
    const tile = result.tiles[0];
    if (!city.roads.includes(tile)) city.roads.push(tile);
    reason = 'Road laid.';
  } else {
    reason = `${BUILDINGS[tool].name} built.`;
    const building: Building = {
      id: world.nextId++,
      x,
      z,
      kind: tool,
      rotation,
      tier: 1,
      residents: 0,
      food: 0,
      water: 0,
      oil: 0,
      condition: 100,
      stores: {},
      progress: 0,
      workers: 0,
      vendorEnabled: false,
      vendorInstalled: false,
      stalls: {},
      connected: false,
      serviceTimer: 0,
      upgradeTimer: 0,
    };
    city.buildings.push(building);
  }
  recomputeConnectivity(world, city);
  dropInvalidWalkers(world, city, beforeStairs);
  return { ok: true, reason };
}

function evaluateRoadPath(world: World, city: City, tiles: Tile[]): Placement {
  const map = mapOf(world, city);
  const foreign = foreignOccupancy(world, city);
  const existing = new Set(city.roads);
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const { x, z } of tiles) {
    if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds, cost: 0, tiles: indices };
    const tile = tileIndexOn(map, x, z);
    if (seen.has(tile)) continue;
    seen.add(tile);
    if (!terrainAllows(map, 'road', x, z)) return { ok: false, reason: REASON.unsuitableTerrain, cost: 0, tiles: indices, blocked: [tile] };
    if (!onHomeIsland(map, x, z)) return { ok: false, reason: REASON.unsettledIsland, cost: 0, tiles: [...indices, tile], blocked: [tile] };
    if (buildingAt(world, city, tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: indices, blocked: [tile] };
    if (foreign.buildings.has(tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: indices, blocked: [tile] };
    if (!existing.has(tile) && foreign.roads.has(tile)) return { ok: false, reason: REASON.tileOccupiedByRoad, cost: 0, tiles: indices, blocked: [tile] };
    indices.push(tile);
  }

  const fresh = indices.filter((tile) => !existing.has(tile));
  const cost = fresh.length * ROAD_COST;

  if (fresh.length > 0) {
    const tentative = new Set(existing);
    for (const tile of fresh) tentative.add(tile);
    if (freshTilesGradeIssue(map, tentative, fresh)) return { ok: false, reason: REASON.roadTooSteep, cost, tiles: indices };
    const issue = stairPlacementIssue(map, tentative, fresh);
    if (issue) return { ok: false, reason: stairReason(issue), cost, tiles: indices };
  }

  if (cost > city.money) return { ok: false, reason: REASON.notEnoughMoney, cost, tiles: indices };
  return { ok: true, reason: '', cost, tiles: indices };
}

export function roadPathPlacement(world: World, city: City, tiles: Tile[]): Placement {
  return evaluateRoadPath(world, city, tiles);
}

export function placeRoadPath(world: World, city: City, tiles: Tile[]): ActionResult {
  const result = evaluateRoadPath(world, city, tiles);
  if (!result.ok) return { ok: false, reason: result.reason };
  const beforeStairs = stairLayout(mapOf(world, city), new Set(city.roads));

  const existing = new Set(city.roads);
  city.money -= result.cost;
  for (const tile of result.tiles) if (!existing.has(tile)) city.roads.push(tile);
  recomputeConnectivity(world, city);
  dropInvalidWalkers(world, city, beforeStairs);
  return { ok: true, reason: 'Road laid.' };
}

export function demolish(world: World, city: City, x: number, z: number): ActionResult {
  const map = mapOf(world, city);
  if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds };
  const tile = tileIndexOn(map, x, z);

  const building = buildingAt(world, city, tile);
  if (building) {
    if (building.kind === 'harbour') return { ok: false, reason: REASON.harbourPermanent };
    const refund = Math.floor((BUILDINGS[building.kind].cost + stallsInstalled(building.stalls) * VENDOR_COST) / 2);
    city.money += refund;
    removeBuilding(world, city, building.id);
    recomputeConnectivity(world, city);
    return { ok: true, reason: `Demolished, ${refund} drachmas refunded.` };
  }

  const index = city.roads.indexOf(tile);
  if (index === -1) return { ok: false, reason: REASON.nothingToDemolish };
  const beforeStairs = stairLayout(map, new Set(city.roads));
  city.roads.splice(index, 1);
  recomputeConnectivity(world, city);
  dropInvalidWalkers(world, city, beforeStairs);
  return { ok: true, reason: 'Demolished. Roads are not refunded.' };
}

function chasesQuarry(walker: Walker): boolean {
  return walker.kind === 'hunter' || walker.kind === 'fisher';
}

function releaseRetiredQuarries(world: World, retired: Walker[]): void {
  const quarries = new Set<number>();
  for (const walker of retired) {
    if (chasesQuarry(walker) && walker.quarry !== null) quarries.add(walker.quarry);
  }
  if (quarries.size === 0) return;
  for (const city of world.cities) {
    for (const walker of city.walkers) {
      if (chasesQuarry(walker) && walker.quarry !== null && busy(world, walker) && !walker.returning) quarries.delete(walker.quarry);
    }
  }
  for (const animal of world.wildlife) {
    if (quarries.has(animal.id)) animal.cornered = false;
  }
}

function removeBuilding(world: World, city: City, id: number): void {
  city.buildings = city.buildings.filter((building) => building.id !== id);
  const retired = city.walkers.filter((walker) => walker.homeId === id);
  city.walkers = city.walkers.filter((walker) => walker.homeId !== id);
  releaseRetiredQuarries(world, retired);
  for (const walker of city.walkers) {
    if (walker.targetId !== id) continue;
    departOn(world, walker, walker.path.slice(0, walker.step + 1).reverse());
    walker.returning = true;
    walker.targetId = null;
  }
}

function walkerPathValid(map: IslandMap, roads: ReadonlySet<number>, stairs: ReadonlyMap<number, Stair>, walker: Walker): boolean {
  if (walker.path.length === 0) return false;
  const overland = new Set(walker.overland);
  for (let i = 0; i < walker.path.length; i++) {
    const tile = walker.path[i];
    if (!roads.has(tile) && !overland.has(tile)) return false;
    if (i === 0) continue;
    if (!mixedEdgeAllowed(map, roads, stairs, walker.path[i - 1], tile)) return false;
  }
  return true;
}

function stairSignature(stairs: ReadonlyMap<number, Stair>, tile: number): number | undefined {
  return stairs.get(tile)?.down;
}

function currentSegmentChanged(before: ReadonlyMap<number, Stair>, after: ReadonlyMap<number, Stair>, walker: Walker): boolean {
  const current = walker.path[walker.step];
  if (stairSignature(before, current) !== stairSignature(after, current)) return true;
  if (walker.step >= walker.path.length - 1) return false;
  const next = walker.path[walker.step + 1];
  return stairSignature(before, next) !== stairSignature(after, next);
}

export function dropInvalidWalkers(world: World, city: City, beforeStairs?: ReadonlyMap<number, Stair>): void {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const stairs = stairLayout(map, roads);
  const retired: Walker[] = [];
  city.walkers = city.walkers.filter((walker) => {
    const valid = walkerPathValid(map, roads, stairs, walker);
    const changed = beforeStairs ? currentSegmentChanged(beforeStairs, stairs, walker) : false;
    if (valid && !changed) return true;
    retired.push(walker);
    return false;
  });
  releaseRetiredQuarries(world, retired);
}

export function setVendor(city: City, id: number, enabled: boolean, stall: StallGood = 'food'): ActionResult {
  if (id === city.harbour.id) return setHarbourTrade(city.harbour, enabled);
  const building = city.buildings.find((candidate) => candidate.id === id);
  if (!building) return { ok: false, reason: REASON.noSuchBuilding };
  if (building.kind !== 'agora') return { ok: false, reason: REASON.onlyAgoraHostsVendor };
  return setStall(city, building, stall, enabled);
}

export function harbourGate(world: World, city: City): number | null {
  const roads = new Set(city.roads);
  return harbourDoors(world, city).find((tile) => roads.has(tile)) ?? null;
}

function harbourReach(world: World, city: City, roads: ReadonlySet<number>): Set<number> {
  const map = mapOf(world, city);
  const reachable = new Set<number>();
  for (const door of harbourDoors(world, city)) {
    if (!roads.has(door) || reachable.has(door)) continue;
    for (const tile of bfsReachable(map, roads, door)) reachable.add(tile);
  }
  return reachable;
}

export function recomputeConnectivity(world: World, city: City): void {
  const roads = new Set(city.roads);
  const map = mapOf(world, city);
  const reachable = harbourReach(world, city, roads);
  for (const building of city.buildings) {
    building.connected = accessDoors(map, roads, building).some((tile) => reachable.has(tile));
  }
  city.harbour.connected = reachable.size > 0;
}

export function totalStock(building: Building): number {
  return Object.values(building.stores).reduce((sum, amount) => sum + amount, 0);
}

export function addStore(building: Building, food: Resource, amount: number): void {
  const next = (building.stores[food] ?? 0) + amount;
  if (next <= 1e-9) delete building.stores[food];
  else building.stores[food] = next;
}

function richestFood(stores: Stores): Food | null {
  let best: Food | null = null;
  for (const [food, amount] of Object.entries(stores) as [Food, number][]) {
    if (!isFood(food)) continue;
    if (amount > 0 && (best === null || amount > (stores[best] ?? 0))) best = food;
  }
  return best;
}

function jobsOf(building: Building): number {
  return BUILDINGS[building.kind].jobs;
}

export function hasActiveWalker(city: City, homeId: number, kind: WalkerKind): boolean {
  return city.walkers.some((walker) => walker.homeId === homeId && walker.kind === kind);
}

type WalkerSeed = Omit<Walker, 'id' | 'overland' | 'quarry' | 'task' | 'departedAt'> & Partial<Pick<Walker, 'overland' | 'quarry' | 'task'>>;

export function spawnWalker(world: World, city: City, partial: WalkerSeed): Walker {
  const walker: Walker = { id: world.nextId++, overland: [], quarry: null, task: null, departedAt: world.time, ...partial };
  city.walkers.push(walker);
  return walker;
}

export function departOn(world: World, walker: Walker, path: number[]): void {
  walker.path = path;
  walker.departedAt = world.time;
  walker.step = 0;
  walker.progress = 0;
}

export function busy(world: World, walker: Walker): boolean {
  return walker.task !== null && world.time < walker.task.until;
}

export function setTask(world: World, walker: Walker, kind: TaskKind, seconds: number): void {
  walker.task = { kind, since: world.time, until: world.time + seconds };
}

export function tilesTravelled(world: World, walker: Walker): number {
  return Math.min(WALKER_SPEED * (world.time - walker.departedAt), walker.path.length - 1);
}

function updateStaffing(city: City): void {
  const buildings = city.buildings;
  const workplaces = buildings.filter((building) => building.kind !== 'house');
  const population = buildings
    .filter((building) => building.kind === 'house')
    .reduce((sum, house) => sum + house.residents, 0);
  const availableWorkers = Math.floor(population * EMPLOYMENT_SHARE);
  const connectedJobs = workplaces
    .filter((building) => building.connected)
    .reduce((sum, building) => sum + jobsOf(building), 0);
  const ratio = connectedJobs > 0 ? Math.min(1, availableWorkers / connectedJobs) : 0;
  for (const building of workplaces) {
    building.workers = building.connected ? jobsOf(building) * ratio : 0;
  }
}

const CROPS: Partial<Record<BuildingKind, { crop: Food; seconds: number }>> = {
  farm: { crop: 'wheat', seconds: FARM_GROW_SECONDS },
  orchard: { crop: 'olives', seconds: ORCHARD_GROW_SECONDS },
};

function updateGrower(world: World, city: City, field: Building, dt: number): void {
  const growing = CROPS[field.kind]!;
  if (field.connected && field.workers > 0) {
    const ratio = field.workers / jobsOf(field);
    field.progress += (dt / growing.seconds) * ratio;
    if (field.progress >= 1) {
      field.progress -= 1;
      addStore(field, growing.crop, Math.min(HARVEST_UNITS, FARM_STOCK_CAP - totalStock(field)));
      city.produced += HARVEST_UNITS;
    }
  }

  sendCart(world, city, field);
}

export function sendCart(world: World, city: City, producer: Building): void {
  if (!producer.connected || producer.workers <= 0) return;
  if (totalStock(producer) <= 0) return;
  if (hasActiveWalker(city, producer.id, 'cart')) return;
  const resource = (Object.keys(producer.stores) as Resource[])[0];
  const exit = exitTile(world, city, producer);
  if (exit === -1) return;
  const storeKind = storeKindFor(resource);
  const stores = city.buildings.filter((building) => building.kind === storeKind && building.connected && totalStock(building) < storeCapacity(building));
  const found = findNearestConnected(world, city, exit, stores);
  if (!found) return;
  const cargo = Math.min(producer.stores[resource] ?? 0, CART_CAPACITY, storeCapacity(found.building) - totalStock(found.building));
  if (cargo <= 0) return;
  addStore(producer, resource, -cargo);
  spawnWalker(world, city, {
    kind: 'cart',
    homeId: producer.id,
    targetId: found.building.id,
    path: found.path,
    step: 0,
    progress: 0,
    food: resource,
    cargo,
    returning: false,
  });
}

export function storeKindFor(resource: Resource): BuildingKind {
  if (resource === 'olives') return 'press';
  return isFood(resource) ? 'granary' : 'stockpile';
}

export function storeCapacity(building: Building): number {
  if (building.kind === 'agora') return AGORA_CAP;
  if (building.kind === 'harbour') return HARBOUR_DOCK_CAP;
  if (building.kind === 'press') return PRESS_CAP;
  return GRANARY_CAP;
}

function stallWalking(city: City, agora: Building, kind: WalkerKind, good: StallGood): boolean {
  return city.walkers.some((walker) => walker.homeId === agora.id && walker.kind === kind && stallGoodOf(walker.food) === good);
}

function heldForStall(stores: Stores, good: StallGood): Resource | null {
  const trade = STALL_TRADES[good];
  if (good === 'food') return richestFood(stores);
  return (Object.keys(stores) as Resource[]).find((resource) => trade.carries(resource) && (stores[resource] ?? 0) > 0) ?? null;
}

function fetchForStall(world: World, city: City, agora: Building, good: StallGood): void {
  if (stallWalking(city, agora, 'buyer', good) || totalStock(agora) >= AGORA_CAP) return;
  const exit = exitTile(world, city, agora);
  if (exit === -1) return;
  const trade = STALL_TRADES[good];
  const sources = city.buildings.filter((building) => building.kind === trade.source && building.connected && heldForStall(building.stores, good) !== null);
  const found = findNearestConnected(world, city, exit, sources);
  if (!found) return;
  const resource = heldForStall(found.building.stores, good);
  if (!resource) return;
  const cargo = Math.min(found.building.stores[resource] ?? 0, BUYER_FETCH_CAPACITY, AGORA_CAP - totalStock(agora));
  if (cargo <= 0) return;
  addStore(found.building, resource, -cargo);
  spawnWalker(world, city, {
    kind: 'buyer',
    homeId: agora.id,
    targetId: found.building.id,
    path: found.path,
    step: 0,
    progress: 0,
    food: resource,
    cargo,
    returning: false,
  });
}

function sellFromStall(world: World, city: City, agora: Building, good: StallGood): void {
  if (!stallOf(agora, good).enabled || stallWalking(city, agora, 'vendor', good)) return;
  const resource = heldForStall(agora.stores, good);
  if (!resource) return;
  const exit = exitTile(world, city, agora);
  if (exit === -1) return;
  const path = buildServiceCircuit(world, city, exit, ROAD_BUDGET);
  if (path.length <= 1) return;
  const cargo = Math.min(agora.stores[resource] ?? 0, VENDOR_TRIP_CAPACITY);
  addStore(agora, resource, -cargo);
  spawnWalker(world, city, {
    kind: 'vendor',
    homeId: agora.id,
    targetId: null,
    path,
    step: 0,
    progress: 0,
    food: resource,
    cargo,
    returning: false,
  });
}

function updateAgora(world: World, city: City, agora: Building, dt: number): void {
  void dt;
  if (!agora.connected || agora.workers <= 0) return;
  for (const good of STALL_GOODS) {
    if (!stallOf(agora, good).installed) continue;
    fetchForStall(world, city, agora, good);
    sellFromStall(world, city, agora, good);
  }
}

function updateCircuitDispatch(world: World, city: City, building: Building, kind: WalkerKind): void {
  if (!building.connected || building.workers <= 0) return;
  if (hasActiveWalker(city, building.id, kind)) return;
  const exit = exitTile(world, city, building);
  if (exit === -1) return;
  const path = buildServiceCircuit(world, city, exit, ROAD_BUDGET);
  if (path.length <= 1) return;
  spawnWalker(world, city, {
    kind,
    homeId: building.id,
    targetId: null,
    path,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
  });
}

function buildingsAdjacentToTile(world: World, city: City, tile: number): Building[] {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  return city.buildings.filter((building) => accessDoors(map, roads, building).includes(tile));
}

function reverseForReturn(world: World, walker: Walker): void {
  departOn(world, walker, [...walker.path].reverse());
  walker.returning = true;
}

function serviceTileVisit(world: World, city: City, walker: Walker): void {
  if (walker.kind !== 'vendor' && walker.kind !== 'water' && walker.kind !== 'maintenance') return;
  const index = walker.step;
  const tile = walker.path[index];
  if (walker.path.indexOf(tile) !== index) return;

  for (const building of buildingsAdjacentToTile(world, city, tile)) {
    if (walker.kind === 'vendor') {
      const good = stallGoodOf(walker.food);
      if (building.kind !== 'house' || walker.cargo <= 0 || !good) continue;
      const trade = STALL_TRADES[good];
      const held = good === 'oil' ? building.oil : building.food;
      const deliver = Math.min(walker.cargo, trade.drop, trade.houseCap - held);
      if (deliver <= 0) continue;
      if (good === 'oil') building.oil += deliver;
      else building.food += deliver;
      walker.cargo -= deliver;
      city.delivered += deliver;
    } else if (walker.kind === 'water') {
      if (building.kind !== 'house') continue;
      building.water = HOUSE_WATER_CAP;
    } else {
      building.condition = Math.min(100, building.condition + REPAIR_AMOUNT);
    }
  }
}

function onFinalArrival(world: World, city: City, walker: Walker): boolean {
  if (walker.kind === 'hunter' || walker.kind === 'woodcutter' || walker.kind === 'fisher') return gatherArrival(world, city, walker);
  if (walker.kind === 'immigrant') {
    const house = city.buildings.find((building) => building.id === walker.targetId);
    if (house && house.kind === 'house') house.residents = Math.min(HOUSE_CAPACITY[house.tier], house.residents + walker.cargo);
    return true;
  }
  if (walker.kind === 'cart') {
    if (walker.returning) return true;
    const store = city.buildings.find((building) => building.id === walker.targetId);
    if (store && walker.food) {
      const deliver = Math.min(walker.cargo, storeCapacity(store) - totalStock(store));
      addStore(store, walker.food, deliver);
      walker.cargo -= deliver;
    }
    reverseForReturn(world, walker);
    return false;
  }
  if (walker.kind === 'buyer') {
    if (walker.returning) return true;
    const agora = city.buildings.find((building) => building.id === walker.homeId);
    if (agora && walker.food) {
      const deliver = Math.min(walker.cargo, AGORA_CAP - totalStock(agora));
      addStore(agora, walker.food, deliver);
      walker.cargo -= deliver;
    }
    reverseForReturn(world, walker);
    return false;
  }
  if (walker.kind === 'porter') {
    if (walker.returning) return true;
    const harbour = city.harbour;
    if (walker.food) {
      const deliver = Math.min(walker.cargo, storeCapacity(harbour) - totalStock(harbour));
      addStore(harbour, walker.food, deliver);
      walker.cargo -= deliver;
    }
    reverseForReturn(world, walker);
    return false;
  }
  if (walker.kind === 'vendor' && walker.cargo > 0) {
    const agora = city.buildings.find((building) => building.id === walker.homeId);
    if (agora && walker.food) addStore(agora, walker.food, Math.min(walker.cargo, AGORA_CAP - totalStock(agora)));
    walker.cargo = 0;
  }
  return true;
}

function moveWalkers(world: World, city: City): void {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const stairs = stairLayout(map, roads);
  const alive: Walker[] = [];
  for (const walker of city.walkers) {
    if (!walkerPathValid(map, roads, stairs, walker)) continue;
    if (walker.task !== null) {
      if (busy(world, walker) || !gatherFinished(world, city, walker)) alive.push(walker);
      continue;
    }
    if (walker.path.length === 1) {
      if (!onFinalArrival(world, city, walker)) alive.push(walker);
      continue;
    }

    const travelled = tilesTravelled(world, walker);
    let done = false;
    while (walker.step < walker.path.length - 1) {
      if (travelled < walker.step + 1) {
        walker.progress = travelled - walker.step;
        break;
      }
      walker.step += 1;
      walker.progress = 0;
      serviceTileVisit(world, city, walker);
      if (walker.step >= walker.path.length - 1) {
        done = onFinalArrival(world, city, walker);
        break;
      }
    }
    if (!done) alive.push(walker);
  }
  city.walkers = alive;
}

function arrivingResidents(city: City, houseId: number): number {
  return city.walkers
    .filter((walker) => walker.kind === 'immigrant' && walker.targetId === houseId)
    .reduce((sum, walker) => sum + walker.cargo, 0);
}

function sendImmigrants(world: World, city: City, house: Building, party: number): void {
  if (party <= 0) return;
  const roads = new Set(city.roads);
  const goals = new Set(accessTiles(world, city, house));
  const start = harbourGate(world, city);
  if (start === null) return;
  const path = bfsShortest(mapOf(world, city), roads, start, (tile) => goals.has(tile));
  if (!path) return;
  spawnWalker(world, city, {
    kind: 'immigrant',
    homeId: house.id,
    targetId: house.id,
    path,
    step: 0,
    progress: 0,
    food: null,
    cargo: party,
    returning: false,
  });
}

function meetsTierNeed(tier: number, house: Building): boolean {
  if (tier >= 2 && house.food <= 0) return false;
  if (tier >= 3 && house.water <= 0) return false;
  if (tier >= 4 && house.oil <= 0) return false;
  return true;
}

function tickHouse(world: World, city: City, house: Building, dt: number): void {
  if (house.residents > 0) {
    house.food = Math.max(0, house.food - FOOD_CONSUMPTION_PER_RESIDENT * house.residents * dt);
    house.oil = Math.max(0, house.oil - OIL_CONSUMPTION_PER_RESIDENT * house.residents * dt);
  }
  house.water = Math.max(0, house.water - WATER_DECAY_PER_SECOND * dt);
  house.condition = Math.max(0, house.condition - CONDITION_DECAY_PER_SECOND * dt);

  const satisfied = meetsTierNeed(house.tier, house);

  if (!satisfied) {
    house.serviceTimer += dt;
    house.upgradeTimer = 0;
    if (house.serviceTimer >= GRACE_SECONDS) {
      house.serviceTimer = 0;
      if (house.tier > 1) {
        house.tier = (house.tier - 1) as Building['tier'];
        house.residents = Math.min(house.residents, HOUSE_CAPACITY[house.tier]);
      }
    }
    return;
  }
  house.serviceTimer = 0;

  if (!house.connected) {
    house.upgradeTimer = 0;
    return;
  }

  const capacity = HOUSE_CAPACITY[house.tier];
  const expected = arrivingResidents(city, house.id);
  if (house.residents + expected < capacity) {
    house.upgradeTimer += dt;
    if (house.upgradeTimer >= ARRIVAL_INTERVAL) {
      house.upgradeTimer = 0;
      sendImmigrants(world, city, house, Math.min(IMMIGRANT_PARTY, capacity - house.residents - expected));
    }
    return;
  }
  if (house.residents < capacity) return;

  if (house.tier >= TOP_TIER) {
    house.upgradeTimer = 0;
    return;
  }

  const nextTier = house.tier + 1;
  if (!meetsTierNeed(nextTier, house)) {
    house.upgradeTimer = 0;
    return;
  }

  house.upgradeTimer += dt;
  if (house.upgradeTimer >= UPGRADE_GRACE) {
    house.upgradeTimer = 0;
    house.tier = nextTier as Building['tier'];
  }
}

function updateFinances(city: City, dt: number): void {
  const summary = getSummary(city);
  city.money += summary.balance * (dt / MONTH_SECONDS);
}

function simulationStep(world: World, dt: number): void {
  world.time += dt;
  for (const city of world.cities) {
    updateStaffing(city);
    for (const building of city.buildings) {
      if (CROPS[building.kind]) updateGrower(world, city, building, dt);
      else if (building.kind === 'press') updatePress(city, building, dt);
      else if (isGatherer(building.kind)) updateGatherer(world, city, building);
      else if (building.kind === 'agora') updateAgora(world, city, building, dt);
      else if (building.kind === 'fountain') updateCircuitDispatch(world, city, building, 'water');
      else if (building.kind === 'maintenance') updateCircuitDispatch(world, city, building, 'maintenance');
    }
    updateHarbour(world, city, dt);
    moveWalkers(world, city);
  }
  retireRespawned(world);
  regrowForest(world, dt);
  for (const city of world.cities) {
    for (const building of city.buildings) {
      if (building.kind === 'house') tickHouse(world, city, building, dt);
    }
    updateFinances(city, dt);
  }
}

export function advance(world: World, seconds: number): void {
  if (world.cities.length === 0) return;
  world.remainder += seconds;
  while (world.remainder >= STEP) {
    world.remainder -= STEP;
    simulationStep(world, STEP);
  }
}

export function getSummary(city: City): Summary {
  const houses = city.buildings.filter((building) => building.kind === 'house');
  const workplaces = city.buildings.filter((building) => building.kind !== 'house');
  const population = houses.reduce((sum, house) => sum + house.residents, 0);
  const workers = workplaces.reduce((sum, building) => sum + building.workers, 0);
  const jobs = workplaces.reduce((sum, building) => sum + jobsOf(building), 0);
  const food = city.buildings
    .filter((building) => building.kind === 'granary' || building.kind === 'agora')
    .reduce((sum, building) => sum + totalStock(building), 0);
  const income = houses.reduce((sum, house) => sum + house.residents * INCOME_PER_RESIDENT, 0);
  const upkeep = workplaces.reduce((sum, building) => sum + BUILDINGS[building.kind].upkeep, 0);
  const balance = income - upkeep;
  const prosperous = houses.filter((house) => house.tier >= 3 && house.residents > 0).length;
  const townhouses = houses.filter((house) => house.tier >= 4 && house.residents > 0).length;
  const goal = prosperous >= 4 && balance >= 0 && city.produced > 0 && city.delivered > 0;
  return { population, workers, jobs, food, income, upkeep, balance, prosperous, townhouses, goal };
}

function houseStatus(city: City, building: Building): string[] {
  const lines: string[] = [];
  const capacity = HOUSE_CAPACITY[building.tier];

  if (building.residents === 0) {
    lines.push('Waiting for settlers from the harbour.');
  } else if (!meetsTierNeed(building.tier, building)) {
    lines.push(shortfallAdvice(city, building));
  } else if (building.residents < capacity) {
    lines.push('Waiting for settlers from the harbour.');
  } else if (building.tier < TOP_TIER) {
    lines.push(growthAdvice(city, building));
  } else {
    lines.push('A prosperous townhouse.');
  }

  if (building.condition < 50) lines.push(neglectAdvice(city));
  return lines;
}

function shortfallAdvice(city: City, house: Building): string {
  if (house.tier >= 4 && house.oil <= 0) return oilServed(city) ? 'Out of oil; an oil stall visit is needed.' : 'Out of oil; no agora oil stall is serving the streets.';
  if (house.tier >= 3 && house.water <= 0) return 'Out of water; a fountain visit is needed.';
  return vendorServing(city) ? 'Out of food; a vendor visit is needed.' : 'Out of food; no agora vendor is serving the streets.';
}

function growthAdvice(city: City, house: Building): string {
  const nextTier = house.tier + 1;
  if (nextTier >= 2 && house.food <= 0) return foodAdvice(city);
  if (nextTier >= 3 && house.water <= 0) return 'Needs water to become a courtyard house.';
  if (nextTier >= 4 && house.oil <= 0) return oilAdvice(city);
  return 'Ready to grow.';
}

function oilServed(city: City): boolean {
  return city.buildings.some((candidate) => stallServing(candidate, 'oil'));
}

function oilAdvice(city: City): string {
  if (oilServed(city)) return 'Needs oil to become a townhouse; the oil stall has yet to call.';
  return 'Needs oil to become a townhouse: add an oil stall to an agora.';
}

function agoraStatus(city: City, agora: Building): string[] {
  const open = STALL_GOODS.filter((good) => stallOf(agora, good).installed);
  if (open.length === 0) return ['Add a food stall to start deliveries.'];
  return open.map((good) => {
    const trade = STALL_TRADES[good];
    const name = trade.name.charAt(0).toUpperCase() + trade.name.slice(1);
    if (!stallOf(agora, good).enabled) return `${name} closed.`;
    const walking = city.walkers.some((walker) => walker.homeId === agora.id && walker.kind === 'vendor' && stallGoodOf(walker.food) === good);
    return walking ? `${name} out on the streets.` : `${name} resting at market.`;
  });
}

function growerStatus(city: City, field: Building): string[] {
  const growing = CROPS[field.kind]!;
  if (totalStock(field) > 0 && !hasActiveWalker(city, field.id, 'cart')) {
    return [`Harvest ready, but no ${BUILDINGS[storeKindFor(growing.crop)].name.toLowerCase()} to send it to.`];
  }
  return [`Growing ${growing.crop}, ${Math.round(field.progress * 100)}% to harvest.`];
}

function vendorServing(city: City): boolean {
  return city.buildings.some((candidate) => stallServing(candidate, 'food'));
}

function foodAdvice(city: City): string {
  if (vendorServing(city)) return 'Needs food to grow; the vendor has yet to call.';
  return 'Needs food to grow: add an agora vendor nearby.';
}

function neglectAdvice(city: City): string {
  const caretakers = city.buildings.some((candidate) => candidate.kind === 'maintenance' && candidate.connected);
  return caretakers ? 'Neglected; a caretaker will repair it.' : 'Neglected; build a maintenance post.';
}

const GATHERER_LINES: Record<GathererKind, { out: string; full: string; barren: string; resting: string }> = {
  hunter: {
    out: 'Hunter out after game.',
    full: 'Full of meat; waiting for a cart to a granary.',
    barren: 'No game within reach; the herds will wander back.',
    resting: 'Hunter resting at the lodge.',
  },
  woodcutter: {
    out: 'Woodcutter in the forest.',
    full: 'Full of lumber; waiting for a cart to a stockpile.',
    barren: 'No standing trees within reach; the forest is regrowing.',
    resting: 'Woodcutter resting at the cabin.',
  },
  fisher: {
    out: 'Boat out on the water.',
    full: 'Full of fish; waiting for a cart to a granary.',
    barren: 'No shoals within reach; the fish will return.',
    resting: 'Boat tied up at the wharf.',
  },
};

function gathererStatus(world: World, city: City, building: Building): string[] {
  const lines = GATHERER_LINES[gatherKind(building)];
  if (hasActiveWalker(city, building.id, gatherKind(building))) return [lines.out];
  if (totalStock(building) >= GATHER_STOCK_CAP) return [lines.full];
  if (!gatherErrand(world, city, building)) return [lines.barren];
  return [lines.resting];
}

export function buildingStatus(world: World, city: City, building: Building): string[] {
  if (!building.connected) return ['Not linked to a road; nobody can reach it.'];
  if (building.kind === 'house') return houseStatus(city, building);

  const definition = BUILDINGS[building.kind];
  const lines: string[] = [];

  if (building.workers < definition.jobs * .999) {
    lines.push(building.workers > 0 ? 'Short of workers; more settlers are needed.' : 'Unstaffed; settlers are needed for work.');
  } else if (CROPS[building.kind]) {
    lines.push(...growerStatus(city, building));
  } else if (building.kind === 'press') {
    lines.push(...pressStatus(building));
  } else if (building.kind === 'granary') {
    lines.push(totalStock(building) > 0 ? 'Stocked and ready for buyers.' : 'Empty; waiting for a farm cart.');
  } else if (building.kind === 'agora') {
    lines.push(...agoraStatus(city, building));
  } else if (building.kind === 'fountain') {
    lines.push(hasActiveWalker(city, building.id, 'water') ? 'Water carrier making the rounds.' : 'Water carrier resting at the fountain.');
  } else if (building.kind === 'maintenance') {
    lines.push(hasActiveWalker(city, building.id, 'maintenance') ? 'Caretaker doing rounds.' : 'Caretaker resting at the post.');
  } else if (isGatherer(building.kind)) {
    lines.push(...gathererStatus(world, city, building));
  } else if (building.kind === 'harbour') {
    lines.push(...harbourStatus(building));
  }

  if (building.condition < 50) lines.push(neglectAdvice(city));
  return lines;
}


const NAMES = ['Alexios', 'Dorotheos', 'Eirene', 'Helena', 'Ione', 'Kallias', 'Lysandra', 'Myron', 'Nikias', 'Phaedra', 'Theron', 'Xanthe', 'Zosime', 'Demos', 'Chloe', 'Philon'];

export const WALKER_ROLES: Record<WalkerKind, string> = {
  cart: 'Farm carter',
  buyer: 'Agora buyer',
  vendor: 'Food vendor',
  water: 'Water carrier',
  maintenance: 'Caretaker',
  immigrant: 'Settlers',
  hunter: 'Hunter',
  woodcutter: 'Woodcutter',
  fisher: 'Fisher',
  porter: 'Harbour porter',
};

export function walkerName(walker: Walker): string {
  if (walker.kind === 'immigrant') return `${NAMES[walker.id % NAMES.length]} and family`;
  return NAMES[walker.id % NAMES.length];
}

export function walkerStatus(city: City, walker: Walker): string[] {
  const home = city.buildings.find((building) => building.id === walker.homeId);
  const target = city.buildings.find((building) => building.id === walker.targetId);
  const named = (building: Building | undefined) => building ? (building.kind === 'house' ? 'a house' : `the ${BUILDINGS[building.kind].name.toLowerCase()}`) : 'home';
  const load = walker.food ? `${Math.round(walker.cargo)} ${walker.food}` : '';
  switch (walker.kind) {
    case 'immigrant':
      return [`${walker.cargo} settlers walking from the harbour to their new home.`];
    case 'cart':
      if (walker.returning) return [`Cart empty, heading back to ${named(home)}.`];
      return [`Carting ${load} to ${named(target)}.`];
    case 'hunter':
      if (walker.returning) return walker.cargo > 0 ? [`Carrying ${load} back to the lodge.`] : ['The quarry got away; heading back to the lodge.'];
      return ['Stalking game through the wild.'];
    case 'woodcutter':
      if (walker.returning) return walker.cargo > 0 ? [`Hauling ${load} back to the cabin.`] : ['Found no standing tree; heading back to the cabin.'];
      return ['Heading into the forest with an axe.'];
    case 'fisher':
      if (walker.returning) return walker.cargo > 0 ? [`Rowing ${load} back to the wharf.`] : ['The shoal scattered; rowing back to the wharf.'];
      return ['Out on the water, making for a shoal.'];
    case 'buyer':
      if (walker.returning) return [`Bringing ${load} back to ${named(home)}.`];
      return [`Off to ${named(target)} to fetch food.`];
    case 'porter':
      if (walker.returning) return [`Bringing ${load} back to ${named(home)}.`];
      return [`Off to ${named(target)} to fetch lumber.`];
    case 'vendor':
      if (walker.cargo > 0) return [`Selling ${load} door to door.`];
      return ['Sold out; returning to the agora.'];
    case 'water':
      return ['Filling jars at every house along the way.'];
    case 'maintenance':
      return ['Checking and repairing buildings along the way.'];
  }
}
