import * as T from 'three';
import { GROUND_Y, LEVEL_HEIGHT, fractal, levelOn, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { colors, lump, material } from './primitives';

type Point = [number, number, number];
type Direction = [number, number];
type Profile = [Point, Point, Point, Point];
interface Edge { start: Direction; end: Direction; outward: Direction; }

const EDGES: Edge[] = [
  { start: [0, 0], end: [1, 0], outward: [0, -1] },
  { start: [1, 0], end: [1, 1], outward: [1, 0] },
  { start: [1, 1], end: [0, 1], outward: [0, 1] },
  { start: [0, 1], end: [0, 0], outward: [-1, 0] },
];

function cliffProfile(map: IslandMap, x: number, z: number, tier: number, edge: Edge, end: boolean): Profile {
  const corner = end ? edge.end : edge.start;
  const opposite = end ? edge.start : edge.end;
  const along: Direction = [opposite[0] - corner[0], opposite[1] - corner[1]];
  const [nx, nz] = edge.outward;
  const vx = x + corner[0];
  const vz = z + corner[1];
  const origin = worldPositionOn(map, vx, vz);
  const top = GROUND_Y + tier * LEVEL_HEIGHT;
  const bottom = top - LEVEL_HEIGHT;
  const coastal = [-1, 0].some((dx) => [-1, 0].some((dz) => terrainOn(map, vx + dx, vz + dz) === 'water'));
  const convex = levelOn(map, x - along[0], z - along[1]) < tier;
  const concave = !convex && levelOn(map, x - along[0] + nx, z - along[1] + nz) >= tier;
  const grain = fractal(vx, vz, map.seed + 947, 2, 2.6);
  const shelf = fractal(vx, vz, map.seed + 953, 2, 2);
  const drift = (fractal(vx, vz, map.seed + 971, 1, 1.6) - .5) * .4;
  function point(inset: number, cut: number, y: number): Point {
    if (coastal) return [origin.x, y, origin.z];
    let offset = 0;
    if (convex) offset = Math.max(cut, inset + .08);
    else if (concave) offset = -inset;
    const point: Point = [origin.x - nx * inset + along[0] * offset, y, origin.z - nz * inset + along[1] * offset];
    if (!convex && !concave) {
      point[0] += Math.abs(nz) * drift;
      point[2] += Math.abs(nx) * drift;
    }
    return point;
  }
  return [
    [origin.x, top, origin.z],
    point(.06 + grain * .3, .28 + grain * .28, top - .18 - grain * .4),
    point(.03 + shelf * .3, .2 + grain * .22, bottom + .22 + shelf * .65),
    [origin.x, bottom, origin.z],
  ];
}

function triangle(positions: number[], a: Point, b: Point, c: Point, outward: Direction): void {
  const ab = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = new T.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const normal = ab.cross(ac);
  if (normal.lengthSq() < 1e-12) return;
  if (normal.x * outward[0] + normal.z * outward[1] < 0) positions.push(...a, ...c, ...b);
  else positions.push(...a, ...b, ...c);
}

function face(positions: number[], a: Profile, b: Profile, outward: Direction): void {
  for (let band = 0; band < a.length - 1; band++) {
    triangle(positions, a[band], b[band], b[band + 1], outward);
    triangle(positions, a[band], b[band + 1], a[band + 1], outward);
  }
}

export function buildCliffs(map: IslandMap): T.Group {
  const positions: number[] = [];
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      if (terrainOn(map, x, z) === 'water') continue;
      for (let tier = 1; tier <= levelOn(map, x, z); tier++) {
        const profiles = EDGES.map((edge) => {
          const nx = x + edge.outward[0];
          const nz = z + edge.outward[1];
          if (terrainOn(map, nx, nz) === 'water' || levelOn(map, nx, nz) >= tier) return null;
          return { start: cliffProfile(map, x, z, tier, edge, false), end: cliffProfile(map, x, z, tier, edge, true) };
        });
        for (let side = 0; side < EDGES.length; side++) {
          const profile = profiles[side];
          if (!profile) continue;
          const edge = EDGES[side];
          face(positions, profile.start, profile.end, edge.outward);
          const nextSide = (side + 1) % EDGES.length;
          const next = profiles[nextSide];
          if (next) face(positions, profile.end, next.start, [edge.outward[0] + EDGES[nextSide].outward[0], edge.outward[1] + EDGES[nextSide].outward[1]]);
        }
      }
    }
  }
  const root = new T.Group();
  if (!positions.length) return root;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, material(colors.stone));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}

export function cliffOutcrop(): T.Group {
  const rock = new T.Group();
  const main = lump(rock, colors.stone, -.06, .18, .02, .39, .34, .31);
  main.rotation.set(.12, .3, -.18);
  const flank = lump(rock, colors.stone, .23, .09, .12, .25, .19, .23);
  flank.rotation.y = -.4;
  return rock;
}
