import type { Terrain, Tile } from './types';

export const CELL_SIZE = 1.25;
export const GROUND_Y = 1.15;
export const LEVEL_HEIGHT = 1.6;

export interface IslandMap {
  seed: number;
  width: number;
  depth: number;
  terrain: Terrain[];
  level: Uint8Array;
  entry: Tile;
}

export const ISLAND_WIDTH = 72;
export const ISLAND_DEPTH = 56;

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash(x0, z0, seed);
  const b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed);
  const d = hash(x0 + 1, z0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

export function fractal(x: number, z: number, seed: number, octaves = 4, scale = 12): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x / scale * 2 ** i, z / scale * 2 ** i, seed + i * 101) * amplitude;
    total += amplitude;
    amplitude *= .5;
  }
  return sum / total;
}

function floodLargest(width: number, depth: number, land: boolean[]): boolean[] {
  const seen = new Array<number>(width * depth).fill(0);
  let best: number[] = [];
  let label = 0;
  for (let start = 0; start < land.length; start++) {
    if (!land[start] || seen[start]) continue;
    label++;
    const region: number[] = [];
    const stack = [start];
    seen[start] = label;
    while (stack.length) {
      const index = stack.pop()!;
      region.push(index);
      const x = index % width;
      const z = Math.floor(index / width);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
        const next = nz * width + nx;
        if (land[next] && !seen[next]) {
          seen[next] = label;
          stack.push(next);
        }
      }
    }
    if (region.length > best.length) best = region;
  }
  const result = new Array<boolean>(land.length).fill(false);
  for (const index of best) result[index] = true;
  return result;
}

function neighbourCount(width: number, depth: number, test: (index: number) => boolean, x: number, z: number, radius = 1): number {
  let count = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
      if (test(nz * width + nx)) count++;
    }
  }
  return count;
}

export function generateIsland(seed: number, width = ISLAND_WIDTH, depth = ISLAND_DEPTH): IslandMap {
  const random = mulberry(seed);
  const shapeSeed = Math.floor(random() * 1e9);
  const reliefSeed = Math.floor(random() * 1e9);
  const soilSeed = Math.floor(random() * 1e9);
  const woodSeed = Math.floor(random() * 1e9);
  const count = width * depth;
  const height = new Float32Array(count);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + .5) / width * 2 - 1;
      const nz = (z + .5) / depth * 2 - 1;
      const radial = 1 - Math.sqrt(nx * nx * .85 + nz * nz * 1.0);
      const noise = fractal(x, z, shapeSeed, 4, 20) - .5;
      height[z * width + x] = radial + noise * .7;
    }
  }
  let land = Array.from(height, (value) => value > .18);
  land = floodLargest(width, depth, land);
  const terrain: Terrain[] = new Array(count).fill('water');
  const level = new Uint8Array(count);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      if (!land[index]) continue;
      const relief = fractal(x, z, reliefSeed, 3, 14);
      const inland = Math.min(1, (height[index] - .18) / .5);
      const upland = relief * .55 + inland * .55;
      level[index] = upland > .82 ? 2 : upland > .64 ? 1 : 0;
      terrain[index] = 'grass';
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(level);
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const index = z * width + x;
        if (!land[index]) continue;
        for (const value of [1, 2]) {
          const same = neighbourCount(width, depth, (i) => land[i] && level[i] >= value, x, z);
          if (level[index] >= value && same < 5) next[index] = value - 1;
          if (level[index] < value && same >= 8) next[index] = value;
        }
      }
    }
    level.set(next);
  }
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      if (!land[index]) continue;
      const coast = neighbourCount(width, depth, (i) => !land[i], x, z) > 0;
      const soil = fractal(x, z, soilSeed, 3, 10);
      const wood = fractal(x, z, woodSeed, 3, 9);
      const steep = level[index] > 0 && neighbourCount(width, depth, (i) => land[i] && level[i] < level[index], x, z) > 0;
      if (steep) terrain[index] = 'cliff';
      else if (coast && level[index] === 0) terrain[index] = soil > .6 ? 'rock' : 'sand';
      else if (level[index] === 2) terrain[index] = wood > .62 ? 'rock' : wood > .42 ? 'forest' : 'scrub';
      else if (wood > .66) terrain[index] = 'forest';
      else if (wood > .58) terrain[index] = 'scrub';
      else if (level[index] === 0 && soil > .6) terrain[index] = 'fertile';
      else if (level[index] === 1 && soil > .72) terrain[index] = 'rock';
    }
  }
  const entry = chooseEntry(width, depth, terrain, level);
  clearAround(width, depth, terrain, level, entry, 5);
  return { seed, width, depth, terrain, level, entry };
}

function chooseEntry(width: number, depth: number, terrain: Terrain[], level: Uint8Array): Tile {
  let best: Tile = { x: Math.floor(width / 2), z: Math.floor(depth / 2) };
  let bestScore = -Infinity;
  for (let x = 4; x < width - 4; x++) {
    for (let z = Math.floor(depth * .55); z < depth; z++) {
      const index = z * width + x;
      if (terrain[index] === 'water' || level[index] !== 0) continue;
      const seaBelow = [1, 2, 3, 4].every((d) => z + d >= depth || terrain[(z + d) * width + x] === 'water');
      if (!seaBelow) continue;
      const flat = neighbourCount(width, depth, (i) => terrain[i] !== 'water' && terrain[i] !== 'cliff' && level[i] === 0, x, z - 6, 6);
      const seaFlank = neighbourCount(width, depth, (i) => terrain[i] === 'water', x, z + 3, 3);
      const score = flat + seaFlank * .5 - Math.abs(x - width / 2) * .3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}

function clearAround(width: number, depth: number, terrain: Terrain[], level: Uint8Array, entry: Tile, radius: number): void {
  for (let dz = -radius * 2; dz <= 0; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = entry.x + dx;
      const z = entry.z + dz;
      if (x < 0 || z < 0 || x >= width || z >= depth) continue;
      const index = z * width + x;
      if (terrain[index] === 'water') continue;
      level[index] = 0;
      const wantsFields = dx > 1 && dz < -3;
      if (terrain[index] !== 'sand') terrain[index] = wantsFields ? 'fertile' : 'grass';
    }
  }
}

export function tileIndexOn(map: IslandMap, x: number, z: number): number { return z * map.width + x; }
export function tileAtOn(map: IslandMap, index: number): Tile { return { x: index % map.width, z: Math.floor(index / map.width) }; }
export function insideMapOn(map: IslandMap, x: number, z: number): boolean {
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < map.width && z < map.depth;
}
export function terrainOn(map: IslandMap, x: number, z: number): Terrain {
  if (!insideMapOn(map, x, z)) return 'water';
  return map.terrain[z * map.width + x];
}
export function levelOn(map: IslandMap, x: number, z: number): number {
  if (!insideMapOn(map, x, z)) return 0;
  return map.level[z * map.width + x];
}
export function buildable(terrain: Terrain): boolean {
  return terrain === 'grass' || terrain === 'fertile' || terrain === 'sand' || terrain === 'scrub';
}
export function worldPositionOn(map: IslandMap, x: number, z: number): { x: number; z: number } {
  return { x: (x - map.width / 2) * CELL_SIZE, z: (z - map.depth / 2) * CELL_SIZE };
}
export function groundHeight(map: IslandMap, x: number, z: number): number {
  return GROUND_Y + levelOn(map, x, z) * LEVEL_HEIGHT;
}

const maps = new Map<number, IslandMap>();
export function islandFor(seed: number): IslandMap {
  let map = maps.get(seed);
  if (!map) {
    map = generateIsland(seed);
    maps.set(seed, map);
  }
  return map;
}
