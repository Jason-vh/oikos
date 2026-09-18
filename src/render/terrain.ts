import * as T from 'three';
import { colors, material } from '../art';
import { buildCoast } from '../art/coast';
import { buildCliffs } from '../art/cliffs';
import { carveStairs } from '../art/stairs';
import { GROUND_KINDS, blendedTiles, groundMix } from '../art/ground';
import type { Stair } from '../sim/stairs';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import type { Terrain } from '../sim/types';

const SURFACE: Record<Terrain, number> = {
  water: 0x559fa5,
  sand: 0xe8d8ad,
  grass: colors.grass,
  fertile: 0x9a9159,
  scrub: 0x9ea66c,
  forest: 0x8c9a62,
  rock: 0xb9ad8c,
  cliff: colors.stone,
};
const BLEND_STEPS = 4;

interface Batch { positions: number[]; normals: number[]; }
interface BlendBatch extends Batch { tints: number[]; }
interface Surfaces { batches: Map<number, Batch>; blend: BlendBatch; }

const surfaces = new WeakMap<IslandMap, Surfaces>();

const blendMaterial = new T.MeshStandardMaterial({ roughness: .88, vertexColors: true });
const kindColors = GROUND_KINDS.map((kind) => new T.Color(SURFACE[kind]));
const shares = new Float32Array(GROUND_KINDS.length);

function blendTriangle(batch: BlendBatch, points: number[][], paint: T.Color[]): void {
  for (const corner of [0, 3, 2, 0, 2, 1]) {
    batch.positions.push(points[corner][0], points[corner][1], points[corner][2]);
    batch.normals.push(0, 1, 0);
    batch.tints.push(paint[corner].r, paint[corner].g, paint[corner].b);
  }
}

function groundColor(map: IslandMap, x: number, z: number, level: number, home: Terrain): T.Color {
  if (!groundMix(map, x, z, level, shares)) return new T.Color(SURFACE[home]);
  const paint = new T.Color(0, 0, 0);
  for (let kind = 0; kind < shares.length; kind++) {
    if (shares[kind] === 0) continue;
    paint.r += kindColors[kind].r * shares[kind];
    paint.g += kindColors[kind].g * shares[kind];
    paint.b += kindColors[kind].b * shares[kind];
  }
  return paint;
}

function blendGround(map: IslandMap, x: number, z: number, batch: BlendBatch, top: number): void {
  const origin = worldPositionOn(map, x, z);
  const level = levelOn(map, x, z);
  const home = terrainOn(map, x, z);
  const corners: T.Color[] = [];
  for (let row = 0; row <= BLEND_STEPS; row++) {
    for (let column = 0; column <= BLEND_STEPS; column++) corners.push(groundColor(map, x + column / BLEND_STEPS, z + row / BLEND_STEPS, level, home));
  }
  const even = corners.every((paint) => paint.equals(corners[0]));
  if (even) {
    const x1 = origin.x + CELL_SIZE;
    const z1 = origin.z + CELL_SIZE;
    blendTriangle(batch, [[origin.x, top, origin.z], [x1, top, origin.z], [x1, top, z1], [origin.x, top, z1]], [corners[0], corners[0], corners[0], corners[0]]);
    return;
  }
  const step = CELL_SIZE / BLEND_STEPS;
  for (let row = 0; row < BLEND_STEPS; row++) {
    for (let column = 0; column < BLEND_STEPS; column++) {
      const x0 = origin.x + column * step;
      const x1 = x0 + step;
      const z0 = origin.z + row * step;
      const z1 = z0 + step;
      const at = (r: number, c: number) => corners[r * (BLEND_STEPS + 1) + c];
      blendTriangle(batch, [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], [at(row, column), at(row, column + 1), at(row + 1, column + 1), at(row + 1, column)]);
    }
  }
}

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

function surfacesOf(map: IslandMap): Surfaces {
  const known = surfaces.get(map);
  if (known) return known;
  const batches = new Map<number, Batch>();
  const blend: BlendBatch = { positions: [], normals: [], tints: [] };
  const mixed = blendedTiles(map);
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const terrain = terrainOn(map, x, z);
      if (terrain === 'water') continue;
      if (mixed[z * map.width + x]) {
        blendGround(map, x, z, blend, heightOf(map, x, z));
        continue;
      }
      const origin = worldPositionOn(map, x, z);
      const x0 = origin.x;
      const x1 = origin.x + CELL_SIZE;
      const z0 = origin.z;
      const z1 = origin.z + CELL_SIZE;
      const top = heightOf(map, x, z);
      quad(batchFor(batches, SURFACE[terrain]), [x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [0, 1, 0]);
    }
  }
  const built = { batches, blend };
  surfaces.set(map, built);
  return built;
}

export function buildTerrain(map: IslandMap, stairs: ReadonlyMap<number, Stair> = new Map()): T.Group {
  const { batches, blend } = surfacesOf(map);
  const root = new T.Group();
  root.add(buildCoast(map), buildCliffs(map));
  for (const [color, batch] of batches) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(batch.normals, 3));
    const surface = new T.Mesh(geometry, material(color));
    surface.castShadow = true;
    surface.receiveShadow = true;
    root.add(surface);
  }
  if (blend.positions.length > 0) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(blend.positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(blend.normals, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(blend.tints, 3));
    const surface = new T.Mesh(geometry, blendMaterial);
    surface.castShadow = true;
    surface.receiveShadow = true;
    root.add(surface);
  }
  carveStairs(root, map, stairs);
  return root;
}
