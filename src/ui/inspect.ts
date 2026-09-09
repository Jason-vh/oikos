import { STALL_WORKERS, VENDOR_COST, freeStalls, isAgora, stallGoods } from '../sim/agora';
import { bandValues } from '../sim/appeal';
import {
  BUILDINGS,
  ROADBLOCK_COST,
  ROAD_COST,
  WALL_COST,
  isDwelling,
  isVacantPlot,
  tiersOf,
} from '../sim/buildings';
import type { BuildingDef } from '../sim/buildings';
import { TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from '../sim/grid';
import { GODS, GOD_KINDS, moodName } from '../sim/gods';
import { costAt } from '../sim/difficulty';
import { workersFor } from '../sim/labour';
import { describeRisk } from '../sim/hazards';
import { TRADE_ROUTES } from '../sim/trade';
import { describeAffliction } from '../sim/unrest';
import { ROAM_RANGE } from '../sim/walkers';
import type { Building, BuildingKind, Good, WalkerKind } from '../sim/types';
import type { World } from '../sim/world';
import { money } from './money';

export interface Inspection {
  title: string;
  subtitle: string;
  description: string;
  facts: [string, string][];
}

export const GOOD_NAMES: Record<Good, string> = {
  food: 'Wheat',
  olives: 'Olives',
  oil: 'Oil',
  grapes: 'Grapes',
  wine: 'Wine',
  fleece: 'Fleece',
  wood: 'Timber',
  marble: 'Marble',
  bronze: 'Bronze',
  armour: 'Armour',
  sculpture: 'Sculpture',
  horses: 'Horses',
};

const WALKER_OF: Partial<Record<BuildingKind, { name: string; kind: WalkerKind }>> = {
  agora: { name: 'Peddler', kind: 'peddler' },
  podium: { name: 'Philosopher', kind: 'philosopher' },
  gymnasium: { name: 'Athlete', kind: 'athlete' },
  theatre: { name: 'Actor', kind: 'actor' },
  infirmary: { name: 'Doctor', kind: 'doctor' },
  watchpost: { name: 'Watchman', kind: 'watchman' },
  fountain: { name: 'Water carrier', kind: 'waterCarrier' },
  taxOffice: { name: 'Clerk', kind: 'clerk' },
};

export function inspectTile(world: World, x: number, y: number): Inspection | null {
  const { grid } = world;
  if (!grid.contains(x, y)) return null;

  const index = grid.index(x, y);
  const building = world.buildingAt(index);
  if (building) return inspectBuilding(world, building, index);
  if (grid.isWall(index)) return describeWallTool();
  if (index === world.entry) return inspectEntry(world);
  if (grid.isRoadblock(index)) return inspectRoadblock(world, index);
  if (grid.isRoad(index)) return inspectRoad(world, index);
  return inspectGround(world, index);
}

export const VENDOR_NAMES: Record<Good, string> = {
  ...GOOD_NAMES,
  food: 'Food',
  armour: 'Arms',
  horses: 'Horse',
};

export function describeVendorTool(good: Good): Inspection {
  return {
    title: `${VENDOR_NAMES[good]} vendor`,
    subtitle: 'Agora stall',
    description: `Takes a free stall on an agora. He fetches ${VENDOR_NAMES[
      good
    ].toLowerCase()} from the nearest store that has it, then sells it to every house he passes.`,
    facts: [
      ['Cost', money(VENDOR_COST)],
      ['Workers', `${STALL_WORKERS}`],
      ['Stall', 'Click a free one on an agora'],
    ],
  };
}

export function describeBuildingTool(kind: BuildingKind, difficulty: number): Inspection {
  const def = BUILDINGS[kind];
  const facts: [string, string][] = [
    ['Cost', money(costAt(def.cost, difficulty))],
    ['Size', sizeOf(def)],
  ];
  if (def.stalls) facts.push(['Stalls', `${def.stalls} for vendors`]);
  if (def.workers > 0) facts.push(['Workers', `${def.workers}`]);
  if (def.requiresMeadow) facts.push(['Ground', 'Meadow only']);
  if (def.needsRoad) facts.push(['Road', 'Must touch one']);
  if (def.requires) facts.push(['Requires', BUILDINGS[def.requires].name]);
  if (def.minAppeal > 0) facts.push(['Ground', `Appeal ${def.minAppeal} or better`]);
  if (def.needsNear) facts.push(['Ground', `Beside ${def.needsNear}`]);
  if (def.marbleCost) facts.push(['Marble', `${def.marbleCost} cartloads`]);
  if (def.sculptureCost) facts.push(['Sculpture', `${def.sculptureCost} cartloads`]);
  facts.push(['Appeal', appealSummary(def)]);

  return { title: def.name, subtitle: 'Building', description: def.description, facts };
}

export function describeWallTool(): Inspection {
  return {
    title: 'Wall',
    subtitle: 'Defence',
    description: 'Dragged in a line like a road. Twelve tiles of wall are worth a company when the city is attacked.',
    facts: [['Cost', `${money(WALL_COST)} per tile`]],
  };
}

export function describeRoadTool(): Inspection {
  return {
    title: 'Road',
    subtitle: 'Network',
    description: 'The only network in the city. Every walker follows it, and nothing social crosses bare ground.',
    facts: [['Cost', `${money(ROAD_COST)} per tile`]],
  };
}

export function describeRoadblockTool(): Inspection {
  return {
    title: 'Roadblock',
    subtitle: 'Network',
    description:
      'Roaming walkers turn back here, so a block can be sealed off from wandering vendors. Anyone walking to a destination — a cart pusher, a deliveryman, a walker heading home — passes straight through.',
    facts: [['Cost', money(ROADBLOCK_COST)]],
  };
}

export function describeDemolishTool(): Inspection {
  return {
    title: 'Demolish',
    subtitle: 'Tool',
    description: 'Clears a roadblock, then a road, then a building. Nothing is refunded.',
    facts: [],
  };
}

export function describeInspectTool(): Inspection {
  return {
    title: 'Inspect',
    subtitle: 'Tool',
    description: 'Click anything in the city to read what it is doing.',
    facts: [],
  };
}

function inspectBuilding(world: World, building: Building, index: number): Inspection {
  const def = BUILDINGS[building.kind];
  const facts: [string, string][] = [];

  if (isDwelling(building.kind)) return inspectHouse(world, building, index);

  const workers = workersFor(building);
  if (workers > 0) {
    const short = workers - building.staff;
    facts.push(['Workers', short > 0 ? `${building.staff} of ${workers} — ${short} short` : `${workers}, fully staffed`]);
  }
  if (def.produces) facts.push([`${GOOD_NAMES[def.produces]} ready`, `${building.stock[def.produces]} cartloads`]);
  if (def.consumes) facts.push([`${GOOD_NAMES[def.consumes]} waiting`, `${building.stock[def.consumes]} cartloads`]);
  for (const good of def.accepts) {
    if (good === def.consumes) continue;
    facts.push([`${GOOD_NAMES[good]} stored`, `${building.stock[good]} of ${def.capacity} cartloads`]);
  }
  if (isAgora(building.kind)) {
    const vendors = stallGoods(building).map((good) => VENDOR_NAMES[good]);
    facts.push(['Vendors', vendors.length > 0 ? vendors.join(', ') : 'none yet']);
    facts.push(['Free stalls', `${freeStalls(building)} of ${building.stalls.length}`]);
    for (const good of stallGoods(building)) {
      facts.push([`${VENDOR_NAMES[good]} in stall`, `${Math.round(building.stock[good] / 100)} cartloads`]);
    }
  }

  if (building.kind === 'tradingPost') {
    facts.push(['Oil to sell', `${building.stock.oil} cartloads`]);
    facts.push(['Grain bought in', `${building.stock.food} cartloads`]);
    facts.push(['Routes open', `${TRADE_ROUTES.filter((route) => world.tradeOrders[route.id]).length} of ${TRADE_ROUTES.length}`]);
  }

  const god = GOD_KINDS.find((kind) => GODS[kind].sanctuary === building.kind);
  if (god) {
    const state = world.gods[god];
    facts.push([GODS[god].name, `${moodName(state.mood, state.honoured)} · ${state.mood} of 100`]);
    if (state.lastAct) facts.push(['Last seen', state.lastAct]);
  }

  const walker = WALKER_OF[building.kind];
  if (walker) {
    facts.push([walker.name, `roams ${ROAM_RANGE[walker.kind]} tiles`]);
    facts.push(['Out now', `${building.walkersOut} of ${def.maxWalkers}`]);
  }
  facts.push(['Appeal', appealSummary(def)]);
  facts.push(['Appeal here', `${world.grid.appeal[index]}`]);
  facts.push(['Risk', describeRisk(building)]);

  return { title: def.name, subtitle: 'Building', description: def.description, facts };
}

function inspectPlot(world: World, plot: Building, index: number): Inspection {
  const arriving = [...world.walkers.values()].some(
    (walker) => walker.kind === 'immigrant' && walker.targetId === plot.id,
  );

  return {
    title: 'Housing plot',
    subtitle: 'Housing',
    description:
      'Stakes mark out the plot. Immigrants walk in from the flag at the edge of the map and raise a hut here.',
    facts: [
      ['Settlers', arriving ? 'on their way' : 'none yet'],
      ['Waiting at the edge', `${world.arrivals}`],
      ['Road to the flag', world.entryConnected ? 'laid' : 'none'],
      ['Appeal here', `${world.grid.appeal[index]}`],
    ],
  };
}

function inspectHouse(world: World, house: Building, index: number): Inspection {
  if (isVacantPlot(house)) return inspectPlot(world, house, index);

  const tiers = tiersOf(house.kind);
  const tier = tiers[house.tier];
  const next = tiers[house.tier + 1];
  const appeal = world.grid.appeal[index];

  const facts: [string, string][] = [
    ['Citizens', `${house.population} of ${tier.capacity}`],
    ['Water', house.supply.water > 0 ? 'supplied' : 'none'],
    ['Doctor', house.supply.health > 0 ? 'visiting' : 'none'],
    ['Watchman', house.supply.safety > 0 ? 'on his rounds' : 'none'],
    ['Food', house.supply.food > 0 ? 'supplied' : 'none'],
    ['Oil', house.supply.oil > 0 ? 'supplied' : 'none'],
    ['Culture', house.supply.culture > 0 ? 'taught' : 'none'],
    ['Tax', house.supply.tax > 0 ? `paying, ×${tier.taxMultiplier}` : 'no clerk has called'],
    ['Appeal here', `${appeal}`],
    ['Fire and collapse', describeRisk(house)],
    ['Plague and crime', describeAffliction(house)],
  ];

  if (next) {
    const needs = next.needs.length > 0 ? next.needs.join(' and ') : 'nothing';
    const gate = Number.isFinite(next.evolveAppeal) ? ` and appeal ${next.evolveAppeal}` : '';
    facts.push([`Becomes a ${next.name.toLowerCase()}`, `with ${needs}${gate}`]);
  }

  return {
    title: tier.name,
    subtitle: 'Housing',
    description:
      house.tier === 0
        ? 'Newcomers throw up a hut on the plot. Feed them and they will build something better.'
        : `Home to ${house.population} citizens. It falls back a tier if its services lapse or its surroundings decay.`,
    facts,
  };
}

function inspectRoadblock(world: World, index: number): Inspection {
  return { ...describeRoadblockTool(), facts: [['Appeal here', `${world.grid.appeal[index]}`]] };
}

function inspectRoad(world: World, index: number): Inspection {
  return { ...describeRoadTool(), facts: [['Appeal here', `${world.grid.appeal[index]}`]] };
}

function inspectEntry(world: World): Inspection {
  return {
    title: 'Entry point',
    subtitle: 'The road into the city',
    description:
      'Settlers arrive here and walk to whatever housing has room. Lay a road from this flag or none of them can reach you.',
    facts: [
      ['Road from here', world.entryConnected ? 'laid' : 'none'],
      ['Waiting to come in', `${world.arrivals}`],
    ],
  };
}

function inspectGround(world: World, index: number): Inspection {
  const terrain = world.grid.terrain[index];
  return {
    title: terrainName(terrain),
    subtitle: 'Ground',
    description: terrainDescription(terrain),
    facts: [
      ['Appeal here', `${world.grid.appeal[index]}`],
      ['Elevation', `level ${world.grid.height[index]}`],
    ],
  };
}

function sizeOf(def: BuildingDef): string {
  if (!def.alongRoad) return `${def.size}×${def.size} tiles`;
  return `${def.alongRoad}×${def.size} tiles, laid along a road`;
}

function appealSummary(def: BuildingDef): string {
  const values = bandValues(def.appeal);
  if (values.length === 0) return 'none';
  return values.map((value) => (value > 0 ? `+${value}` : `${value}`)).join(' ');
}

function terrainName(terrain: number): string {
  if (terrain === TERRAIN_WATER) return 'Water';
  if (terrain === TERRAIN_MEADOW) return 'Meadow';
  if (terrain === TERRAIN_ROCK) return 'Rocks';
  if (terrain === TERRAIN_SAND) return 'Sand';
  return 'Grass';
}

function terrainDescription(terrain: number): string {
  if (terrain === TERRAIN_WATER) return 'Nothing can be built on open water.';
  if (terrain === TERRAIN_MEADOW) return 'Rich purple-tufted ground. Farms grow here and nowhere else.';
  if (terrain === TERRAIN_ROCK) return 'Bare rock. It carries no buildings.';
  if (terrain === TERRAIN_SAND) return 'Dry sand. Buildable, but nothing grows.';
  return 'Open grass. Anything but a farm can stand here.';
}
