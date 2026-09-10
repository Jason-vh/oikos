import type { ActionResult, Building, BuildTool, Food, Placement, Rotation, Stores, Summary, Tile, Walker, WalkerKind, World } from './types';
import { BUILDINGS, HOUSE_CAPACITY, MONTH_SECONDS, ROAD_COST, STARTING_MONEY, VENDOR_COST, footprint } from './catalog';
import { buildable, insideMapOn, islandFor, levelOn, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import {
  accessTiles,
  bfsReachable,
  bfsShortest,
  buildServiceCircuit,
  entryTileIndex,
  exitTile,
  findNearestConnected,
  footprintTiles,
  perimeterTiles,
} from './grid';
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
  FOOD_CONSUMPTION_PER_RESIDENT,
  GRACE_SECONDS,
  GRANARY_CAP,
  HARVEST_UNITS,
  HOUSE_FOOD_CAP,
  HOUSE_WATER_CAP,
  INCOME_PER_RESIDENT,
  REPAIR_AMOUNT,
  ROAD_BUDGET,
  STEP,
  UPGRADE_GRACE,
  VENDOR_DROP_AMOUNT,
  VENDOR_TRIP_CAPACITY,
  WALKER_SPEED,
  WATER_DECAY_PER_SECOND,
} from './balance';

export const DEFAULT_SEED = 1;

export function createWorld(seed = DEFAULT_SEED): World {
  const world: World = {
    version: 1,
    island: 'kalliste',
    seed,
    time: 0,
    remainder: 0,
    money: STARTING_MONEY,
    nextId: 1,
    roads: [],
    buildings: [],
    walkers: [],
    produced: 0,
    delivered: 0,
  };
  const map = islandFor(seed);
  const roads = new Set<number>();
  for (let z = map.entry.z; z >= map.entry.z - 8 && terrainOn(map, map.entry.x, z) !== 'water'; z--) roads.add(tileIndexOn(map, map.entry.x, z));
  world.roads = [...roads];
  recomputeConnectivity(world);
  return world;
}

function mapOf(world: World): IslandMap {
  return islandFor(world.seed);
}

const REASON = {
  outOfBounds: 'Out of bounds.',
  unsuitableTerrain: 'Unsuitable terrain.',
  unevenGround: 'Buildings need level ground.',
  roadTooSteep: 'Roads cannot climb cliffs.',
  needsFertileGround: 'Farms need fertile ground.',
  tileOccupied: 'That tile is occupied.',
  tileOccupiedByRoad: 'That tile is occupied by a road.',
  notEnoughMoney: 'Not enough drachmas.',
  nothingToDemolish: 'Nothing to demolish there.',
  noSuchBuilding: 'No such building.',
  onlyAgoraHostsVendor: 'Only an agora can host a vendor.',
} as const;

function buildingAt(world: World, tile: number): Building | undefined {
  const map = mapOf(world);
  return world.buildings.find((building) => footprintTiles(map, building).includes(tile));
}

function terrainAllows(map: IslandMap, kind: BuildTool, x: number, z: number): boolean {
  const terrain = terrainOn(map, x, z);
  if (kind === 'farm') return terrain === 'fertile';
  if (kind === 'road') return buildable(terrain) || terrain === 'forest';
  return buildable(terrain);
}

function evaluatePlacement(world: World, tool: BuildTool, x: number, z: number, rotation: Rotation): Placement {
  const map = mapOf(world);
  if (tool === 'road') {
    if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds, cost: 0, tiles: [] };
    const tile = tileIndexOn(map, x, z);
    if (!terrainAllows(map, tool, x, z)) return { ok: false, reason: REASON.unsuitableTerrain, cost: 0, tiles: [tile] };
    if (buildingAt(world, tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: [tile] };
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => world.roads.includes(tileIndexOn(map, x + dx, z + dz)) && levelOn(map, x + dx, z + dz) !== levelOn(map, x, z));
    if (steps.length > 0) return { ok: false, reason: REASON.roadTooSteep, cost: 0, tiles: [tile] };
    const already = world.roads.includes(tile);
    const cost = already ? 0 : ROAD_COST;
    if (cost > world.money) return { ok: false, reason: REASON.notEnoughMoney, cost, tiles: [tile] };
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
  for (const tile of tiles) {
    const { x: tx, z: tz } = tileAtOn(map, tile);
    if (levelOn(map, tx, tz) !== baseLevel) return { ok: false, reason: REASON.unevenGround, cost: definition.cost, tiles };
    if (!terrainAllows(map, tool, tx, tz)) {
      const reason = tool === 'farm' ? REASON.needsFertileGround : REASON.unsuitableTerrain;
      return { ok: false, reason, cost: definition.cost, tiles };
    }
    if (world.roads.includes(tile)) return { ok: false, reason: REASON.tileOccupiedByRoad, cost: definition.cost, tiles };
    if (buildingAt(world, tile)) return { ok: false, reason: REASON.tileOccupied, cost: definition.cost, tiles };
  }
  if (definition.cost > world.money) return { ok: false, reason: REASON.notEnoughMoney, cost: definition.cost, tiles };
  return { ok: true, reason: '', cost: definition.cost, tiles };
}

export function placement(world: World, tool: BuildTool, x: number, z: number, rotation: Rotation = 0): Placement {
  return evaluatePlacement(world, tool, x, z, rotation);
}

export function build(world: World, tool: BuildTool, x: number, z: number, rotation: Rotation = 0): ActionResult {
  const result = evaluatePlacement(world, tool, x, z, rotation);
  if (!result.ok) return result;

  world.money -= result.cost;
  let reason: string;
  if (tool === 'road') {
    const tile = result.tiles[0];
    if (!world.roads.includes(tile)) world.roads.push(tile);
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
      condition: 100,
      stores: {},
      progress: 0,
      workers: 0,
      vendorEnabled: false,
      vendorInstalled: false,
      connected: false,
      serviceTimer: 0,
      upgradeTimer: 0,
    };
    world.buildings.push(building);
  }
  recomputeConnectivity(world);
  return { ok: true, reason };
}

export function placeRoadPath(world: World, tiles: Tile[]): ActionResult {
  const map = mapOf(world);
  const seen = new Set<number>();
  const indices: number[] = [];
  let previous: Tile | null = null;
  for (const { x, z } of tiles) {
    if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds };
    const tile = tileIndexOn(map, x, z);
    if (seen.has(tile)) continue;
    seen.add(tile);
    if (!terrainAllows(map, 'road', x, z)) return { ok: false, reason: REASON.unsuitableTerrain };
    if (buildingAt(world, tile)) return { ok: false, reason: REASON.tileOccupied };
    if (previous && levelOn(map, previous.x, previous.z) !== levelOn(map, x, z)) return { ok: false, reason: REASON.roadTooSteep };
    previous = { x, z };
    indices.push(tile);
  }

  const existing = new Set(world.roads);
  const fresh = indices.filter((tile) => !existing.has(tile));
  const cost = fresh.length * ROAD_COST;
  if (cost > world.money) return { ok: false, reason: REASON.notEnoughMoney };

  world.money -= cost;
  for (const tile of fresh) world.roads.push(tile);
  recomputeConnectivity(world);
  return { ok: true, reason: 'Road laid.' };
}

export function demolish(world: World, x: number, z: number): ActionResult {
  const map = mapOf(world);
  if (!insideMapOn(map, x, z)) return { ok: false, reason: REASON.outOfBounds };
  const tile = tileIndexOn(map, x, z);

  const building = buildingAt(world, tile);
  if (building) {
    const refund = Math.floor((BUILDINGS[building.kind].cost + (building.vendorInstalled ? VENDOR_COST : 0)) / 2);
    world.money += refund;
    removeBuilding(world, building.id);
    recomputeConnectivity(world);
    return { ok: true, reason: `Demolished, ${refund} drachmas refunded.` };
  }

  const index = world.roads.indexOf(tile);
  if (index === -1) return { ok: false, reason: REASON.nothingToDemolish };
  world.roads.splice(index, 1);
  dropStrandedWalkers(world);
  recomputeConnectivity(world);
  return { ok: true, reason: 'Demolished. Roads are not refunded.' };
}

function removeBuilding(world: World, id: number): void {
  world.buildings = world.buildings.filter((building) => building.id !== id);
  world.walkers = world.walkers.filter((walker) => walker.homeId !== id);
  for (const walker of world.walkers) {
    if (walker.targetId !== id) continue;
    const travelled = walker.path.slice(0, walker.step + 1).reverse();
    walker.path = travelled;
    walker.step = 0;
    walker.progress = 0;
    walker.returning = true;
    walker.targetId = null;
  }
}

function dropStrandedWalkers(world: World): void {
  const roads = new Set(world.roads);
  world.walkers = world.walkers.filter((walker) => walker.path.every((tile) => roads.has(tile)));
}

export function setVendor(world: World, id: number, enabled: boolean): ActionResult {
  const building = world.buildings.find((candidate) => candidate.id === id);
  if (!building) return { ok: false, reason: REASON.noSuchBuilding };
  if (building.kind !== 'agora') return { ok: false, reason: REASON.onlyAgoraHostsVendor };

  if (!enabled) {
    building.vendorEnabled = false;
    return { ok: true, reason: 'Vendor paused.' };
  }
  if (building.vendorEnabled) return { ok: true, reason: 'Vendor already active.' };
  if (!building.vendorInstalled) {
    if (world.money < VENDOR_COST) return { ok: false, reason: REASON.notEnoughMoney };
    world.money -= VENDOR_COST;
    building.vendorInstalled = true;
    building.vendorEnabled = true;
    return { ok: true, reason: 'Food vendor added.' };
  }
  building.vendorEnabled = true;
  return { ok: true, reason: 'Vendor resumed.' };
}

export function recomputeConnectivity(world: World): void {
  const roads = new Set(world.roads);
  const map = mapOf(world);
  const entry = entryTileIndex(world);
  const reachable = roads.has(entry) ? bfsReachable(map, roads, entry) : new Set<number>();
  for (const building of world.buildings) {
    building.connected = perimeterTiles(map, building).some((tile) => reachable.has(tile));
  }
}

export function totalStock(building: Building): number {
  return Object.values(building.stores).reduce((sum, amount) => sum + amount, 0);
}

function addStore(building: Building, food: Food, amount: number): void {
  const next = (building.stores[food] ?? 0) + amount;
  if (next <= 1e-9) delete building.stores[food];
  else building.stores[food] = next;
}

function richestFood(stores: Stores): Food | null {
  let best: Food | null = null;
  for (const [food, amount] of Object.entries(stores) as [Food, number][]) {
    if (amount > 0 && (best === null || amount > (stores[best] ?? 0))) best = food;
  }
  return best;
}

function jobsOf(building: Building): number {
  return BUILDINGS[building.kind].jobs;
}

function hasActiveWalker(world: World, homeId: number, kind: WalkerKind): boolean {
  return world.walkers.some((walker) => walker.homeId === homeId && walker.kind === kind);
}

function spawnWalker(world: World, partial: Omit<Walker, 'id'>): Walker {
  const walker: Walker = { id: world.nextId++, ...partial };
  world.walkers.push(walker);
  return walker;
}

function updateStaffing(world: World): void {
  const workplaces = world.buildings.filter((building) => building.kind !== 'house');
  const population = world.buildings
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

function updateFarm(world: World, farm: Building, dt: number): void {
  if (farm.connected && farm.workers > 0) {
    const ratio = farm.workers / jobsOf(farm);
    farm.progress += (dt / FARM_GROW_SECONDS) * ratio;
    if (farm.progress >= 1) {
      farm.progress -= 1;
      addStore(farm, 'wheat', Math.min(HARVEST_UNITS, FARM_STOCK_CAP - totalStock(farm)));
      world.produced += HARVEST_UNITS;
    }
  }

  if (!farm.connected || farm.workers <= 0) return;
  if (totalStock(farm) <= 0) return;
  if (hasActiveWalker(world, farm.id, 'cart')) return;

  const exit = exitTile(world, farm);
  if (exit === -1) return;
  const granaries = world.buildings.filter((building) => building.kind === 'granary' && building.connected);
  const found = findNearestConnected(world, exit, granaries);
  if (!found) return;

  const cargo = Math.min(farm.stores.wheat ?? 0, CART_CAPACITY);
  if (cargo <= 0) return;
  addStore(farm, 'wheat', -cargo);
  spawnWalker(world, {
    kind: 'cart',
    homeId: farm.id,
    targetId: found.building.id,
    path: found.path,
    step: 0,
    progress: 0,
    food: 'wheat',
    cargo,
    returning: false,
  });
}

function updateAgora(world: World, agora: Building, dt: number): void {
  void dt;
  if (!agora.connected || agora.workers <= 0) return;

  if (!hasActiveWalker(world, agora.id, 'buyer') && totalStock(agora) < AGORA_CAP) {
    const exit = exitTile(world, agora);
    const granaries = world.buildings.filter((building) => building.kind === 'granary' && building.connected && totalStock(building) > 0);
    if (exit !== -1 && granaries.length > 0) {
      const found = findNearestConnected(world, exit, granaries);
      if (found) {
        const food = richestFood(found.building.stores);
        const cargo = food ? Math.min(found.building.stores[food] ?? 0, BUYER_FETCH_CAPACITY, AGORA_CAP - totalStock(agora)) : 0;
        if (food && cargo > 0) {
          addStore(found.building, food, -cargo);
          spawnWalker(world, {
            kind: 'buyer',
            homeId: agora.id,
            targetId: found.building.id,
            path: found.path,
            step: 0,
            progress: 0,
            food,
            cargo,
            returning: false,
          });
        }
      }
    }
  }

  if (agora.vendorEnabled && totalStock(agora) > 0 && !hasActiveWalker(world, agora.id, 'vendor')) {
    const exit = exitTile(world, agora);
    if (exit !== -1) {
      const food = richestFood(agora.stores);
      const cargo = food ? Math.min(agora.stores[food] ?? 0, VENDOR_TRIP_CAPACITY) : 0;
      const path = buildServiceCircuit(world, exit, ROAD_BUDGET);
      if (path.length > 1) {
        addStore(agora, food!, -cargo);
        spawnWalker(world, {
          kind: 'vendor',
          homeId: agora.id,
          targetId: null,
          path,
          step: 0,
          progress: 0,
          food,
          cargo,
          returning: false,
        });
      }
    }
  }
}

function updateCircuitDispatch(world: World, building: Building, kind: WalkerKind): void {
  if (!building.connected || building.workers <= 0) return;
  if (hasActiveWalker(world, building.id, kind)) return;
  const exit = exitTile(world, building);
  if (exit === -1) return;
  const path = buildServiceCircuit(world, exit, ROAD_BUDGET);
  if (path.length <= 1) return;
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
  });
}

function buildingsAdjacentToTile(world: World, tile: number): Building[] {
  const map = mapOf(world);
  return world.buildings.filter((building) => perimeterTiles(map, building).includes(tile));
}

function reverseForReturn(walker: Walker): void {
  walker.path = [...walker.path].reverse();
  walker.step = 0;
  walker.progress = 0;
  walker.returning = true;
}

function serviceTileVisit(world: World, walker: Walker): void {
  if (walker.kind !== 'vendor' && walker.kind !== 'water' && walker.kind !== 'maintenance') return;
  const index = walker.step;
  const tile = walker.path[index];
  if (walker.path.indexOf(tile) !== index) return;

  for (const building of buildingsAdjacentToTile(world, tile)) {
    if (walker.kind === 'vendor') {
      if (building.kind !== 'house' || walker.cargo <= 0) continue;
      const room = HOUSE_FOOD_CAP - building.food;
      const deliver = Math.min(walker.cargo, VENDOR_DROP_AMOUNT, room);
      if (deliver <= 0) continue;
      building.food += deliver;
      walker.cargo -= deliver;
      world.delivered += deliver;
    } else if (walker.kind === 'water') {
      if (building.kind !== 'house') continue;
      building.water = HOUSE_WATER_CAP;
    } else {
      building.condition = Math.min(100, building.condition + REPAIR_AMOUNT);
    }
  }
}

function onFinalArrival(world: World, walker: Walker): boolean {
  if (walker.kind === 'immigrant') {
    const house = world.buildings.find((building) => building.id === walker.targetId);
    if (house && house.kind === 'house') house.residents = Math.min(HOUSE_CAPACITY[house.tier], house.residents + walker.cargo);
    return true;
  }
  if (walker.kind === 'cart') {
    if (walker.returning) return true;
    const granary = world.buildings.find((building) => building.id === walker.targetId);
    if (granary && walker.food) {
      const deliver = Math.min(walker.cargo, GRANARY_CAP - totalStock(granary));
      addStore(granary, walker.food, deliver);
      walker.cargo -= deliver;
    }
    reverseForReturn(walker);
    return false;
  }
  if (walker.kind === 'buyer') {
    if (walker.returning) return true;
    const agora = world.buildings.find((building) => building.id === walker.homeId);
    if (agora && walker.food) {
      const deliver = Math.min(walker.cargo, AGORA_CAP - totalStock(agora));
      addStore(agora, walker.food, deliver);
      walker.cargo -= deliver;
    }
    reverseForReturn(walker);
    return false;
  }
  if (walker.kind === 'vendor' && walker.cargo > 0) {
    const agora = world.buildings.find((building) => building.id === walker.homeId);
    if (agora && walker.food) addStore(agora, walker.food, Math.min(walker.cargo, AGORA_CAP - totalStock(agora)));
    walker.cargo = 0;
  }
  return true;
}

function moveWalkers(world: World, dt: number): void {
  const roads = new Set(world.roads);
  const alive: Walker[] = [];
  for (const walker of world.walkers) {
    if (walker.path.length === 0 || !walker.path.every((tile) => roads.has(tile))) continue;
    if (walker.path.length === 1) {
      if (!onFinalArrival(world, walker)) alive.push(walker);
      continue;
    }

    let travel = WALKER_SPEED * dt;
    let done = false;
    while (travel > 0 && walker.step < walker.path.length - 1) {
      const toNext = 1 - walker.progress;
      if (travel < toNext) {
        walker.progress += travel;
        travel = 0;
        break;
      }
      travel -= toNext;
      walker.step += 1;
      walker.progress = 0;
      serviceTileVisit(world, walker);
      if (walker.step >= walker.path.length - 1) {
        done = onFinalArrival(world, walker);
        break;
      }
    }
    if (!done) alive.push(walker);
  }
  world.walkers = alive;
}

function arrivingResidents(world: World, houseId: number): number {
  return world.walkers
    .filter((walker) => walker.kind === 'immigrant' && walker.targetId === houseId)
    .reduce((sum, walker) => sum + walker.cargo, 0);
}

function sendImmigrants(world: World, house: Building, party: number): void {
  if (party <= 0) return;
  const roads = new Set(world.roads);
  const goals = new Set(accessTiles(world, house));
  const path = bfsShortest(mapOf(world), roads, entryTileIndex(world), (tile) => goals.has(tile));
  if (!path) return;
  spawnWalker(world, {
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

function meetsTierNeed(tier: number, food: number, water: number): boolean {
  const needsFood = tier >= 2;
  const needsWater = tier >= 3;
  return (!needsFood || food > 0) && (!needsWater || water > 0);
}

function tickHouse(world: World, house: Building, dt: number): void {
  void world;
  if (house.residents > 0) {
    house.food = Math.max(0, house.food - FOOD_CONSUMPTION_PER_RESIDENT * house.residents * dt);
  }
  house.water = Math.max(0, house.water - WATER_DECAY_PER_SECOND * dt);
  house.condition = Math.max(0, house.condition - CONDITION_DECAY_PER_SECOND * dt);

  const satisfied = meetsTierNeed(house.tier, house.food, house.water);

  if (!satisfied) {
    house.serviceTimer += dt;
    house.upgradeTimer = 0;
    if (house.serviceTimer >= GRACE_SECONDS) {
      house.serviceTimer = 0;
      if (house.tier > 1) {
        house.tier = (house.tier - 1) as 1 | 2 | 3;
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
  const expected = arrivingResidents(world, house.id);
  if (house.residents + expected < capacity) {
    house.upgradeTimer += dt;
    if (house.upgradeTimer >= ARRIVAL_INTERVAL) {
      house.upgradeTimer = 0;
      sendImmigrants(world, house, Math.min(IMMIGRANT_PARTY, capacity - house.residents - expected));
    }
    return;
  }
  if (house.residents < capacity) return;

  if (house.tier >= 3) {
    house.upgradeTimer = 0;
    return;
  }

  const nextTier = house.tier + 1;
  if (!meetsTierNeed(nextTier, house.food, house.water)) {
    house.upgradeTimer = 0;
    return;
  }

  house.upgradeTimer += dt;
  if (house.upgradeTimer >= UPGRADE_GRACE) {
    house.upgradeTimer = 0;
    house.tier = nextTier as 1 | 2 | 3;
  }
}

function updateFinances(world: World, dt: number): void {
  const summary = getSummary(world);
  world.money += summary.balance * (dt / MONTH_SECONDS);
}

function simulationStep(world: World, dt: number): void {
  world.time += dt;
  updateStaffing(world);
  for (const building of world.buildings) {
    if (building.kind === 'farm') updateFarm(world, building, dt);
    else if (building.kind === 'agora') updateAgora(world, building, dt);
    else if (building.kind === 'fountain') updateCircuitDispatch(world, building, 'water');
    else if (building.kind === 'maintenance') updateCircuitDispatch(world, building, 'maintenance');
  }
  moveWalkers(world, dt);
  for (const building of world.buildings) {
    if (building.kind === 'house') tickHouse(world, building, dt);
  }
  updateFinances(world, dt);
}

export function advance(world: World, seconds: number): void {
  world.remainder += seconds;
  while (world.remainder >= STEP) {
    world.remainder -= STEP;
    simulationStep(world, STEP);
  }
}

export function getSummary(world: World): Summary {
  const houses = world.buildings.filter((building) => building.kind === 'house');
  const workplaces = world.buildings.filter((building) => building.kind !== 'house');
  const population = houses.reduce((sum, house) => sum + house.residents, 0);
  const workers = workplaces.reduce((sum, building) => sum + building.workers, 0);
  const jobs = workplaces.reduce((sum, building) => sum + jobsOf(building), 0);
  const food = world.buildings
    .filter((building) => building.kind === 'granary' || building.kind === 'agora')
    .reduce((sum, building) => sum + totalStock(building), 0);
  const income = houses.reduce((sum, house) => sum + house.residents * INCOME_PER_RESIDENT, 0);
  const upkeep = workplaces.reduce((sum, building) => sum + BUILDINGS[building.kind].upkeep, 0);
  const balance = income - upkeep;
  const prosperous = houses.filter((house) => house.tier === 3 && house.residents > 0).length;
  const goal = prosperous >= 4 && balance >= 0 && world.produced > 0 && world.delivered > 0;
  return { population, workers, jobs, food, income, upkeep, balance, prosperous, goal };
}

function houseStatus(world: World, building: Building): string[] {
  const lines: string[] = [];
  const capacity = HOUSE_CAPACITY[building.tier];
  const needsFoodNow = building.tier >= 2;
  const needsWaterNow = building.tier >= 3;
  const satisfiedNow = (!needsFoodNow || building.food > 0) && (!needsWaterNow || building.water > 0);

  if (building.residents === 0) {
    lines.push('Waiting for settlers from the harbour.');
  } else if (!satisfiedNow) {
    lines.push(needsWaterNow && building.water <= 0 ? 'Out of water; a fountain visit is needed.' : 'Out of food; a vendor visit is needed.');
  } else if (building.residents < capacity) {
    lines.push('Waiting for settlers from the harbour.');
  } else if (building.tier < 3) {
    const nextTier = building.tier + 1;
    if (nextTier >= 2 && building.food <= 0) lines.push('Needs food to grow: add an agora vendor nearby.');
    else if (nextTier >= 3 && building.water <= 0) lines.push('Needs water to become a courtyard house.');
    else lines.push('Ready to grow.');
  } else {
    lines.push('A thriving courtyard house.');
  }

  if (building.condition < 50) lines.push(neglectAdvice(world));
  return lines;
}

function neglectAdvice(world: World): string {
  const caretakers = world.buildings.some((candidate) => candidate.kind === 'maintenance' && candidate.connected);
  return caretakers ? 'Neglected; a caretaker will repair it.' : 'Neglected; build a maintenance post.';
}

export function buildingStatus(world: World, building: Building): string[] {
  if (!building.connected) return ['Not linked to a road; nobody can reach it.'];
  if (building.kind === 'house') return houseStatus(world, building);

  const definition = BUILDINGS[building.kind];
  const lines: string[] = [];

  if (building.workers < definition.jobs * .999) {
    lines.push(building.workers > 0 ? 'Short of workers; more settlers are needed.' : 'Unstaffed; settlers are needed for work.');
  } else if (building.kind === 'farm') {
    if (totalStock(building) > 0 && !hasActiveWalker(world, building.id, 'cart')) {
      lines.push('Harvest ready, but no granary to send it to.');
    } else {
      lines.push(`Growing wheat, ${Math.round(building.progress * 100)}% to harvest.`);
    }
  } else if (building.kind === 'granary') {
    lines.push(totalStock(building) > 0 ? 'Stocked and ready for buyers.' : 'Empty; waiting for a farm cart.');
  } else if (building.kind === 'agora') {
    if (!building.vendorInstalled) lines.push('Add a food vendor to start deliveries.');
    else if (hasActiveWalker(world, building.id, 'vendor')) lines.push('Vendor on the streets.');
    else lines.push('Vendor resting at market.');
  } else if (building.kind === 'fountain') {
    lines.push(hasActiveWalker(world, building.id, 'water') ? 'Water carrier making the rounds.' : 'Water carrier resting at the fountain.');
  } else if (building.kind === 'maintenance') {
    lines.push(hasActiveWalker(world, building.id, 'maintenance') ? 'Caretaker doing rounds.' : 'Caretaker resting at the post.');
  }

  if (building.condition < 50) lines.push(neglectAdvice(world));
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
};

export function walkerName(walker: Walker): string {
  if (walker.kind === 'immigrant') return `${NAMES[walker.id % NAMES.length]} and family`;
  return NAMES[walker.id % NAMES.length];
}

export function walkerStatus(world: World, walker: Walker): string[] {
  const home = world.buildings.find((building) => building.id === walker.homeId);
  const target = world.buildings.find((building) => building.id === walker.targetId);
  const named = (building: Building | undefined) => building ? (building.kind === 'house' ? 'a house' : `the ${BUILDINGS[building.kind].name.toLowerCase()}`) : 'home';
  const load = walker.food ? `${Math.round(walker.cargo)} ${walker.food}` : '';
  switch (walker.kind) {
    case 'immigrant':
      return [`${walker.cargo} settlers walking from the harbour to their new home.`];
    case 'cart':
      if (walker.returning) return ['Cart empty, heading back to the farm.'];
      return [`Carting ${load} to ${named(target)}.`];
    case 'buyer':
      if (walker.returning) return [`Bringing ${load} back to ${named(home)}.`];
      return [`Off to ${named(target)} to fetch food.`];
    case 'vendor':
      if (walker.cargo > 0) return [`Selling ${load} door to door.`];
      return ['Sold out; returning to the agora.'];
    case 'water':
      return ['Filling jars at every house along the way.'];
    case 'maintenance':
      return ['Checking and repairing buildings along the way.'];
  }
}
