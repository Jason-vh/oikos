import type { ActionResult, Building, BuildTool, Placement, Rotation, Summary, Tile, Walker, WalkerKind, World } from './types';
import { BUILDINGS, HOUSE_CAPACITY, HOUSE_NAMES, MONTH_SECONDS, ROAD_COST, STARTING_MONEY, VENDOR_COST, footprint } from './catalog';
import { ENTRY, insideMap, terrainAt, tileAt, tileIndex } from './island';
import {
  bfsReachable,
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

export function createWorld(): World {
  const world: World = {
    version: 1,
    island: 'thalassa',
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
  const roads = new Set<number>();
  for (let z = 14; z <= ENTRY.z; z++) roads.add(tileIndex(ENTRY.x, z));
  for (let x = 10; x <= 30; x++) roads.add(tileIndex(x, 20));
  world.roads = [...roads];
  recomputeConnectivity(world);
  return world;
}

const REASON = {
  outOfBounds: 'Out of bounds.',
  unsuitableTerrain: 'Unsuitable terrain.',
  needsFertileGround: 'Farms need fertile ground.',
  tileOccupied: 'That tile is occupied.',
  tileOccupiedByRoad: 'That tile is occupied by a road.',
  notEnoughMoney: 'Not enough drachmas.',
  nothingToDemolish: 'Nothing to demolish there.',
  noSuchBuilding: 'No such building.',
  onlyAgoraHostsVendor: 'Only an agora can host a vendor.',
} as const;

function buildingAt(world: World, tile: number): Building | undefined {
  return world.buildings.find((building) => footprintTiles(building).includes(tile));
}

function terrainAllows(kind: BuildTool, x: number, z: number): boolean {
  const terrain = terrainAt(x, z);
  if (kind === 'farm') return terrain === 'fertile';
  return terrain === 'grass' || terrain === 'fertile';
}

function evaluatePlacement(world: World, tool: BuildTool, x: number, z: number, rotation: Rotation): Placement {
  if (tool === 'road') {
    if (!insideMap(x, z)) return { ok: false, reason: REASON.outOfBounds, cost: 0, tiles: [] };
    const tile = tileIndex(x, z);
    if (!terrainAllows(tool, x, z)) return { ok: false, reason: REASON.unsuitableTerrain, cost: 0, tiles: [tile] };
    if (buildingAt(world, tile)) return { ok: false, reason: REASON.tileOccupied, cost: 0, tiles: [tile] };
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
      if (!insideMap(tx, tz)) return { ok: false, reason: REASON.outOfBounds, cost: definition.cost, tiles: [] };
      tiles.push(tileIndex(tx, tz));
    }
  }
  for (const tile of tiles) {
    const { x: tx, z: tz } = tileAt(tile);
    if (!terrainAllows(tool, tx, tz)) {
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
      stock: 0,
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
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const { x, z } of tiles) {
    if (!insideMap(x, z)) return { ok: false, reason: REASON.outOfBounds };
    const tile = tileIndex(x, z);
    if (seen.has(tile)) continue;
    seen.add(tile);
    if (!terrainAllows('road', x, z)) return { ok: false, reason: REASON.unsuitableTerrain };
    if (buildingAt(world, tile)) return { ok: false, reason: REASON.tileOccupied };
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
  if (!insideMap(x, z)) return { ok: false, reason: REASON.outOfBounds };
  const tile = tileIndex(x, z);

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
  const entry = entryTileIndex();
  const reachable = roads.has(entry) ? bfsReachable(roads, entry) : new Set<number>();
  for (const building of world.buildings) {
    building.connected = perimeterTiles(building).some((tile) => reachable.has(tile));
  }
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
      farm.stock = Math.min(FARM_STOCK_CAP, farm.stock + HARVEST_UNITS);
      world.produced += HARVEST_UNITS;
    }
  }

  if (!farm.connected || farm.workers <= 0) return;
  if (farm.stock <= 0) return;
  if (hasActiveWalker(world, farm.id, 'cart')) return;

  const exit = exitTile(world, farm);
  if (exit === -1) return;
  const granaries = world.buildings.filter((building) => building.kind === 'granary' && building.connected);
  const found = findNearestConnected(world, exit, granaries);
  if (!found) return;

  const cargo = Math.min(farm.stock, CART_CAPACITY);
  if (cargo <= 0) return;
  farm.stock -= cargo;
  spawnWalker(world, {
    kind: 'cart',
    homeId: farm.id,
    targetId: found.building.id,
    path: found.path,
    step: 0,
    progress: 0,
    cargo,
    returning: false,
  });
}

function updateAgora(world: World, agora: Building, dt: number): void {
  void dt;
  if (!agora.connected || agora.workers <= 0) return;

  if (!hasActiveWalker(world, agora.id, 'buyer') && agora.stock < AGORA_CAP) {
    const exit = exitTile(world, agora);
    const granaries = world.buildings.filter((building) => building.kind === 'granary' && building.connected && building.stock > 0);
    if (exit !== -1 && granaries.length > 0) {
      const found = findNearestConnected(world, exit, granaries);
      if (found) {
        const cargo = Math.min(found.building.stock, BUYER_FETCH_CAPACITY, AGORA_CAP - agora.stock);
        if (cargo > 0) {
          found.building.stock -= cargo;
          spawnWalker(world, {
            kind: 'buyer',
            homeId: agora.id,
            targetId: found.building.id,
            path: found.path,
            step: 0,
            progress: 0,
            cargo,
            returning: false,
          });
        }
      }
    }
  }

  if (agora.vendorEnabled && agora.stock > 0 && !hasActiveWalker(world, agora.id, 'vendor')) {
    const exit = exitTile(world, agora);
    if (exit !== -1) {
      const cargo = Math.min(agora.stock, VENDOR_TRIP_CAPACITY);
      const path = buildServiceCircuit(world, exit, ROAD_BUDGET);
      if (path.length > 1) {
        agora.stock -= cargo;
        spawnWalker(world, {
          kind: 'vendor',
          homeId: agora.id,
          targetId: null,
          path,
          step: 0,
          progress: 0,
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
    cargo: 0,
    returning: false,
  });
}

function buildingsAdjacentToTile(world: World, tile: number): Building[] {
  return world.buildings.filter((building) => perimeterTiles(building).includes(tile));
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
  if (walker.kind === 'cart') {
    if (walker.returning) return true;
    const granary = world.buildings.find((building) => building.id === walker.targetId);
    if (granary) {
      const deliver = Math.min(walker.cargo, GRANARY_CAP - granary.stock);
      granary.stock += deliver;
      walker.cargo -= deliver;
    }
    reverseForReturn(walker);
    return false;
  }
  if (walker.kind === 'buyer') {
    if (walker.returning) return true;
    const agora = world.buildings.find((building) => building.id === walker.homeId);
    if (agora) {
      const deliver = Math.min(walker.cargo, AGORA_CAP - agora.stock);
      agora.stock += deliver;
      walker.cargo -= deliver;
    }
    reverseForReturn(walker);
    return false;
  }
  if (walker.kind === 'vendor' && walker.cargo > 0) {
    const agora = world.buildings.find((building) => building.id === walker.homeId);
    if (agora) agora.stock = Math.min(AGORA_CAP, agora.stock + walker.cargo);
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
  if (house.residents < capacity) {
    house.upgradeTimer += dt;
    while (house.upgradeTimer >= ARRIVAL_INTERVAL && house.residents < capacity) {
      house.upgradeTimer -= ARRIVAL_INTERVAL;
      house.residents += 1;
    }
    return;
  }

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
    .reduce((sum, building) => sum + building.stock, 0);
  const income = houses.reduce((sum, house) => sum + house.residents * INCOME_PER_RESIDENT, 0);
  const upkeep = workplaces.reduce((sum, building) => sum + BUILDINGS[building.kind].upkeep, 0);
  const balance = income - upkeep;
  const prosperous = houses.filter((house) => house.tier === 3 && house.residents > 0).length;
  const goal = prosperous >= 4 && balance >= 0 && world.produced > 0 && world.delivered > 0;
  return { population, workers, jobs, food, income, upkeep, balance, prosperous, goal };
}

export function buildingStatus(world: World, building: Building): string[] {
  void world;
  const lines: string[] = [];
  lines.push(building.connected ? 'Connected to the road network.' : 'Not connected to any road.');

  if (building.kind === 'house') {
    const name = building.residents > 0 ? HOUSE_NAMES[building.tier] : HOUSE_NAMES[0];
    lines.push(`${name}: ${building.residents}/${HOUSE_CAPACITY[building.tier]} settlers.`);
    if (building.tier >= 2) lines.push(building.food > 0 ? `Food stored: ${building.food.toFixed(1)}.` : 'Out of food.');
    if (building.tier >= 3) lines.push(building.water > 0 ? `Water stored: ${building.water.toFixed(1)}.` : 'Out of water.');
    lines.push(`Condition: ${building.condition.toFixed(0)}%.`);
    return lines;
  }

  const definition = BUILDINGS[building.kind];
  lines.push(`Workers: ${building.workers.toFixed(1)}/${definition.jobs}.`);
  if (building.kind === 'farm') lines.push(`Stock: ${building.stock.toFixed(0)}, growth ${(building.progress * 100).toFixed(0)}%.`);
  if (building.kind === 'granary') lines.push(`Stock: ${building.stock.toFixed(0)}.`);
  if (building.kind === 'agora') {
    lines.push(`Stock: ${building.stock.toFixed(0)}.`);
    lines.push(building.vendorEnabled ? 'Food vendor active.' : building.vendorInstalled ? 'Food vendor paused.' : 'No food vendor installed.');
  }
  lines.push(`Condition: ${building.condition.toFixed(0)}%.`);
  return lines;
}

