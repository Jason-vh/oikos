import * as T from 'three';
import { GROUND_Y, LEVEL_HEIGHT, fractal, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { colors, material } from './primitives';

type Point = [number, number, number];
type Direction = [number, number];
interface Edge { start: Direction; end: Direction; outward: Direction; }
interface Profile { rim: Point; shoulder: Point; foot: Point; shallows: Point; }
export interface CoastalSegment { start: Profile; end: Profile; outward: Direction; }

const WATERLINE = -.06;
const EDGES: Edge[] = [
  { start: [0, 0], end: [1, 0], outward: [0, -1] },
  { start: [1, 0], end: [1, 1], outward: [1, 0] },
  { start: [1, 1], end: [0, 1], outward: [0, 1] },
  { start: [0, 1], end: [0, 0], outward: [-1, 0] },
];

function coastalProfile(map: IslandMap, x: number, z: number, edge: Edge, end: boolean): Profile {
  const corner = end ? edge.end : edge.start;
  const opposite = end ? edge.start : edge.end;
  const inward: Direction = [opposite[0] - corner[0], opposite[1] - corner[1]];
  const [nx, nz] = edge.outward;
  const vx = x + corner[0];
  const vz = z + corner[1];
  const origin = worldPositionOn(map, vx, vz);
  const otherX = x - inward[0];
  const otherZ = z - inward[1];
  const convex = terrainOn(map, otherX, otherZ) === 'water';
  const concave = !convex && terrainOn(map, otherX + nx, otherZ + nz) !== 'water';
  const variation = fractal(vx, vz, map.seed + 719, 2, 5);
  const height = GROUND_Y + levelOn(map, x, z) * LEVEL_HEIGHT;
  let lowest = height;
  for (const dx of [-1, 0]) {
    for (const dz of [-1, 0]) {
      if (terrainOn(map, vx + dx, vz + dz) === 'water') continue;
      lowest = Math.min(lowest, GROUND_Y + levelOn(map, vx + dx, vz + dz) * LEVEL_HEIGHT);
    }
  }
  function point(spread: number, cut: number, y: number): Point {
    let along = 0;
    if (convex) along = cut;
    else if (concave) along = spread;
    return [origin.x + nx * spread + inward[0] * along, y, origin.z + nz * spread + inward[1] * along];
  }
  const footSpread = .1 + variation * .06;
  const shelfWidth = .28 + variation * .12;
  const footCut = .32 + variation * .12;
  return {
    rim: [origin.x, height, origin.z],
    shoulder: point(-.06 - variation * .04, .2 + variation * .12, lowest - .2 - variation * .14),
    foot: point(footSpread, footCut, WATERLINE),
    shallows: point(footSpread + shelfWidth, footCut + shelfWidth * .4, WATERLINE),
  };
}

function triangle(positions: number[], a: Point, b: Point, c: Point, facing: Point): void {
  const ab = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new T.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const normal = ab.cross(ac);
  if (normal.lengthSq() < 1e-12) return;
  if (normal.x * facing[0] + normal.y * facing[1] + normal.z * facing[2] < 0) positions.push(...a, ...c, ...b);
  else positions.push(...a, ...b, ...c);
}

function quad(positions: number[], a: Point, b: Point, c: Point, d: Point, facing: Point): void {
  triangle(positions, a, b, c, facing);
  triangle(positions, a, c, d, facing);
}

export function coastalSegments(map: IslandMap): CoastalSegment[] {
  const segments: CoastalSegment[] = [];
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      if (terrainOn(map, x, z) === 'water') continue;
      const profiles = EDGES.map((edge) => {
        if (terrainOn(map, x + edge.outward[0], z + edge.outward[1]) !== 'water') return null;
        return { start: coastalProfile(map, x, z, edge, false), end: coastalProfile(map, x, z, edge, true) };
      });
      for (let side = 0; side < EDGES.length; side++) {
        const profile = profiles[side];
        if (!profile) continue;
        const edge = EDGES[side];
        segments.push({ ...profile, outward: edge.outward });
        const nextSide = (side + 1) % EDGES.length;
        const next = profiles[nextSide];
        if (next) segments.push({ start: profile.end, end: next.start, outward: [edge.outward[0] + EDGES[nextSide].outward[0], edge.outward[1] + EDGES[nextSide].outward[1]] });
      }
    }
  }
  return segments;
}

export function buildCoast(map: IslandMap): T.Group {
  const stone: number[] = [];
  const shallows: number[] = [];
  for (const { start: a, end: b, outward } of coastalSegments(map)) {
    const facing: Point = [outward[0], 0, outward[1]];
    quad(stone, a.rim, b.rim, b.shoulder, a.shoulder, facing);
    quad(stone, a.shoulder, b.shoulder, b.foot, a.foot, facing);
    quad(shallows, a.foot, b.foot, b.shallows, a.shallows, [0, 1, 0]);
  }
  const root = new T.Group();
  for (const [positions, color] of [[stone, colors.stone], [shallows, 0x8fc4b8]] as const) {
    if (positions.length === 0) continue;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material(color));
    mesh.castShadow = color === colors.stone;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}
