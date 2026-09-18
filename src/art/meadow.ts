import * as T from 'three';
import { CELL_SIZE, fractal, hash, levelOn, terrainOn, type IslandMap } from '../sim/island';
import { BUSH_RADIUS, bush } from './bushes';
import { groundShare } from './ground';
import { colors, lump } from './primitives';

const FLOWER_RADIUS = .07;
const FEWEST = 1;
const MOST = 4;
const MEADOW_REACH = 2;
const FLOWER_INSET = .12;
const BUSH_CHANCE = .07;

export function soilAt(map: IslandMap, x: number, z: number, level: number): number {
  return groundShare(map, x, z, level, 'fertile');
}

export function meadowHalo(map: IslandMap): Uint8Array {
  const halo = new Uint8Array(map.width * map.depth);
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      if (terrainOn(map, x, z) !== 'fertile') continue;
      const level = levelOn(map, x, z);
      for (let dz = -MEADOW_REACH; dz <= MEADOW_REACH; dz++) {
        for (let dx = -MEADOW_REACH; dx <= MEADOW_REACH; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
          if (levelOn(map, nx, nz) !== level) continue;
          halo[nz * map.width + nx] = 1;
        }
      }
    }
  }
  return halo;
}

function rooted(map: IslandMap, x: number, z: number, level: number, inset = FLOWER_INSET): boolean {
  if (soilAt(map, x, z, level) < 1) return false;
  for (const [dx, dz] of [[inset, 0], [-inset, 0], [0, inset], [0, -inset]]) {
    if (soilAt(map, x + dx, z + dz, level) < 1) return false;
  }
  return true;
}

function meadowBush(map: IslandMap, x: number, z: number, level: number): T.Group | null {
  if (hash(x, z, map.seed + 1511) >= BUSH_CHANCE) return null;
  const scale = .48 + hash(x, z, map.seed + 1523) * .22;
  const margin = CELL_SIZE / 2 - BUSH_RADIUS * scale - .04;
  const offsetX = (hash(x, z, map.seed + 1531) * 2 - 1) * margin;
  const offsetZ = (hash(x, z, map.seed + 1543) * 2 - 1) * margin;
  if (!rooted(map, x + .5 + offsetX / CELL_SIZE, z + .5 + offsetZ / CELL_SIZE, level, BUSH_RADIUS * scale / CELL_SIZE)) return null;
  const plant = bush(hash(x, z, map.seed + 1553) > .5 ? 'cushion' : 'paired', hash(x, z, map.seed + 1559) > .78);
  plant.position.set(offsetX, 0, offsetZ);
  plant.rotation.y = hash(x, z, map.seed + 1567) * Math.PI * 2;
  plant.scale.set(scale, scale * (.85 + hash(x, z, map.seed + 1571) * .3), scale);
  return plant;
}

export function wildflower(accent = false): T.Group {
  const plant = new T.Group();
  lump(plant, accent ? colors.bloomLight : colors.bloom, 0, .04, 0, FLOWER_RADIUS, .05, FLOWER_RADIUS);
  return plant;
}

export function meadowForTile(map: IslandMap, x: number, z: number): T.Group | null {
  const terrain = terrainOn(map, x, z);
  if (terrain !== 'fertile' && terrain !== 'grass') return null;
  const level = levelOn(map, x, z);
  if (soilAt(map, x + .5, z + .5, level) === 0 && terrain !== 'fertile') return null;
  const patch = fractal(x, z, map.seed + 1481, 2, 4.5);
  const depth = Math.max(0, Math.min(1, (patch - .28) * 1.9));
  const spread = (depth * .7 + hash(x, z, map.seed + 1493) * .3) * (MOST - FEWEST);
  const count = FEWEST + Math.round(spread);
  const root = new T.Group();
  for (let index = 0; index < count; index++) {
    const salt = map.seed + 1487 + index * 131;
    const scale = .55 + hash(x, z, salt) * .75;
    const margin = CELL_SIZE / 2 - FLOWER_RADIUS * scale - .02;
    const offsetX = (hash(x, z, salt + 2) * 2 - 1) * margin;
    const offsetZ = (hash(x, z, salt + 3) * 2 - 1) * margin;
    if (!rooted(map, x + .5 + offsetX / CELL_SIZE, z + .5 + offsetZ / CELL_SIZE, level)) continue;
    const flower = wildflower(hash(x, z, salt + 1) > .74);
    flower.position.set(offsetX, 0, offsetZ);
    flower.rotation.y = hash(x, z, salt + 4) * Math.PI * 2;
    flower.scale.set(scale, scale * (.7 + hash(x, z, salt + 5) * .6), scale);
    root.add(flower);
  }
  const shrub = meadowBush(map, x, z, level);
  if (shrub) root.add(shrub);
  if (root.children.length === 0) return null;
  return root;
}
