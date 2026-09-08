import { recomputeAppeal } from './appeal';
import { BUILDINGS, ROADBLOCK_COST, ROAD_COST, UNITS_PER_CARTLOAD } from './buildings';
import { Grid, NO_BUILDING, TERRAIN_MEADOW } from './grid';
import { updateHouses } from './housing';
import {
  DEFAULT_WAGE_LEVEL,
  allocateLabour,
  monthlyWages,
  staffing,
  workforceOf,
  type LabourReport,
} from './labour';
import { generateMap } from './mapgen';
import { hasRoadAccess, roadAccessTiles } from './pathing';
import { DEFAULT_TAX_RATE, collectTax, type TaxReport } from './taxation';
import { TICKS_PER_MONTH } from './time';
import { createBuilding } from './types';
import type { Building, BuildingKind, Walker } from './types';
import { PEDDLER_LOAD, spawnCartPusher, spawnDeliveryman, spawnRoamer } from './walkers';
import { updateWalkers } from './walkers';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FARM_TICKS_PER_LOAD = 150;
const FARM_CAPACITY = 4;
const GRANARY_CAPACITY = 24;
const AGORA_CAPACITY = 4 * UNITS_PER_CARTLOAD;
const AGORA_SPAWN_INTERVAL = 90;
const FOUNTAIN_SPAWN_INTERVAL = 70;
const TAX_OFFICE_SPAWN_INTERVAL = 70;

function atWalkerLimit(building: Building): boolean {
  return building.walkersOut >= BUILDINGS[building.kind].maxWalkers;
}

export interface PlacementCheck {
  ok: boolean;
  reason: string;
}

export class World {
  readonly seed: number;
  readonly grid: Grid;
  readonly buildings = new Map<number, Building>();
  readonly walkers = new Map<number, Walker>();
  readonly granaryCapacity = GRANARY_CAPACITY;
  readonly agoraCapacity = AGORA_CAPACITY;

  treasury = 2000;
  wageLevel = DEFAULT_WAGE_LEVEL;
  taxRate = DEFAULT_TAX_RATE;
  labour: LabourReport = { workforce: 0, employed: 0, required: 0 };
  taxes: TaxReport = { collected: 0, taxedPeople: 0, untaxedPeople: 0 };
  tick = 0;
  month = 0;
  year = -500;
  structureVersion = 0;
  messages: string[] = [];

  private nextId = 1;
  private appealDirty = false;
  private readonly changedTiles = new Set<number>();

  constructor(size: number, seed: number) {
    this.seed = seed;
    this.grid = new Grid(size);
    generateMap(this.grid, seed);
    this.log('Found your city, Archon. Lay roads, then housing.');
  }

  get population(): number {
    let total = 0;
    for (const building of this.buildings.values()) total += building.population;
    return total;
  }

  get dateLabel(): string {
    const era = this.year < 0 ? 'BC' : 'AD';
    return `${MONTH_NAMES[this.month]} ${Math.abs(this.year)} ${era}`;
  }

  buildingAt(tile: number): Building | undefined {
    const id = this.grid.occupant[tile];
    if (id === NO_BUILDING) return undefined;
    return this.buildings.get(id);
  }

  log(message: string): void {
    this.messages.unshift(message);
    this.messages.length = Math.min(this.messages.length, 5);
  }

  canPlace(kind: BuildingKind, x: number, y: number): PlacementCheck {
    const def = BUILDINGS[kind];
    if (this.treasury < def.cost) return { ok: false, reason: 'Not enough drachmas' };

    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        if (!this.grid.contains(x + dx, y + dy)) return { ok: false, reason: 'Outside the map' };
        if (!this.grid.isFree(x + dx, y + dy)) return { ok: false, reason: 'Blocked' };
        if (def.requiresMeadow && this.grid.terrain[this.grid.index(x + dx, y + dy)] !== TERRAIN_MEADOW) {
          return { ok: false, reason: 'Must be built on meadow' };
        }
      }
    }
    if (!this.grid.isFlat(x, y, def.size)) return { ok: false, reason: 'Ground must be level' };
    return { ok: true, reason: def.description };
  }

  place(kind: BuildingKind, x: number, y: number): boolean {
    if (!this.canPlace(kind, x, y).ok) return false;

    const def = BUILDINGS[kind];
    const building = createBuilding(this.nextId++, kind, x, y, def.size);

    this.buildings.set(building.id, building);
    for (const tile of this.grid.footprint(x, y, def.size)) this.grid.occupant[tile] = building.id;

    this.treasury -= def.cost;
    this.markChanged(this.grid.footprint(x, y, def.size));
    return true;
  }

  restore(building: Building): void {
    this.buildings.set(building.id, building);
    for (const tile of this.grid.footprint(building.x, building.y, building.size)) {
      this.grid.occupant[tile] = building.id;
    }
    this.nextId = Math.max(this.nextId, building.id + 1);
  }

  settle(): void {
    recomputeAppeal(this.grid, this.buildings.values());
    this.hireWorkers();
    this.structureVersion += 1;
  }

  hireWorkers(): void {
    this.labour = allocateLabour(this.buildings.values(), workforceOf(this.population, this.wageLevel));
  }

  invalidateAppeal(): void {
    this.appealDirty = true;
  }

  canPlaceRoad(x: number, y: number): boolean {
    return this.grid.isFree(x, y) && this.treasury >= ROAD_COST;
  }

  placeRoad(x: number, y: number): boolean {
    if (!this.canPlaceRoad(x, y)) return false;
    const tile = this.grid.index(x, y);
    this.grid.road[tile] = 1;
    this.treasury -= ROAD_COST;
    this.markChanged([tile]);
    return true;
  }

  canPlaceRoadblock(x: number, y: number): boolean {
    if (!this.grid.contains(x, y)) return false;
    const tile = this.grid.index(x, y);
    return this.grid.isRoad(tile) && !this.grid.isRoadblock(tile) && this.treasury >= ROADBLOCK_COST;
  }

  placeRoadblock(x: number, y: number): boolean {
    if (!this.canPlaceRoadblock(x, y)) return false;
    const tile = this.grid.index(x, y);
    this.grid.roadblock[tile] = 1;
    this.treasury -= ROADBLOCK_COST;
    this.markChanged([tile]);
    return true;
  }

  demolish(x: number, y: number): boolean {
    if (!this.grid.contains(x, y)) return false;
    const tile = this.grid.index(x, y);

    if (this.grid.roadblock[tile] === 1) {
      this.grid.roadblock[tile] = 0;
      this.markChanged([tile]);
      return true;
    }

    if (this.grid.road[tile] === 1) {
      this.grid.road[tile] = 0;
      this.markChanged([tile]);
      return true;
    }

    const building = this.buildingAt(tile);
    if (!building) return false;

    for (const footprintTile of this.grid.footprint(building.x, building.y, building.size)) {
      this.grid.occupant[footprintTile] = NO_BUILDING;
    }
    this.buildings.delete(building.id);
    for (const walker of this.walkers.values()) {
      if (walker.homeId === building.id) this.walkers.delete(walker.id);
    }
    this.markChanged(this.grid.footprint(building.x, building.y, building.size));
    return true;
  }

  addWalker(walker: Omit<Walker, 'id'>): Walker {
    const created: Walker = { ...walker, id: this.nextId++ };
    this.walkers.set(created.id, created);
    const home = this.buildings.get(created.homeId);
    if (home) home.walkersOut += 1;
    return created;
  }

  removeWalker(walker: Walker): void {
    this.walkers.delete(walker.id);
    const home = this.buildings.get(walker.homeId);
    if (home) home.walkersOut -= 1;
  }

  update(): void {
    this.tick += 1;
    this.updateProduction();
    updateWalkers(this);
    updateHouses(this);
    if (this.appealDirty) {
      this.appealDirty = false;
      this.settle();
    }

    if (this.tick % TICKS_PER_MONTH === 0) this.advanceMonth();
  }

  private advanceMonth(): void {
    this.month += 1;
    if (this.month >= 12) {
      this.month = 0;
      this.year += 1;
    }
    this.hireWorkers();
    this.taxes = collectTax(this.buildings.values(), this.taxRate);
    this.treasury += this.taxes.collected;
    this.treasury -= monthlyWages(this.labour.employed, this.wageLevel);

    if (this.treasury < 0) this.log('The treasury is in debt, Archon.');
    else if (this.labour.employed < this.labour.required) this.log('Buildings stand short of workers.');
  }

  private updateProduction(): void {
    for (const building of this.buildings.values()) {
      switch (building.kind) {
        case 'wheatFarm':
          this.updateFarm(building);
          break;
        case 'agora':
          this.updateAgora(building);
          break;
        case 'fountain':
          this.updateFountain(building);
          break;
        case 'taxOffice':
          this.updateTaxOffice(building);
          break;
        default:
          break;
      }
    }
  }

  private updateFarm(farm: Building): void {
    if (farm.stock < FARM_CAPACITY) {
      farm.productionProgress += staffing(farm);
      if (farm.productionProgress >= FARM_TICKS_PER_LOAD) {
        farm.productionProgress = 0;
        farm.stock += 1;
      }
    }

    if (farm.stock === 0 || atWalkerLimit(farm)) return;

    const destinations = this.granaryAccessTiles();
    if (destinations.size === 0) return;
    if (spawnCartPusher(this, farm, destinations, farm.stock)) farm.stock = 0;
  }

  private granaryAccessTiles(): Set<number> {
    const tiles = new Set<number>();
    for (const building of this.buildings.values()) {
      if (building.kind !== 'granary' || building.stock >= GRANARY_CAPACITY) continue;
      for (const tile of roadAccessTiles(this.grid, building)) tiles.add(tile);
    }
    return tiles;
  }

  private updateAgora(agora: Building): void {
    agora.spawnTimer += staffing(agora);
    if (atWalkerLimit(agora) || !hasRoadAccess(this.grid, agora)) return;

    if (agora.stock <= AGORA_CAPACITY - UNITS_PER_CARTLOAD) {
      const sources = this.stockedGranaryTiles();
      if (sources.size > 0 && spawnDeliveryman(this, agora, sources)) return;
    }

    if (agora.stock < PEDDLER_LOAD || agora.spawnTimer < AGORA_SPAWN_INTERVAL) return;
    if (spawnRoamer(this, agora, 'peddler', PEDDLER_LOAD)) {
      agora.spawnTimer = 0;
      agora.stock -= PEDDLER_LOAD;
    }
  }

  private stockedGranaryTiles(): Set<number> {
    const tiles = new Set<number>();
    for (const building of this.buildings.values()) {
      if (building.kind !== 'granary' || building.stock <= 0) continue;
      for (const tile of roadAccessTiles(this.grid, building)) tiles.add(tile);
    }
    return tiles;
  }

  private updateFountain(fountain: Building): void {
    fountain.spawnTimer += staffing(fountain);
    if (fountain.spawnTimer < FOUNTAIN_SPAWN_INTERVAL) return;
    if (atWalkerLimit(fountain) || !hasRoadAccess(this.grid, fountain)) return;

    if (spawnRoamer(this, fountain, 'waterCarrier')) fountain.spawnTimer = 0;
  }

  private updateTaxOffice(office: Building): void {
    office.spawnTimer += staffing(office);
    if (office.spawnTimer < TAX_OFFICE_SPAWN_INTERVAL) return;
    if (atWalkerLimit(office) || !hasRoadAccess(this.grid, office)) return;

    if (spawnRoamer(this, office, 'clerk')) office.spawnTimer = 0;
  }

  consumeChangedTiles(): number[] {
    const tiles = [...this.changedTiles];
    this.changedTiles.clear();
    return tiles;
  }

  private markChanged(tiles: Iterable<number>): void {
    for (const tile of tiles) {
      this.changedTiles.add(tile);
      for (const neighbour of this.grid.neighbours(tile)) this.changedTiles.add(neighbour);
    }
    this.settle();
  }
}
