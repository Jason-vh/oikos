import { BUILDINGS, HOUSE_CAPACITY, HOUSE_NAMES, MONTH_SECONDS, ROAD_COST, footprint, storesGoods } from '../sim/catalog';
import { harbourPlacement, harbourSite } from '../sim/founding';
import { footprintTiles, mapOf } from '../sim/grid';
import { harbourStatus } from '../sim/harbour';
import { ISLAND_COUNT, buildable, islandAt, islandFacts, islandFor, levelOn, terrainOn, tileAtOn, tileIndexOn } from '../sim/island';
import { foreignOccupancy } from '../sim/occupancy';
import type { IslandMap, IslandPlacement } from '../sim/island';
import type { Building, BuildingKind, BuildTool, City, Rotation, Terrain, Tile, World } from '../sim/types';
import { WALKER_ROLES, buildingStatus, getSummary, placement, roadPathPlacement, storeCapacity, walkerStatus } from '../sim/world';

export interface MapWindow { x: number; z: number; width: number; depth: number }

const TERRAIN_GLYPHS: Record<Terrain, string> = {
  water: '~',
  sand: '.',
  grass: ',',
  fertile: '"',
  scrub: ';',
  forest: 'T',
  rock: '^',
  cliff: '#',
};

const BUILDING_GLYPHS: Record<BuildingKind, string> = {
  house: 'D',
  farm: 'F',
  granary: 'G',
  agora: 'A',
  fountain: 'W',
  maintenance: 'M',
  lodge: 'L',
  woodcutter: 'C',
  orchard: 'O',
  press: 'P',
  stockpile: 'S',
  wharf: 'B',
  harbour: 'H',
};


const OWN_ROAD_GLYPH = '+';
const FOREIGN_ROAD_GLYPH = '=';
const MIN_WINDOW_WIDTH = 24;
const MIN_WINDOW_DEPTH = 16;
export const MAX_WINDOW_WIDTH = 128;
export const MAX_WINDOW_DEPTH = 96;

function clampWindow(bounds: MapWindow, requested: MapWindow): MapWindow {
  const x = Math.max(bounds.x, Math.min(requested.x, bounds.x + bounds.width - 1));
  const z = Math.max(bounds.z, Math.min(requested.z, bounds.z + bounds.depth - 1));
  const width = Math.max(1, Math.min(requested.width, bounds.x + bounds.width - x, MAX_WINDOW_WIDTH));
  const depth = Math.max(1, Math.min(requested.depth, bounds.z + bounds.depth - z, MAX_WINDOW_DEPTH));
  return { x, z, width, depth };
}

export interface Viewpoint { map: IslandMap; home: number; city: City | null }

export function viewpointOf(world: World, city: City): Viewpoint {
  return { map: mapOf(world, city), home: city.home, city };
}

export function viewpointOn(world: World, home: number, city: City | null = null): Viewpoint {
  if (city && city.home === home) return viewpointOf(world, city);
  return { map: islandFor(world.seed, home), home, city: null };
}

export function viewpointAt(world: World, city: City | null, x: number, z: number): Viewpoint | null {
  const map = islandFor(world.seed);
  const island = islandAt(map, x, z);
  if (!island) return null;
  return viewpointOn(world, map.islands.indexOf(island), city);
}

export function islandBounds(view: Viewpoint): MapWindow {
  const island = view.map.islands[view.home];
  return { x: island.x, z: island.z, width: island.width, depth: island.depth };
}

export function cityWindow(world: World, city: City, margin = 6): MapWindow {
  const map = mapOf(world, city);
  const tiles = [...city.roads, ...city.buildings.flatMap((building) => footprintTiles(map, building))];
  tiles.push(...footprintTiles(map, city.harbour));
  const xs = tiles.map((tile) => tile % map.width);
  const zs = tiles.map((tile) => Math.floor(tile / map.width));
  const left = Math.min(...xs) - margin;
  const top = Math.min(...zs) - margin;
  const width = Math.max(MIN_WINDOW_WIDTH, Math.max(...xs) - Math.min(...xs) + 1 + margin * 2);
  const depth = Math.max(MIN_WINDOW_DEPTH, Math.max(...zs) - Math.min(...zs) + 1 + margin * 2);
  return clampWindow(islandBounds(viewpointOf(world, city)), { x: left, z: top, width, depth });
}

function glyphs(world: World, view: Viewpoint, window: MapWindow): Map<number, string> {
  const map = view.map;
  const marks = new Map<number, string>();
  for (const other of world.cities) {
    const own = other.id === view.city?.id;
    const road = own ? OWN_ROAD_GLYPH : FOREIGN_ROAD_GLYPH;
    for (const tile of other.roads) marks.set(tile, road);
    for (const building of other.buildings) {
      const glyph = own ? BUILDING_GLYPHS[building.kind] : BUILDING_GLYPHS[building.kind].toLowerCase();
      for (const tile of footprintTiles(map, building)) marks.set(tile, glyph);
    }
    const harbour = own ? BUILDING_GLYPHS.harbour : BUILDING_GLYPHS.harbour.toLowerCase();
    for (const tile of footprintTiles(map, other.harbour)) marks.set(tile, harbour);
  }
  const window_ = new Map<number, string>();
  for (const [tile, glyph] of marks) {
    const x = tile % map.width;
    const z = Math.floor(tile / map.width);
    if (x >= window.x && x < window.x + window.width && z >= window.z && z < window.z + window.depth) window_.set(tile, glyph);
  }
  return window_;
}

function ruler(window: MapWindow, indent: number): string {
  const columns = new Array<string>(window.width).fill(' ');
  for (let x = Math.ceil(window.x / 10) * 10; x < window.x + window.width; x += 10) {
    const label = String(x);
    if (x - window.x + label.length > window.width) break;
    for (let index = 0; index < label.length; index++) columns[x - window.x + index] = label[index];
  }
  return ' '.repeat(indent) + columns.join('').trimEnd();
}

export function renderMap(world: World, view: Viewpoint, requested: MapWindow): string {
  const window = clampWindow(islandBounds(view), requested);
  const map = view.map;
  const marks = glyphs(world, view, window);
  const labelWidth = String(window.z + window.depth - 1).length;
  const lines = [ruler(window, labelWidth + 1)];
  for (let z = window.z; z < window.z + window.depth; z++) {
    let row = '';
    for (let x = window.x; x < window.x + window.width; x++) {
      const tile = tileIndexOn(map, x, z);
      row += marks.get(tile) ?? TERRAIN_GLYPHS[terrainOn(map, x, z)];
    }
    lines.push(`${String(z).padStart(labelWidth)} ${row}`);
  }
  return lines.join('\n');
}

function legend(world: World, view: Viewpoint, window: MapWindow): string {
  const terrain = (Object.keys(TERRAIN_GLYPHS) as Terrain[]).map((kind) => `${TERRAIN_GLYPHS[kind]} ${kind}`);
  const present = new Set([...glyphs(world, view, window).values()].map((glyph) => glyph.toUpperCase()));
  const built = (Object.keys(BUILDING_GLYPHS) as BuildingKind[])
    .filter((kind) => present.has(BUILDING_GLYPHS[kind]))
    .map((kind) => `${BUILDING_GLYPHS[kind]} ${BUILDINGS[kind].name.toLowerCase()}`);
  const roads = view.city ? [`${OWN_ROAD_GLYPH} your road`] : [];
  if (present.has(FOREIGN_ROAD_GLYPH)) roads.push(`${FOREIGN_ROAD_GLYPH} another city's road`);
  const lines = [`Legend: ${[...terrain, ...roads, ...built].join(', ')}.`];
  if ([...glyphs(world, view, window).values()].some((glyph) => glyph !== glyph.toUpperCase())) lines.push("Lowercase letters are another city's buildings.");
  return lines.join('\n');
}

function terrainCounts(view: Viewpoint): string {
  const map = view.map;
  const bounds = islandBounds(view);
  const counts = new Map<Terrain, number>();
  for (let z = bounds.z; z < bounds.z + bounds.depth; z++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if (islandAt(map, x, z) !== map.islands[view.home]) continue;
      const kind = terrainOn(map, x, z);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(', ');
}

export function surveyIsland(world: World, view: Viewpoint, requested?: MapWindow): string {
  const bounds = islandBounds(view);
  const window = clampWindow(bounds, requested ?? (view.city ? cityWindow(world, view.city) : bounds));
  const lines = [
    `Island ${view.home} of the archipelago: x ${bounds.x}-${bounds.x + bounds.width - 1}, z ${bounds.z}-${bounds.z + bounds.depth - 1}.`,
    'Farms need fertile ground; buildings need flat, clear grass, fertile, sand or scrub. A harbour needs two rows of that shore with three rows of open water in front of it.',
    `Island terrain: ${terrainCounts(view)}.`,
    `Window x ${window.x}-${window.x + window.width - 1}, z ${window.z}-${window.z + window.depth - 1} of ${bounds.width}x${bounds.depth} tiles.`,
    renderMap(world, view, window),
    legend(world, view, window),
  ];
  return lines.join('\n');
}

function stockLine(building: Building): string {
  const entries = Object.entries(building.stores).filter(([, amount]) => (amount ?? 0) >= 1);
  if (!entries.length) return 'empty';
  const held = entries.map(([resource, amount]) => `${Math.round(amount ?? 0)} ${resource}`).join(', ');
  return `${held} of ${storeCapacity(building)}`;
}

function describeBuilding(world: World, city: City, building: Building): string {
  const definition = BUILDINGS[building.kind];
  const { width, depth } = footprint(building.kind, building.rotation);
  const head = `${building.kind} #${building.id} at (${building.x},${building.z}) ${width}x${depth}`;
  const facts: string[] = [];
  if (building.kind === 'house') {
    facts.push(HOUSE_NAMES[building.tier], `${building.residents} of ${HOUSE_CAPACITY[building.tier]} residents`);
    facts.push(`food ${Math.round(building.food)}, water ${Math.round(building.water)}, oil ${Math.round(building.oil)}`);
  } else {
    if (definition.jobs > 0) facts.push(`workers ${Math.round(building.workers)} of ${definition.jobs}`);
    if (storesGoods(building.kind)) facts.push(`stock ${stockLine(building)}`);
  }
  facts.push(`condition ${Math.round(building.condition)}%`);
  if (!building.connected) facts.push('no road');
  const status = building.kind === 'harbour' ? harbourStatus(building) : buildingStatus(world, city, building);
  return `  ${head}: ${facts.join(', ')}. ${status.join(' ')}`;
}

function walkerLines(city: City): string[] {
  if (!city.walkers.length) return ['Walkers: none on the roads.'];
  const counts = new Map<string, number>();
  for (const walker of city.walkers) counts.set(WALKER_ROLES[walker.kind], (counts.get(WALKER_ROLES[walker.kind]) ?? 0) + 1);
  const tally = [...counts].map(([role, count]) => `${count} ${role.toLowerCase()}`).join(', ');
  return [`Walkers (${city.walkers.length}): ${tally}.`];
}

export function cityReport(world: World, city: City): string {
  const summary = getSummary(city);
  const months = world.time / MONTH_SECONDS;
  const lines = [
    `City ${city.id} on island ${city.home}, month ${months.toFixed(1)} (${Math.round(world.time)}s of simulated time).`,
    `Treasury ${Math.round(city.money)} dr, balance ${summary.balance >= 0 ? '+' : ''}${summary.balance} dr per month (income ${summary.income}, upkeep ${summary.upkeep}).`,
    `Population ${summary.population}, employment ${Math.round(summary.workers)} of ${summary.jobs} jobs, food in store ${Math.round(summary.food)}.`,
    `Harvested ${Math.round(city.produced)} food, delivered ${Math.round(city.delivered)} to homes.`,
    `Goal: ${summary.prosperous} of 4 courtyard houses thriving with a balanced budget; ${summary.goal ? 'met' : 'not met yet'}.`,
    `Townhouses: ${summary.townhouses}.`,
    describeBuilding(world, city, city.harbour).trimStart(),
  ];
  if (city.buildings.length) {
    lines.push(`Buildings (${city.buildings.length}):`);
    for (const building of [...city.buildings].sort((a, b) => a.id - b.id)) lines.push(describeBuilding(world, city, building));
  } else lines.push('Buildings: none yet.');
  lines.push(...walkerLines(city));
  lines.push(`Roads: ${city.roads.length} tiles.`);
  return lines.join('\n');
}

function whereabouts(map: IslandMap, city: City | null, island: IslandPlacement | null): string {
  if (!island) return 'Open sea.';
  const home = map.islands.indexOf(island);
  if (city && island === map.islands[city.home]) return 'On your island.';
  if (city) return `On island ${home}; you cannot build there.`;
  return `On island ${home}, where found_city could claim a shore.`;
}

export function inspectTile(world: World, city: City | null, x: number, z: number): string {
  const map = city ? mapOf(world, city) : islandFor(world.seed);
  if (x < 0 || z < 0 || x >= map.width || z >= map.depth) return `(${x},${z}) is outside the archipelago.`;
  const tile = tileIndexOn(map, x, z);
  const terrain = terrainOn(map, x, z);
  const lines = [
    `(${x},${z}): ${terrain}, level ${levelOn(map, x, z)}, ${buildable(terrain) ? 'buildable ground' : 'not buildable'}${terrain === 'fertile' ? ', takes a wheat farm' : ''}.`,
    whereabouts(map, city, islandAt(map, x, z)),
  ];
  if (city?.roads.includes(tile)) lines.push('Your road runs here.');
  if (city) {
    const occupant = [...city.buildings, city.harbour].find((building) => footprintTiles(map, building).includes(tile));
    if (occupant) lines.push(describeBuilding(world, city, occupant).trimStart());
  }
  const foreign = foreignOccupancy(world, city?.id ?? null);
  if (foreign.roads.has(tile)) lines.push("Another city's road holds this tile.");
  if (foreign.buildings.has(tile)) lines.push("Another city's building holds this tile.");
  return lines.join('\n');
}

export function atlas(world: World): string {
  const map = islandFor(world.seed);
  const lines = [
    'The archipelago has eight islands. Found your city on the shore of a free one; its harbour claims the island.',
    'survey with an island number reads its coastline before you commit to it.',
  ];
  for (let home = 0; home < ISLAND_COUNT; home++) {
    const facts = islandFacts(map, home);
    const island = map.islands[home];
    const holder = world.cities.find((city) => city.home === home);
    const state = holder ? 'claimed' : 'free';
    lines.push(`Island ${home}: ${state}, around (${island.entry.x},${island.entry.z}), ${facts.land} land tiles, ${facts.fertile} fertile, ${facts.forest} forest.`);
  }
  return lines.join('\n');
}

export function inspectBuilding(world: World, city: City, id: number): string {
  const building = [city.harbour, ...city.buildings].find((candidate) => candidate.id === id);
  if (!building) return `No building #${id} in this city.`;
  const lines = [describeBuilding(world, city, building).trimStart()];
  const walkers = city.walkers.filter((walker) => walker.homeId === id);
  for (const walker of walkers) lines.push(`  ${WALKER_ROLES[walker.kind]}: ${walkerStatus(city, walker).join(' ')}`);
  return lines.join('\n');
}

function afford(city: City, cost: number): string {
  return `costs ${cost} dr, leaving ${Math.round(city.money) - cost} dr`;
}

const BLOCKED_SHOWN = 6;

function blockedTiles(map: IslandMap, blocked: number[] | undefined): string {
  if (!blocked?.length) return '';
  const named = blocked.slice(0, BLOCKED_SHOWN).map((tile) => {
    const { x, z } = tileAtOn(map, tile);
    return `(${x},${z}) ${terrainOn(map, x, z)}`;
  });
  const rest = blocked.length - named.length;
  return ` Blocked at ${named.join(', ')}${rest > 0 ? `, and ${rest} more of the ${blocked.length}` : ''}.`;
}

export function describePlacement(world: World, city: City, tool: BuildTool, x: number, z: number, rotation: Rotation): string {
  const result = placement(world, city, tool, x, z, rotation);
  const { width, depth } = tool === 'road' ? { width: 1, depth: 1 } : footprint(tool, rotation);
  const head = `${tool} at (${x},${z}) rotation ${rotation}, ${width}x${depth} covering (${x},${z})-(${x + width - 1},${z + depth - 1})`;
  if (!result.ok) return `${head}: refused. ${result.reason}${blockedTiles(mapOf(world, city), result.blocked)}`;
  return `${head}: allowed, ${afford(city, result.cost)}.`;
}

export function describeRoadPath(world: World, city: City, tiles: Tile[]): string {
  const result = roadPathPlacement(world, city, tiles);
  const head = `Road from (${tiles[0].x},${tiles[0].z}) to (${tiles[tiles.length - 1].x},${tiles[tiles.length - 1].z})`;
  if (!result.ok) return `${head}: refused. ${result.reason}${blockedTiles(mapOf(world, city), result.blocked)}`;
  return `${head}: allowed, ${result.tiles.length} tiles of which ${result.cost / ROAD_COST} are new, ${afford(city, result.cost)}.`;
}

function rowsOf(tiles: Tile[]): string {
  return tiles.map((tile) => `(${tile.x},${tile.z})`).join(' ');
}

export function describeHarbourSite(world: World, x: number, z: number, rotation: Rotation): string {
  const result = harbourPlacement(world, x, z, rotation);
  const site = harbourSite(x, z, rotation);
  const head = `Harbour at (${x},${z}) facing ${rotation}`;
  const tested = `Quay on ${rowsOf(site.land)}; pier over ${rowsOf(site.water)}.`;
  if (!result.ok) return `${head}: refused. ${result.reason} ${tested}${blockedTiles(islandFor(world.seed), result.blocked)}`;
  return `${head}: allowed, free, and fixed once placed. ${tested}`;
}
