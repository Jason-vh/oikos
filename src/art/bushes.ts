import * as T from 'three';
import { CELL_SIZE, fractal, hash, terrainOn, type IslandMap } from '../sim/island';
import { colors, lump } from './primitives';

export const BUSH_SHAPES = ['cushion', 'upright', 'paired'] as const;
export type BushShape = typeof BUSH_SHAPES[number];
const BUSH_RADIUS = .5;

export function bush(shape: BushShape, sunlit = false): T.Group {
  const plant = new T.Group();
  const accent = sunlit ? colors.oliveLight : colors.oliveDark;
  if (shape === 'upright') {
    const crown = lump(plant, colors.olive, -.08, .29, .04, .27, .44, .25);
    crown.rotation.z = -.17;
    lump(plant, accent, .17, .13, .02, .2, .22, .2);
  } else if (shape === 'paired') {
    lump(plant, colors.olive, -.17, .22, -.05, .29, .31, .28);
    lump(plant, accent, .2, .12, .13, .21, .2, .19);
  } else {
    lump(plant, colors.olive, -.11, .18, 0, .34, .26, .29);
    lump(plant, accent, .21, .13, .08, .22, .19, .2);
  }
  return plant;
}

export function bushForTile(map: IslandMap, x: number, z: number): T.Group | null {
  const terrain = terrainOn(map, x, z);
  if (terrain !== 'scrub' && terrain !== 'cliff') return null;
  const patch = fractal(x, z, map.seed + 1013, 2, 4.5);
  let density = Math.max(0, Math.min(.88, (patch - .32) * 2));
  let scale = .65 + hash(x, z, map.seed + 1021) * .33;
  let shape = BUSH_SHAPES[Math.floor(hash(x, z, map.seed + 1031) * BUSH_SHAPES.length)];
  if (terrain === 'cliff') {
    density *= .28;
    scale *= .6;
    shape = 'cushion';
  }
  if (hash(x, z, map.seed + 1019) >= density) return null;
  const root = new T.Group();
  const plant = bush(shape, hash(x, z, map.seed + 1033) > .85);
  const margin = CELL_SIZE / 2 - BUSH_RADIUS * scale - .04;
  plant.position.set((hash(x, z, map.seed + 1039) * 2 - 1) * margin, 0, (hash(x, z, map.seed + 1049) * 2 - 1) * margin);
  plant.rotation.y = hash(x, z, map.seed + 1051) * Math.PI * 2;
  plant.scale.set(scale * (.88 + hash(x, z, map.seed + 1061) * .12), scale * (.85 + hash(x, z, map.seed + 1063) * .3), scale);
  root.add(plant);
  return root;
}
