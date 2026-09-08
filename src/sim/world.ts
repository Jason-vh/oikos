import { recomputeAppeal } from './appeal';
import { BUILDINGS, HOUSE_TIERS, ROADBLOCK_COST, ROAD_COST, UNITS_PER_CARTLOAD, isDwelling, tierOf } from './buildings';
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
import { RISK_LIMIT, accrueRisk, nameOf } from './hazards';
import { accrueAfflictions, plagueToll, tendHouse, theftLoss } from './unrest';
import {
  GODS,
  GOD_KINDS,
  SANCTUARY_KINDS,
  actFor,
  moodAfterMonth,
  newPantheon,
  type GodKind,
  type GodState,
} from './gods';
import { judgeCity, migrantsFor, type Sentiment } from './popularity';
import {
  CAMPAIGN,
  DEFAULT_SCENARIO,
  allGoalsMet,
  measureGoals,
  type CitySnapshot,
  type GoalProgress,
  type Scenario,
} from './scenario';
import { DEFAULT_TAX_RATE, collectTax, type TaxReport } from './taxation';
import { NO_TRADE, TRADE_ROUTES, newTradeOrders, trade, type TradeReport } from './trade';
import { NO_ARMY, companiesIn, fightInvasion, musterArmy, type Army, type Battle } from './military';
import { TICKS_PER_MONTH } from './time';
import { createBuilding } from './types';
import type { Building, BuildingKind, Good, Walker, WalkerKind } from './types';
import { PEDDLER_LOAD, spawnCartPusher, spawnDeliveryman, spawnPhilosopher, spawnRoamer } from './walkers';
import { updateWalkers } from './walkers';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const TICKS_PER_LOAD = 150;
const AGORA_SPAWN_INTERVAL = 90;
const AGORA_GOODS: Good[] = ['food', 'oil'];
const COLLEGE_SPAWN_INTERVAL = 90;
const MAINTENANCE_SPAWN_INTERVAL = 70;
const STAGGERED_RISK = 40;
const INVASION_MONTH = 6;
const MONTHS_OF_DEBT_ALLOWED = 24;
const PLUNDER_PER_COMPANY = 250;
const HADES_GIFT = 600;
const HADES_TRIBUTE = 400;
const MONTHS_PER_YEAR = 12;

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const FOUNTAIN_SPAWN_INTERVAL = 70;
const TAX_OFFICE_SPAWN_INTERVAL = 70;
const INFIRMARY_SPAWN_INTERVAL = 80;
const WATCHPOST_SPAWN_INTERVAL = 70;

function roomIn(house: Building): number {
  return Math.max(0, tierOf(house).capacity - house.population);
}

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


  treasury = 2000;
  wageLevel = DEFAULT_WAGE_LEVEL;
  taxRate = DEFAULT_TAX_RATE;
  labour: LabourReport = { workforce: 0, employed: 0, required: 0 };
  taxes: TaxReport = { collected: 0, taxedPeople: 0, untaxedPeople: 0 };
  sentiment: Sentiment = { popularity: 50, complaint: null };
  migrants = 0;
  tradeOrders: Record<string, boolean> = newTradeOrders();
  trade: TradeReport = NO_TRADE;
  army: Army = { ...NO_ARMY };
  lastBattle: Battle | null = null;
  scenario: Scenario = DEFAULT_SCENARIO;
  episode = 0;
  goals: GoalProgress[] = [];
  scenarioWon = false;
  scenarioLost = false;
  monthsInDebt = 0;
  tick = 0;
  month = 0;
  year = -500;
  structureVersion = 0;
  messages: string[] = [];
  gods: Record<GodKind, GodState> = newPantheon();

  private nextId = 1;
  private appealDirty = false;
  private readonly outputByMonth: Record<Good, number[]> = {
    food: new Array(MONTHS_PER_YEAR).fill(0),
    olives: new Array(MONTHS_PER_YEAR).fill(0),
    oil: new Array(MONTHS_PER_YEAR).fill(0),
  };
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
    if (def.requires && !this.has(def.requires)) {
      return { ok: false, reason: `Not until a ${BUILDINGS[def.requires].name.toLowerCase()} stands` };
    }

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
    if (this.grid.appeal[this.grid.index(x, y)] < def.minAppeal) {
      return { ok: false, reason: `Needs appeal of ${def.minAppeal} here` };
    }
    return { ok: true, reason: def.description };
  }

  has(kind: BuildingKind): boolean {
    for (const building of this.buildings.values()) if (building.kind === kind) return true;
    return false;
  }

  place(kind: BuildingKind, x: number, y: number): boolean {
    if (!this.canPlace(kind, x, y).ok) return false;

    const def = BUILDINGS[kind];
    const building = createBuilding(this.nextId++, kind, x, y, def.size);
    building.fireRisk = Math.random() * STAGGERED_RISK;
    building.damageRisk = Math.random() * STAGGERED_RISK;

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

  rehouseWalker(walker: Walker, homeId: number): void {
    const previous = this.buildings.get(walker.homeId);
    if (previous) previous.walkersOut -= 1;

    walker.homeId = homeId;
    const home = this.buildings.get(homeId);
    if (home) home.walkersOut += 1;
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
    this.runTrade();

    this.sentiment = judgeCity({
      wageLevel: this.wageLevel,
      taxRate: this.taxRate,
      fedShare: this.fedShare(),
      unemployment: this.unemployment(),
      inDebt: this.treasury < 0,
    });
    this.migrate();
    this.army = musterArmy(this.buildings.values(), this.has('palace'));
    this.defendCity();
    this.sufferAfflictions();
    this.attendGods();
    this.sufferMishaps();
    this.reviewGoals();
    for (const counts of Object.values(this.outputByMonth)) counts[this.month] = 0;

    if (this.labour.employed < this.labour.required) this.log('Buildings stand short of workers.');
    else if (this.sentiment.complaint) this.log(this.sentiment.complaint);
  }

  private fedShare(): number {
    let fed = 0;
    let hungry = 0;
    for (const building of this.buildings.values()) {
      if (!isDwelling(building.kind) || !tierOf(building).needs.includes('food')) continue;
      hungry += building.population;
      if (building.supply.food > 0) fed += building.population;
    }
    return hungry === 0 ? 1 : fed / hungry;
  }

  private unemployment(): number {
    const { workforce, employed } = this.labour;
    if (workforce === 0) return 0;
    return (workforce - employed) / workforce;
  }

  citySnapshot(): CitySnapshot {
    const peopleByTier = HOUSE_TIERS.map(() => 0);
    for (const building of this.buildings.values()) {
      if (building.kind === 'house') peopleByTier[building.tier] += building.population;
    }

    return {
      sanctuaries: [...this.buildings.values()].filter((building) => SANCTUARY_KINDS.includes(building.kind)).length,
      companies: companiesIn(this.army),
      tradePartners: TRADE_ROUTES.filter((route) => this.tradeOrders[route.id]).length,
      population: this.population,
      treasury: this.treasury,
      peopleByTier,
      yearlyOutput: {
        food: sum(this.outputByMonth.food),
        olives: sum(this.outputByMonth.olives),
        oil: sum(this.outputByMonth.oil),
      },
    };
  }

  private reviewGoals(): void {
    this.goals = measureGoals(this.scenario, this.citySnapshot());
    this.monthsInDebt = this.treasury < 0 ? this.monthsInDebt + 1 : 0;

    if (!this.scenarioLost && this.monthsInDebt >= MONTHS_OF_DEBT_ALLOWED) {
      this.scenarioLost = true;
      this.log('The city has been in debt for two years. Your rule is over, Archon.');
      return;
    }

    if (this.scenarioWon || !allGoalsMet(this.goals)) return;

    this.scenarioWon = true;
    this.log(`Every goal of ${this.scenario.name} is met, Archon.`);
  }

  beginEpisode(episode: number): void {
    this.episode = Math.min(episode, CAMPAIGN.length - 1);
    this.scenario = CAMPAIGN[this.episode];
    this.scenarioWon = false;
    this.scenarioLost = false;
    this.monthsInDebt = 0;
    this.goals = measureGoals(this.scenario, this.citySnapshot());
  }

  get hasNextEpisode(): boolean {
    return this.episode + 1 < CAMPAIGN.length;
  }

  private runTrade(): void {
    const posts = [...this.buildings.values()].filter(
      (building) => building.kind === 'tradingPost' && building.staff > 0,
    );

    this.trade = posts.length === 0 ? NO_TRADE : trade(posts, this.tradeOrders, this.treasury);
    this.treasury += this.trade.earned - this.trade.spent;
  }

  private defendCity(): void {
    const invasion = this.scenario.invasions.find(
      (candidate) => candidate.year === this.year && this.month === INVASION_MONTH,
    );
    if (!invasion) return;

    const battle = fightInvasion(this.army, invasion);
    this.lastBattle = battle;

    if (battle.won) {
      this.log(`The ${invasion.nation} are thrown back from the walls.`);
      return;
    }

    this.treasury -= Math.min(this.treasury, invasion.companies * PLUNDER_PER_COMPANY);
    for (let razed = 0; razed < invasion.companies; razed++) {
      const victim = this.randomBuilding();
      if (victim) this.demolish(victim.x, victim.y);
    }
    this.log(`The ${invasion.nation} sack the city, Archon.`);
  }

  private sufferAfflictions(): void {
    const dwellings = [...this.buildings.values()].filter((building) => isDwelling(building.kind));
    for (const house of dwellings) tendHouse(house);

    for (const { house, affliction } of accrueAfflictions(dwellings)) {
      if (affliction === 'plague') {
        house.population = Math.max(0, house.population - plagueToll(house));
        house.disease = 0;
        this.log('Plague empties houses that no doctor visits.');
        continue;
      }

      this.treasury -= Math.min(this.treasury, theftLoss(house));
      house.crime = 0;
      this.log('Thieves rob the treasury where no watchman walks.');
    }
  }

  private attendGods(): void {
    for (const kind of GOD_KINDS) {
      const god = this.gods[kind];
      const sanctuaries = [...this.buildings.values()].filter(
        (building) => building.kind === GODS[kind].sanctuary,
      );
      if (sanctuaries.length > 0) god.honoured = true;
      if (!god.honoured) continue;

      const staffed = sanctuaries.filter((building) => building.staff >= BUILDINGS[building.kind].workers);
      god.mood = moodAfterMonth(god.mood, sanctuaries.length, staffed.length);

      const act = actFor(god.mood, Math.random());
      if (act === 'bless') this.receiveBlessing(kind);
      if (act === 'curse') this.sufferWrath(kind);
    }
  }

  private receiveBlessing(kind: GodKind): void {
    if (kind === 'demeter') {
      for (const building of this.buildings.values()) {
        if (building.kind !== 'granary') continue;
        building.stock.food = BUILDINGS.granary.capacity;
      }
    }
    if (kind === 'hephaestus') {
      for (const building of this.buildings.values()) building.fireRisk = 0;
    }
    if (kind === 'hermes') {
      for (const building of this.buildings.values()) {
        const def = BUILDINGS[building.kind];
        if (def.produces) building.stock[def.produces] += UNITS_PER_CARTLOAD;
      }
    }
    if (kind === 'hades') this.treasury += HADES_GIFT;

    this.gods[kind].lastAct = GODS[kind].blessing;
    this.log(GODS[kind].blessing);
  }

  private sufferWrath(kind: GodKind): void {
    if (kind === 'demeter') {
      for (const building of this.buildings.values()) {
        if (BUILDINGS[building.kind].produces === 'food') building.stock.food = 0;
      }
    }
    if (kind === 'hephaestus') {
      const victim = this.randomBuilding();
      if (victim) victim.fireRisk = RISK_LIMIT;
    }
    if (kind === 'hermes') {
      for (const building of this.buildings.values()) {
        if (building.kind === 'granary' || building.kind === 'agora') building.stock.food = 0;
      }
    }
    if (kind === 'hades') this.treasury -= Math.min(this.treasury, HADES_TRIBUTE);

    this.gods[kind].lastAct = GODS[kind].wrath;
    this.log(GODS[kind].wrath);
  }

  private randomBuilding(): Building | null {
    const buildings = [...this.buildings.values()];
    if (buildings.length === 0) return null;
    return buildings[Math.floor(Math.random() * buildings.length)];
  }

  private sufferMishaps(): void {
    for (const { building, disaster } of accrueRisk(this.buildings.values())) {
      const name = nameOf(building);
      this.demolish(building.x, building.y);
      this.log(
        disaster === 'fire'
          ? `Fire has destroyed a ${name.toLowerCase()}, Archon.`
          : `A ${name.toLowerCase()} has collapsed, Archon.`,
      );
    }
  }

  private migrate(): void {
    const houses = [...this.buildings.values()].filter((building) => isDwelling(building.kind));
    const freeCapacity = houses.reduce((free, house) => free + roomIn(house), 0);

    this.migrants = migrantsFor(this.sentiment.popularity, freeCapacity, this.population);
    let remaining = Math.abs(this.migrants);
    const settling = this.migrants > 0;

    for (const house of houses) {
      if (remaining === 0) break;
      const moving = settling ? Math.min(remaining, roomIn(house)) : Math.min(remaining, house.population);
      house.population += settling ? moving : -moving;
      remaining -= moving;
    }
  }

  private updateProduction(): void {
    for (const building of this.buildings.values()) {
      if (BUILDINGS[building.kind].produces) this.updateProducer(building);

      switch (building.kind) {
        case 'agora':
          this.updateAgora(building);
          break;
        case 'fountain':
          this.updateFountain(building);
          break;
        case 'college':
          this.updateCollege(building);
          break;
        case 'maintenanceOffice':
          this.updateMaintenanceOffice(building);
          break;
        case 'taxOffice':
          this.updateTaxOffice(building);
          break;
        case 'infirmary':
          this.updateRoamingService(building, 'doctor', INFIRMARY_SPAWN_INTERVAL);
          break;
        case 'watchpost':
          this.updateRoamingService(building, 'watchman', WATCHPOST_SPAWN_INTERVAL);
          break;
        default:
          break;
      }
    }
  }

  private updateProducer(producer: Building): void {
    const def = BUILDINGS[producer.kind];
    const good = def.produces as Good;
    const hasInput = def.consumes === null || producer.stock[def.consumes] > 0;

    if (producer.stock[good] < def.capacity && hasInput) {
      producer.productionProgress += staffing(producer);
      if (producer.productionProgress >= TICKS_PER_LOAD) {
        producer.productionProgress = 0;
        producer.stock[good] += 1;
        this.outputByMonth[good][this.month] += 1;
        if (def.consumes) producer.stock[def.consumes] -= 1;
      }
    }

    if (producer.stock[good] === 0 || atWalkerLimit(producer)) return;

    const destinations = this.tilesAccepting(good);
    if (destinations.size === 0) return;
    if (spawnCartPusher(this, producer, destinations, producer.stock[good], good)) producer.stock[good] = 0;
  }

  private tilesAccepting(good: Good): Set<number> {
    return this.accessTiles((building) => {
      const def = BUILDINGS[building.kind];
      return def.accepts === good && building.stock[good] < def.capacity;
    });
  }

  private tilesSupplying(good: Good): Set<number> {
    return this.accessTiles((building) => BUILDINGS[building.kind].supplies === good && building.stock[good] > 0);
  }

  private accessTiles(matches: (building: Building) => boolean): Set<number> {
    const tiles = new Set<number>();
    for (const building of this.buildings.values()) {
      if (!matches(building)) continue;
      for (const tile of roadAccessTiles(this.grid, building)) tiles.add(tile);
    }
    return tiles;
  }

  private updateAgora(agora: Building): void {
    agora.spawnTimer += staffing(agora);
    if (atWalkerLimit(agora) || !hasRoadAccess(this.grid, agora)) return;

    const capacity = BUILDINGS.agora.capacity;
    for (const good of AGORA_GOODS) {
      if (agora.stock[good] > capacity - UNITS_PER_CARTLOAD) continue;
      const sources = this.tilesSupplying(good);
      if (sources.size > 0 && spawnDeliveryman(this, agora, sources, good)) return;
    }

    if (agora.spawnTimer < AGORA_SPAWN_INTERVAL) return;

    const onSale = this.goodsOnSaleFrom(agora.id);
    const good = AGORA_GOODS.find(
      (candidate) => !onSale.has(candidate) && agora.stock[candidate] >= PEDDLER_LOAD,
    );
    if (!good) return;
    if (spawnRoamer(this, agora, 'peddler', PEDDLER_LOAD, good)) {
      agora.spawnTimer = 0;
      agora.stock[good] -= PEDDLER_LOAD;
    }
  }

  private goodsOnSaleFrom(agoraId: number): Set<Good> {
    const goods = new Set<Good>();
    for (const walker of this.walkers.values()) {
      if (walker.kind === 'peddler' && walker.homeId === agoraId) goods.add(walker.good);
    }
    return goods;
  }

  private updateFountain(fountain: Building): void {
    fountain.spawnTimer += staffing(fountain);
    if (fountain.spawnTimer < FOUNTAIN_SPAWN_INTERVAL) return;
    if (atWalkerLimit(fountain) || !hasRoadAccess(this.grid, fountain)) return;

    if (spawnRoamer(this, fountain, 'waterCarrier')) fountain.spawnTimer = 0;
  }

  private updateCollege(college: Building): void {
    college.spawnTimer += staffing(college);
    if (college.spawnTimer < COLLEGE_SPAWN_INTERVAL) return;
    if (atWalkerLimit(college) || !hasRoadAccess(this.grid, college)) return;

    const podium = this.freePodium();
    if (!podium) return;
    if (spawnPhilosopher(this, college, podium)) college.spawnTimer = 0;
  }

  private freePodium(): Building | undefined {
    for (const building of this.buildings.values()) {
      if (building.kind !== 'podium' || atWalkerLimit(building)) continue;
      if (hasRoadAccess(this.grid, building)) return building;
    }
    return undefined;
  }

  private updateMaintenanceOffice(office: Building): void {
    office.spawnTimer += staffing(office);
    if (office.spawnTimer < MAINTENANCE_SPAWN_INTERVAL) return;
    if (atWalkerLimit(office) || !hasRoadAccess(this.grid, office)) return;

    if (spawnRoamer(this, office, 'superintendent')) office.spawnTimer = 0;
  }

  private updateRoamingService(building: Building, walker: WalkerKind, interval: number): void {
    building.spawnTimer += staffing(building);
    if (building.spawnTimer < interval) return;
    if (atWalkerLimit(building) || !hasRoadAccess(this.grid, building)) return;

    if (spawnRoamer(this, building, walker)) building.spawnTimer = 0;
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
