import { fractal, levelOn, terrainOn, type IslandMap } from '../sim/island';
import type { Terrain } from '../sim/types';

export const GROUND_KINDS: Terrain[] = ['sand', 'grass', 'fertile', 'scrub', 'forest', 'rock', 'cliff'];

const BLEND_REACH = 2;
const BLEND_EDGE = .5;
const BLEND_BAND = .2;
const WARP = 1.1;
const WARP_SCALE = 2.6;
const FRAY = .7;
const FRAY_SCALE = 1.3;
const RAG = .34;
const RAG_SCALE = .55;
const WANDER = .5;

const kindIndex = new Map(GROUND_KINDS.map((kind, index) => [kind, index]));
const scratch = new Float32Array(GROUND_KINDS.length);

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function wander(map: IslandMap, x: number, z: number, broad: number, fine: number, ragged: number): number {
  const drift = (fractal(x, z, map.seed + broad, 2, WARP_SCALE) - .5) * WARP
    + (fractal(x, z, map.seed + fine, 1, FRAY_SCALE) - .5) * FRAY
    + (fractal(x, z, map.seed + ragged, 1, RAG_SCALE) - .5) * RAG;
  return Math.max(-WANDER, Math.min(WANDER, drift));
}

function kindAt(map: IslandMap, x: number, z: number, level: number): number {
  if (x < 0 || z < 0 || x >= map.width || z >= map.depth) return -1;
  if (levelOn(map, x, z) !== level) return -1;
  return kindIndex.get(terrainOn(map, x, z)) ?? -1;
}

export function groundMix(map: IslandMap, x: number, z: number, level: number, shares: Float32Array): boolean {
  shares.fill(0);
  const warpX = x + wander(map, x, z, 2203, 2221, 2251);
  const warpZ = z + wander(map, x, z, 2213, 2237, 2267);
  const west = Math.floor(warpX - .5);
  const north = Math.floor(warpZ - .5);
  const alongX = ease(warpX - .5 - west);
  const alongZ = ease(warpZ - .5 - north);
  const weights = [(1 - alongX) * (1 - alongZ), alongX * (1 - alongZ), (1 - alongX) * alongZ, alongX * alongZ];
  const kinds = [kindAt(map, west, north, level), kindAt(map, west + 1, north, level), kindAt(map, west, north + 1, level), kindAt(map, west + 1, north + 1, level)];
  for (let index = 0; index < 4; index++) {
    if (kinds[index] >= 0) shares[kinds[index]] += weights[index];
  }
  let total = 0;
  for (let kind = 0; kind < shares.length; kind++) {
    const sharpened = shares[kind] === 0 ? 0 : ease(Math.max(0, Math.min(1, (shares[kind] - BLEND_EDGE + BLEND_BAND) / (BLEND_BAND * 2))));
    shares[kind] = sharpened;
    total += sharpened;
  }
  if (total === 0) return false;
  for (let kind = 0; kind < shares.length; kind++) shares[kind] /= total;
  return true;
}

export function groundShare(map: IslandMap, x: number, z: number, level: number, kind: Terrain): number {
  if (!groundMix(map, x, z, level, scratch)) return 0;
  return scratch[kindIndex.get(kind) ?? 0];
}

export function blendedTiles(map: IslandMap): Uint8Array {
  const blended = new Uint8Array(map.width * map.depth);
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const terrain = terrainOn(map, x, z);
      if (terrain === 'water') continue;
      const level = levelOn(map, x, z);
      for (let dz = -BLEND_REACH; dz <= BLEND_REACH && !blended[z * map.width + x]; dz++) {
        for (let dx = -BLEND_REACH; dx <= BLEND_REACH; dx++) {
          const near = kindAt(map, x + dx, z + dz, level);
          if (near < 0 || GROUND_KINDS[near] === terrain) continue;
          blended[z * map.width + x] = 1;
          break;
        }
      }
    }
  }
  return blended;
}
