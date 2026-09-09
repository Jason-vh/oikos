import {
  Grid,
  MAX_HEIGHT,
  TERRAIN_GRASS,
  TERRAIN_MEADOW,
  TERRAIN_ROCK,
  TERRAIN_SAND,
  TERRAIN_WATER,
} from './grid';

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Landscape {
  name: string;
  hills: number;
  rivers: number;
  lakes: number;
  shores: number;
  meadow: number;
  rock: number;
  woods: number;
}

export const LANDSCAPES: Landscape[] = [
  { name: 'a river valley', hills: 0.5, rivers: 1, lakes: 1, shores: 0, meadow: 200, rock: 500, woods: 1 },
  { name: 'a coast of bays', hills: 0.35, rivers: 1, lakes: 0, shores: 1, meadow: 260, rock: 600, woods: 0.8 },
  { name: 'the high country', hills: 0.85, rivers: 2, lakes: 2, shores: 0, meadow: 420, rock: 200, woods: 1.3 },
  { name: 'a wide plain', hills: 0.18, rivers: 1, lakes: 2, shores: 0, meadow: 130, rock: 900, woods: 0.6 },
  { name: 'a lakeland', hills: 0.45, rivers: 0, lakes: 7, shores: 0, meadow: 220, rock: 550, woods: 1.6 },
  { name: 'a headland', hills: 0.55, rivers: 1, lakes: 1, shores: 2, meadow: 240, rock: 380, woods: 0.9 },
];

export function landscapeFor(seed: number): Landscape {
  return LANDSCAPES[seed % LANDSCAPES.length];
}

export function generateMap(grid: Grid, seed: number): Landscape {
  const random = createRandom(seed);
  const landscape = landscapeFor(seed);
  grid.terrain.fill(TERRAIN_GRASS);

  applyTerraces(grid, fractalNoise(grid.size, random), landscape.hills);
  floodShores(grid, random, landscape.shores);
  for (let river = 0; river < landscape.rivers; river++) carveRiver(grid, random);
  poolLakes(grid, random, landscape.lakes);

  const blobs = (perTiles: number) => Math.max(3, Math.round((grid.size * grid.size) / perTiles));
  sowMeadows(grid, random, blobs(landscape.meadow));
  layRidges(grid, random, blobs(landscape.rock));
  makeGoodOnTheGround(grid, random);
  fringeWaterWithSand(grid);
  scatterDecor(grid, random, landscape.woods);
  return landscape;
}

/** Meadow follows the water: the flats a river or a lake has watered, and the odd
 * damp hollow away from it. */
function sowMeadows(grid: Grid, random: () => number, count: number): void {
  const banks = tilesWhere(grid, (index) => grid.height[index] <= 1 && nearWater(grid, index, 4));

  for (let meadow = 0; meadow < count; meadow++) {
    const bank = banks.length > 0 && random() < 0.75;
    const seed = bank ? banks[Math.floor(random() * banks.length)] : Math.floor(random() * grid.terrain.length);
    if (grid.height[seed] > 1) continue;

    paintBlob(grid, random, TERRAIN_MEADOW, grid.tileX(seed), grid.tileY(seed), 3 + random() * 4, (index) => grid.height[index] <= 1);
  }
}

/** Rock breaks out along the tops, in seams rather than spots. */
function layRidges(grid: Grid, random: () => number, count: number): void {
  const tops = tilesWhere(grid, (index) => grid.height[index] >= 2);
  if (tops.length === 0) return;

  for (let ridge = 0; ridge < count; ridge++) {
    const start = tops[Math.floor(random() * tops.length)];
    let x = grid.tileX(start);
    let y = grid.tileY(start);
    const angle = random() * Math.PI * 2;
    const length = 4 + Math.floor(random() * 9);

    for (let step = 0; step < length; step++) {
      x += Math.cos(angle) + (random() - 0.5) * 0.8;
      y += Math.sin(angle) + (random() - 0.5) * 0.8;
      paintBlob(grid, random, TERRAIN_ROCK, Math.round(x), Math.round(y), 0.8 + random() * 1.6, (index) => grid.height[index] >= 2);
    }
  }
}

function tilesWhere(grid: Grid, accepts: (index: number) => boolean): number[] {
  const tiles: number[] = [];
  for (let index = 0; index < grid.terrain.length; index++) {
    if (grid.terrain[index] === TERRAIN_GRASS && accepts(index)) tiles.push(index);
  }
  return tiles;
}

function nearWater(grid: Grid, index: number, range: number): boolean {
  const x = grid.tileX(index);
  const y = grid.tileY(index);
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (!grid.contains(x + dx, y + dy)) continue;
      if (grid.terrain[grid.index(x + dx, y + dy)] === TERRAIN_WATER) return true;
    }
  }
  return false;
}

/** No landscape may leave the city without fields to farm, rock to quarry or water to fish. */
function makeGoodOnTheGround(grid: Grid, random: () => number): void {
  const has = (terrain: number) => grid.terrain.some((tile) => tile === terrain);

  if (!has(TERRAIN_MEADOW)) {
    scatterBlobs(grid, random, TERRAIN_MEADOW, 6, 3, 6, (index) => grid.height[index] <= 1);
  }
  if (!has(TERRAIN_ROCK)) {
    scatterBlobs(grid, random, TERRAIN_ROCK, 5, 2, 4, () => true);
  }
  if (!has(TERRAIN_WATER)) poolLakes(grid, random, 2);
}

const DRY_EDGES_KEPT = 2;

type EdgeTile = (grid: Grid, step: number) => [number, number];

const EDGES: EdgeTile[] = [
  (_grid, step) => [step, 0],
  (grid, step) => [grid.size - 1, step],
  (grid, step) => [step, grid.size - 1],
  (_grid, step) => [0, step],
];

export function entryPoint(grid: Grid, seed: number): number {
  for (let turn = 0; turn < EDGES.length; turn++) {
    const tile = nearestLandToMiddle(grid, EDGES[(seed + turn) % EDGES.length]);
    if (tile !== -1) return tile;
  }
  return grid.index(0, 0);
}

function nearestLandToMiddle(grid: Grid, edge: EdgeTile): number {
  const middle = (grid.size - 1) / 2;
  const steps: number[] = [];
  for (let step = 1; step < grid.size - 1; step++) steps.push(step);
  steps.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));

  for (const step of steps) {
    const [x, y] = edge(grid, step);
    const [inwardX, inwardY] = inlandFrom(grid, x, y, 1);
    if (grid.isLand(x, y) && grid.isLand(inwardX, inwardY)) return grid.index(x, y);
  }
  return -1;
}

export function inlandFrom(grid: Grid, x: number, y: number, distance: number): [number, number] {
  const last = grid.size - 1;
  if (y === 0) return [x, distance];
  if (y === last) return [x, last - distance];
  if (x === 0) return [distance, y];
  return [last - distance, y];
}

export const DECOR_KINDS = ['cypress', 'olive', 'scrub', 'boulder'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];
export const DECOR_VARIANTS = 3;

export function decorKindOf(byte: number): DecorKind {
  return DECOR_KINDS[Math.floor((byte - 1) / DECOR_VARIANTS)];
}

export function decorVariantOf(byte: number): number {
  return (byte - 1) % DECOR_VARIANTS;
}

const CLUSTER_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function scatterDecor(grid: Grid, random: () => number, woods: number): void {
  for (let index = 0; index < grid.terrain.length; index++) {
    if (grid.decor[index] !== 0) continue;

    const terrain = grid.terrain[index];
    if (terrain === TERRAIN_WATER || terrain === TERRAIN_SAND) continue;

    const nearCliff = isNearCliff(grid, index);
    if (random() >= seedDensity(terrain, nearCliff) * woods) continue;

    placeCluster(grid, random, index, terrain, nearCliff);
  }
}

function isNearCliff(grid: Grid, index: number): boolean {
  return grid.neighbours(index).some((neighbour) => grid.height[neighbour] !== grid.height[index]);
}

function seedDensity(terrain: number, nearCliff: boolean): number {
  if (terrain === TERRAIN_ROCK) return nearCliff ? 0.3 : 0.22;
  if (terrain === TERRAIN_MEADOW) return 0.035;
  return nearCliff ? 0.14 : 0.07;
}

function placeCluster(
  grid: Grid,
  random: () => number,
  seed: number,
  terrain: number,
  nearCliff: boolean,
): void {
  const kindIndex = pickDecorKind(terrain, nearCliff, random);
  for (const tile of clusterTiles(grid, random, seed, kindIndex)) {
    if (grid.decor[tile] !== 0 || grid.terrain[tile] !== terrain) continue;
    const variant = Math.floor(random() * DECOR_VARIANTS);
    grid.decor[tile] = kindIndex * DECOR_VARIANTS + variant + 1;
  }
}

function clusterTiles(grid: Grid, random: () => number, seed: number, kindIndex: number): number[] {
  const x = grid.tileX(seed);
  const y = grid.tileY(seed);
  const tiles = [seed];

  if (kindIndex === 0) {
    const length = 2 + Math.floor(random() * 2);
    const horizontal = random() < 0.5;
    for (let i = 1; i < length; i++) {
      const nx = horizontal ? x + i : x;
      const ny = horizontal ? y : y + i;
      if (!grid.contains(nx, ny)) break;
      tiles.push(grid.index(nx, ny));
    }
    return tiles;
  }

  const size = kindIndex === 3 ? 2 + Math.floor(random() * 2) : 1 + Math.floor(random() * 4);
  const offsets = shuffled(CLUSTER_OFFSETS, random);
  for (const [dx, dy] of offsets) {
    if (tiles.length >= size) break;
    const nx = x + dx;
    const ny = y + dy;
    if (!grid.contains(nx, ny)) continue;
    tiles.push(grid.index(nx, ny));
  }
  return tiles;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickDecorKind(terrain: number, nearCliff: boolean, random: () => number): number {
  const roll = random();

  if (terrain === TERRAIN_ROCK || nearCliff) {
    if (roll < 0.45) return 3;
    if (roll < 0.7) return 0;
    if (roll < 0.87) return 1;
    return 2;
  }

  if (terrain === TERRAIN_MEADOW) return roll < 0.7 ? 2 : 1;

  if (roll < 0.28) return 0;
  if (roll < 0.58) return 1;
  if (roll < 0.9) return 2;
  return 3;
}

function fractalNoise(size: number, random: () => number): Float32Array {
  const field = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;

  for (const period of [24, 12, 6]) {
    addOctave(field, size, period, amplitude, random);
    total += amplitude;
    amplitude *= 0.45;
  }

  for (let i = 0; i < field.length; i++) field[i] /= total;
  return field;
}

function addOctave(
  field: Float32Array,
  size: number,
  period: number,
  amplitude: number,
  random: () => number,
): void {
  const lattice = Math.ceil(size / period) + 2;
  const corners = new Float32Array(lattice * lattice);
  for (let i = 0; i < corners.length; i++) corners[i] = random();

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / period;
      const gy = y / period;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smoothstep(gx - x0);
      const fy = smoothstep(gy - y0);

      const top = lerp(corners[y0 * lattice + x0], corners[y0 * lattice + x0 + 1], fx);
      const bottom = lerp(corners[(y0 + 1) * lattice + x0], corners[(y0 + 1) * lattice + x0 + 1], fx);
      field[y * size + x] += lerp(top, bottom, fy) * amplitude;
    }
  }
}

function applyTerraces(grid: Grid, elevation: Float32Array, hills: number): void {
  const lowest = 0.72 - hills * 0.4;
  const thresholds = [0, 1, 2, 3].map((step) => lowest + step * (0.12 - hills * 0.04));

  for (let i = 0; i < elevation.length; i++) {
    let height = 0;
    for (const threshold of thresholds) {
      if (elevation[i] > threshold) height += 1;
    }
    grid.height[i] = Math.min(MAX_HEIGHT, height);
  }
}

function carveRiver(grid: Grid, random: () => number): void {
  const downstream = random() < 0.5;
  let centre = Math.floor(grid.size * (0.2 + random() * 0.6));

  for (let along = 0; along < grid.size; along++) {
    centre += Math.round(random() * 2 - 1);
    centre = Math.min(grid.size - 4, Math.max(3, centre));
    const width = 2 + Math.floor(random() * 2);

    for (let across = -2; across < width + 2; across++) {
      const x = downstream ? centre + across : along;
      const y = downstream ? along : centre + across;
      if (!grid.contains(x, y)) continue;
      const tile = grid.index(x, y);

      if (across >= 0 && across < width) {
        grid.terrain[tile] = TERRAIN_WATER;
        grid.height[tile] = 0;
      } else {
        grid.height[tile] = Math.min(grid.height[tile], 1);
      }
    }
  }
}

/** The sea takes a ragged bite out of an edge or two, leaving bays and headlands. */
function floodShores(grid: Grid, random: () => number, shores: number): void {
  const last = grid.size - 1;
  const reachOf = (step: number, seed: number) =>
    9 + Math.round((Math.sin(step / 11 + seed) * 5 + Math.sin(step / 5 + seed * 2) * 3) * 1.4 + random() * 3);

  for (let shore = 0; shore < Math.min(shores, DRY_EDGES_KEPT); shore++) {
    const seed = random() * 10;
    for (let step = 0; step <= last; step++) {
      const reach = Math.max(0, reachOf(step, seed));
      for (let depth = 0; depth < reach; depth++) {
        const [x, y] = shore === 0 ? [step, depth] : shore === 1 ? [depth, step] : [step, last - depth];
        if (!grid.contains(x, y)) continue;
        const tile = grid.index(x, y);
        grid.terrain[tile] = TERRAIN_WATER;
        grid.height[tile] = 0;
      }
    }
    strewIslands(grid, random, shore);
  }
}

/** A rock or two left standing off the shore. */
function strewIslands(grid: Grid, random: () => number, shore: number): void {
  const last = grid.size - 1;
  for (let island = 0; island < 2; island++) {
    const along = 8 + Math.floor(random() * (grid.size - 16));
    const depth = 2 + Math.floor(random() * 6);
    const [cx, cy] = shore === 0 ? [along, depth] : shore === 1 ? [depth, along] : [along, last - depth];
    const radius = 1.5 + random() * 2;

    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (!grid.contains(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > radius) continue;
        if (grid.terrain[grid.index(x, y)] !== TERRAIN_WATER) continue;
        grid.terrain[grid.index(x, y)] = TERRAIN_GRASS;
      }
    }
  }
}

function poolLakes(grid: Grid, random: () => number, lakes: number): void {
  for (let lake = 0; lake < lakes; lake++) {
    const cx = 6 + Math.floor(random() * (grid.size - 12));
    const cy = 6 + Math.floor(random() * (grid.size - 12));
    const radius = 3 + random() * 5;

    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (!grid.contains(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) + random() * 1.2 > radius) continue;

        const tile = grid.index(x, y);
        grid.terrain[tile] = TERRAIN_WATER;
        grid.height[tile] = 0;
      }
    }
  }
}

function fringeWaterWithSand(grid: Grid): void {
  const sand: number[] = [];

  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const index = grid.index(x, y);
      if (grid.terrain[index] !== TERRAIN_GRASS || grid.height[index] > 0) continue;
      const touchesWater = grid
        .neighbours(index)
        .some((neighbour) => grid.terrain[neighbour] === TERRAIN_WATER);
      if (touchesWater) sand.push(index);
    }
  }

  for (const index of sand) grid.terrain[index] = TERRAIN_SAND;
}

function scatterBlobs(
  grid: Grid,
  random: () => number,
  terrain: number,
  count: number,
  minRadius: number,
  maxRadius: number,
  accepts: (index: number) => boolean,
): void {
  for (let blob = 0; blob < count; blob++) {
    const cx = Math.floor(random() * grid.size);
    const cy = Math.floor(random() * grid.size);
    paintBlob(grid, random, terrain, cx, cy, minRadius + random() * (maxRadius - minRadius), accepts);
  }
}

function paintBlob(
  grid: Grid,
  random: () => number,
  terrain: number,
  cx: number,
  cy: number,
  radius: number,
  accepts: (index: number) => boolean,
): void {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      if (!grid.contains(x, y)) continue;
      if (Math.hypot(x - cx, y - cy) + random() * 0.9 > radius) continue;

      const index = grid.index(x, y);
      if (grid.terrain[index] !== TERRAIN_GRASS || !accepts(index)) continue;
      grid.terrain[index] = terrain;
    }
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
