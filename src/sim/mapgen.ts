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

export function generateMap(grid: Grid, seed: number): void {
  const random = createRandom(seed);
  grid.terrain.fill(TERRAIN_GRASS);

  const elevation = fractalNoise(grid.size, random);
  applyTerraces(grid, elevation);
  carveRiver(grid, random);
  scatterBlobs(grid, random, TERRAIN_MEADOW, 8, 2.5, 5, (index) => grid.height[index] <= 1);
  scatterBlobs(grid, random, TERRAIN_ROCK, 6, 1.5, 3, (index) => grid.height[index] >= 2);
  fringeWaterWithSand(grid);
  scatterDecor(grid, random);
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

function scatterDecor(grid: Grid, random: () => number): void {
  for (let index = 0; index < grid.terrain.length; index++) {
    if (grid.decor[index] !== 0) continue;

    const terrain = grid.terrain[index];
    if (terrain === TERRAIN_WATER || terrain === TERRAIN_SAND) continue;

    const nearCliff = isNearCliff(grid, index);
    if (random() >= seedDensity(terrain, nearCliff)) continue;

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

function applyTerraces(grid: Grid, elevation: Float32Array): void {
  const thresholds = [0.46, 0.58, 0.68, 0.78];

  for (let i = 0; i < elevation.length; i++) {
    let height = 0;
    for (const threshold of thresholds) {
      if (elevation[i] > threshold) height += 1;
    }
    grid.height[i] = Math.min(MAX_HEIGHT, height);
  }
}

function carveRiver(grid: Grid, random: () => number): void {
  let centre = Math.floor(grid.size * (0.55 + random() * 0.3));

  for (let y = 0; y < grid.size; y++) {
    centre += Math.round(random() * 2 - 1);
    centre = Math.min(grid.size - 4, Math.max(3, centre));
    const width = 2 + Math.floor(random() * 2);

    for (let dx = -2; dx < width + 2; dx++) {
      const x = centre + dx;
      if (!grid.contains(x, y)) continue;
      const index = grid.index(x, y);

      if (dx >= 0 && dx < width) {
        grid.terrain[index] = TERRAIN_WATER;
        grid.height[index] = 0;
      } else {
        grid.height[index] = Math.min(grid.height[index], 1);
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
    const radius = minRadius + random() * (maxRadius - minRadius);

    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (!grid.contains(x, y)) continue;
        const distance = Math.hypot(x - cx, y - cy) + random() * 0.9;
        if (distance > radius) continue;

        const index = grid.index(x, y);
        if (grid.terrain[index] !== TERRAIN_GRASS || !accepts(index)) continue;
        grid.terrain[index] = terrain;
      }
    }
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
