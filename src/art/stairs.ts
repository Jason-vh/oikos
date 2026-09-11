import * as T from 'three';
import { CELL_SIZE, LEVEL_HEIGHT, groundHeight, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import { STAIR_STEPS, type Stair } from '../sim/stairs';
import { box, colors, group, mesh } from './primitives';

export const STAIR_WIDTH = CELL_SIZE - .24;
type Point = [number, number, number];
type Polygon = Point[];
interface Plane { axis: 0 | 1 | 2; at: number; sign: number; }

export function carvedStair(map: IslandMap, stair: Stair, parent: T.Group): void {
  const tile = tileAtOn(map, stair.tile);
  const centre = worldPositionOn(map, tile.x + .5, tile.z + .5);
  const floor = groundHeight(map, tile.x, tile.z) - LEVEL_HEIGHT;
  const root = group(parent, centre.x - stair.dx * CELL_SIZE / 2, floor, centre.z - stair.dz * CELL_SIZE / 2, Math.atan2(stair.dx, stair.dz));
  for (let step = 0; step < STAIR_STEPS; step++) {
    const start = step / STAIR_STEPS * CELL_SIZE;
    const end = Math.min(CELL_SIZE, (step + 1) / STAIR_STEPS * CELL_SIZE + .012);
    const rise = (step + 1) / STAIR_STEPS * LEVEL_HEIGHT;
    box(root, colors.paving, 0, rise / 2 + .015, (start + end) / 2, STAIR_WIDTH + .04, rise, end - start, .012);
  }
  for (const side of [-1, 1]) {
    const x = side * STAIR_WIDTH / 2;
    const corners: Point[] = [[x, 0, 0], [x, LEVEL_HEIGHT, 0], [x, LEVEL_HEIGHT, CELL_SIZE], [x, 0, CELL_SIZE]];
    if (side > 0) corners.reverse();
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([...corners[0], ...corners[1], ...corners[2], ...corners[0], ...corners[2], ...corners[3]], 3));
    geometry.computeVertexNormals();
    mesh(root, geometry, colors.stone, 0, 0, 0);
  }
}

function clip(polygon: Polygon, plane: Plane, inside: boolean): Polygon {
  const result: Polygon = [];
  const direction = inside ? plane.sign : -plane.sign;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const da = (a[plane.axis] - plane.at) * direction;
    const db = (b[plane.axis] - plane.at) * direction;
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return result;
}

function outside(polygon: Polygon, planes: Plane[]): Polygon[] {
  if (planes.some((plane) => polygon.every((point) => (point[plane.axis] - plane.at) * plane.sign <= 0))) return [polygon];
  const pieces: Polygon[] = [];
  let remainder = polygon;
  for (const plane of planes) {
    const piece = clip(remainder, plane, false);
    if (piece.length >= 3) pieces.push(piece);
    remainder = clip(remainder, plane, true);
    if (remainder.length < 3) break;
  }
  return pieces;
}

export function carveStairs(terrain: T.Group, map: IslandMap, stairs: ReadonlyMap<number, Stair>): void {
  if (stairs.size === 0) return;
  const cuts = [...stairs.values()].sort((a, b) => a.tile - b.tile).map((stair): Plane[] => {
    const tile = tileAtOn(map, stair.tile);
    const origin = worldPositionOn(map, tile.x, tile.z);
    const xInset = stair.dx === 0 ? (CELL_SIZE - STAIR_WIDTH) / 2 : 0;
    const zInset = stair.dz === 0 ? (CELL_SIZE - STAIR_WIDTH) / 2 : 0;
    return [
      { axis: 0, at: origin.x + xInset, sign: 1 }, { axis: 0, at: origin.x + CELL_SIZE - xInset, sign: -1 },
      { axis: 2, at: origin.z + zInset, sign: 1 }, { axis: 2, at: origin.z + CELL_SIZE - zInset, sign: -1 },
      { axis: 1, at: groundHeight(map, tile.x, tile.z) - LEVEL_HEIGHT, sign: 1 },
    ];
  });
  terrain.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    const source = child.geometry;
    const positions = source.attributes.position;
    const normals = source.attributes.normal;
    const vertices: number[] = [];
    const facing: number[] = [];
    for (let i = 0; i < positions.count; i += 3) {
      let polygons: Polygon[] = [[0, 1, 2].map((offset): Point => [positions.getX(i + offset), positions.getY(i + offset), positions.getZ(i + offset)])];
      for (const cut of cuts) polygons = polygons.flatMap((polygon) => outside(polygon, cut));
      for (const polygon of polygons) {
        for (let j = 1; j < polygon.length - 1; j++) {
          const a = new T.Vector3(...polygon[j]).sub(new T.Vector3(...polygon[0]));
          const b = new T.Vector3(...polygon[j + 1]).sub(new T.Vector3(...polygon[0]));
          if (a.cross(b).lengthSq() < 1e-16) continue;
          vertices.push(...polygon[0], ...polygon[j], ...polygon[j + 1]);
          for (let corner = 0; corner < 3; corner++) facing.push(normals.getX(i), normals.getY(i), normals.getZ(i));
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(facing, 3));
    child.geometry = geometry;
    source.dispose();
  });
}
