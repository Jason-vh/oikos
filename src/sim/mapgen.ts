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
