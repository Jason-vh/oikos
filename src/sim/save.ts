import type { Request } from './events';
import type { GodKind, GodState } from './gods';
import type { Building } from './types';
import { World } from './world';

const STORAGE_KEY = 'zeus.city';
const SAVE_VERSION = 15;

export interface View {
  x: number;
  y: number;
  scale: number;
}

interface SavedCity {
  version: number;
  seed: number;
  size: number;
  treasury: number;
  wageLevel: number;
  taxRate: number;
  tick: number;
  month: number;
  year: number;
  buildings: Building[];
  gods: Record<GodKind, GodState>;
  tradeOrders: Record<string, boolean>;
  episode: number;
  difficulty: number;
  requests: Request[];
  goodwill: Record<string, number>;
  roads: number[];
  roadblocks: number[];
  walls: number[];
  view: View;
}

export function serialise(world: World, view: View): SavedCity {
  const roads: number[] = [];
  const roadblocks: number[] = [];
  const walls: number[] = [];
  for (let tile = 0; tile < world.grid.road.length; tile++) {
    if (world.grid.road[tile] === 1) roads.push(tile);
    if (world.grid.roadblock[tile] === 1) roadblocks.push(tile);
    if (world.grid.wall[tile] === 1) walls.push(tile);
  }

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    size: world.grid.size,
    treasury: world.treasury,
    wageLevel: world.wageLevel,
    taxRate: world.taxRate,
    tick: world.tick,
    month: world.month,
    year: world.year,
    buildings: [...world.buildings.values()],
    gods: world.gods,
    tradeOrders: world.tradeOrders,
    episode: world.episode,
    difficulty: world.difficulty,
    requests: world.requests,
    goodwill: world.goodwill,
    roads,
    roadblocks,
    walls,
    view,
  };
}

export function deserialise(saved: SavedCity): World {
  const world = new World(saved.size, saved.seed);
  world.treasury = saved.treasury;
  world.wageLevel = saved.wageLevel;
  world.taxRate = saved.taxRate;
  world.tick = saved.tick;
  world.month = saved.month;
  world.year = saved.year;
  world.gods = saved.gods;
  world.tradeOrders = saved.tradeOrders;
  world.difficulty = saved.difficulty;
  world.requests = saved.requests;
  world.goodwill = saved.goodwill;
  world.beginEpisode(saved.episode);

  for (const tile of saved.roads) world.grid.road[tile] = 1;
  for (const tile of saved.roadblocks) world.grid.roadblock[tile] = 1;
  for (const tile of saved.walls) world.grid.wall[tile] = 1;
  for (const building of saved.buildings) world.restore({ ...building, walkersOut: 0 });
  world.settle();
  return world;
}

let abandoned = false;

export function saveCity(world: World, view: View): void {
  if (abandoned) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialise(world, view)));
  } catch {
    return;
  }
}

export function loadCity(): { world: World; view: View } | null {
  const raw = readSave();
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as SavedCity;
    if (saved.version !== SAVE_VERSION) return null;
    return { world: deserialise(saved), view: saved.view };
  } catch {
    abandonCity();
    return null;
  }
}

export function abandonCity(): void {
  abandoned = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

function readSave(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
