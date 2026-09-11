import * as T from 'three';
import { colors, material } from '../art';
import { buildCoast } from '../art/coast';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { Terrain } from '../sim/types';

const SURFACE: Record<Terrain, number> = {
  water: 0x559fa5,
  sand: 0xe8d8ad,
  grass: colors.grass,
  fertile: 0xb6b278,
  scrub: 0x9ea66c,
  forest: 0x8c9a62,
  rock: 0xb9ad8c,
  cliff: colors.stone,
};
interface Batch { positions: number[]; normals: number[]; }

function batchFor(batches: Map<number, Batch>, color: number): Batch {
  let batch = batches.get(color);
  if (!batch) {
    batch = { positions: [], normals: [] };
    batches.set(color, batch);
  }
  return batch;
}

function quad(batch: Batch, a: number[], b: number[], c: number[], d: number[], facing: number[]): void {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  let normal = [n[0] / length, n[1] / length, n[2] / length];
  let order = [a, b, c, a, c, d];
  if (normal[0] * facing[0] + normal[1] * facing[1] + normal[2] * facing[2] < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
    order = [a, d, c, a, c, b];
  }
  for (const point of order) {
    batch.positions.push(point[0], point[1], point[2]);
    batch.normals.push(normal[0], normal[1], normal[2]);
  }
}

function heightOf(map: IslandMap, x: number, z: number): number {
  return GROUND_Y + levelOn(map, x, z) * LEVEL_HEIGHT;
}

export function buildTerrain(map: IslandMap): T.Group {
  const batches = new Map<number, Batch>();
  const root = new T.Group();
  root.add(buildCoast(map));
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const terrain = terrainOn(map, x, z);
      if (terrain === 'water') continue;
      const origin = worldPositionOn(map, x, z);
      const x0 = origin.x;
      const x1 = origin.x + CELL_SIZE;
      const z0 = origin.z;
      const z1 = origin.z + CELL_SIZE;
      const top = heightOf(map, x, z);
      quad(batchFor(batches, SURFACE[terrain]), [x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [0, 1, 0]);
      const sides: [number, number, number[], number[]][] = [
        [1, 0, [x1, top, z0], [x1, top, z1]],
        [-1, 0, [x0, top, z1], [x0, top, z0]],
        [0, 1, [x1, top, z1], [x0, top, z1]],
        [0, -1, [x0, top, z0], [x1, top, z0]],
      ];
      for (const [dx, dz, a, b] of sides) {
        if (terrainOn(map, x + dx, z + dz) === 'water') continue;
        const bottom = heightOf(map, x + dx, z + dz);
        if (bottom >= top) continue;
        const batch = batchFor(batches, colors.earth);
        quad(batch, a, b, [b[0], bottom, b[2]], [a[0], bottom, a[2]], [dx, 0, dz]);
        if (top - bottom > LEVEL_HEIGHT * .9) {
          const ledge = bottom + (top - bottom) * .45;
          const outward = [dx * .1, 0, dz * .1];
          quad(batchFor(batches, colors.stone), [a[0] + outward[0], ledge + .08, a[2] + outward[2]], [b[0] + outward[0], ledge + .08, b[2] + outward[2]], [b[0] + outward[0], ledge - .12, b[2] + outward[2]], [a[0] + outward[0], ledge - .12, a[2] + outward[2]], [dx, 0, dz]);
        }
      }
    }
  }
  for (const [color, batch] of batches) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(batch.normals, 3));
    const surface = new T.Mesh(geometry, material(color));
    surface.castShadow = true;
    surface.receiveShadow = true;
    root.add(surface);
  }
  return root;
}
