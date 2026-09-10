import * as T from 'three';
import { colors, material } from '../art';
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
const SEA_FLOOR = -.55;
const SHELF = -.06;

interface Batch { positions: number[]; normals: number[]; }

function batchFor(batches: Map<number, Batch>, color: number): Batch {
  let batch = batches.get(color);
  if (!batch) {
    batch = { positions: [], normals: [] };
    batches.set(color, batch);
  }
  return batch;
}

function quad(batch: Batch, a: number[], b: number[], c: number[], d: number[]): void {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const normal = [n[0] / length, n[1] / length, n[2] / length];
  for (const point of [a, b, c, a, c, d]) {
    batch.positions.push(point[0], point[1], point[2]);
    batch.normals.push(normal[0], normal[1], normal[2]);
  }
}

function heightOf(map: IslandMap, x: number, z: number): number {
  if (terrainOn(map, x, z) === 'water') return SHELF;
  return GROUND_Y + levelOn(map, x, z) * LEVEL_HEIGHT;
}

function cornerHeight(map: IslandMap, x: number, z: number, cx: number, cz: number): number {
  const own = heightOf(map, x, z);
  if (terrainOn(map, x, z) === 'water') return SHELF;
  const dx = cx === 0 ? -1 : 1;
  const dz = cz === 0 ? -1 : 1;
  const seaAround = [[dx, 0], [0, dz], [dx, dz]].filter(([ox, oz]) => terrainOn(map, x + ox, z + oz) === 'water').length;
  return own - seaAround * .09;
}

export function buildTerrain(map: IslandMap): T.Group {
  const batches = new Map<number, Batch>();
  const root = new T.Group();
  for (let z = -1; z <= map.depth; z++) {
    for (let x = -1; x <= map.width; x++) {
      const terrain = terrainOn(map, x, z);
      const origin = worldPositionOn(map, x, z);
      const x0 = origin.x;
      const x1 = origin.x + CELL_SIZE;
      const z0 = origin.z;
      const z1 = origin.z + CELL_SIZE;
      if (terrain === 'water') {
        const neighbourLand = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dz]) => terrainOn(map, x + dx, z + dz) !== 'water');
        if (neighbourLand) quad(batchFor(batches, 0x8fc4b8), [x0, SHELF, z0], [x1, SHELF, z0], [x1, SHELF, z1], [x0, SHELF, z1]);
        continue;
      }
      const top = heightOf(map, x, z);
      const h00 = cornerHeight(map, x, z, 0, 0);
      const h10 = cornerHeight(map, x, z, 1, 0);
      const h11 = cornerHeight(map, x, z, 1, 1);
      const h01 = cornerHeight(map, x, z, 0, 1);
      quad(batchFor(batches, SURFACE[terrain]), [x0, h00, z0], [x1, h10, z0], [x1, h11, z1], [x0, h01, z1]);
      const sides: [number, number, number[], number[]][] = [
        [1, 0, [x1, h10, z0], [x1, h11, z1]],
        [-1, 0, [x0, h01, z1], [x0, h00, z0]],
        [0, 1, [x1, h11, z1], [x0, h01, z1]],
        [0, -1, [x0, h00, z0], [x1, h10, z0]],
      ];
      for (const [dx, dz, a, b] of sides) {
        const neighbourHeight = heightOf(map, x + dx, z + dz);
        const neighbourTerrain = terrainOn(map, x + dx, z + dz);
        const bottom = neighbourTerrain === 'water' ? SEA_FLOOR : neighbourHeight;
        if (bottom >= Math.min(a[1], b[1])) continue;
        const wallColor = neighbourTerrain === 'water' ? colors.stone : colors.earth;
        const batch = batchFor(batches, wallColor);
        quad(batch, a, b, [b[0], bottom, b[2]], [a[0], bottom, a[2]]);
        if (top - bottom > LEVEL_HEIGHT * .9) {
          const ledge = bottom + (top - bottom) * .45;
          const outward = [dx * .1, 0, dz * .1];
          quad(batchFor(batches, colors.stone), [a[0] + outward[0], ledge + .08, a[2] + outward[2]], [b[0] + outward[0], ledge + .08, b[2] + outward[2]], [b[0] + outward[0], ledge - .12, b[2] + outward[2]], [a[0] + outward[0], ledge - .12, a[2] + outward[2]]);
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
