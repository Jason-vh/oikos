import * as T from 'three';
import { CELL_SIZE, groundHeight, hash, insideMapOn, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import { roadStepAllowed, stairLayout, type Stair } from '../sim/stairs';
import { bake, colors, material } from './primitives';
import { carvedStair } from './stairs';
type Point = [number, number];
type Batches = Map<number, number[]>;
interface RoadTile { x: number; z: number; }
const COURSE = .49;
const FLAG_LENGTH = .69;
const JOINT = .025;

function hasRoad(map: IslandMap, roads: ReadonlySet<number>, x: number, z: number): boolean {
  return insideMapOn(map, x, z) && roads.has(tileIndexOn(map, x, z));
}

function clip(polygon: Point[], start: Point, end: Point): Point[] {
  const result: Point[] = [];
  const distance = (point: Point) => (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const da = distance(a);
    const db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

function trim(polygon: Point[], boundary: Point[]): Point[] {
  let result = polygon;
  for (let i = 0; i < boundary.length && result.length > 0; i++) result = clip(result, boundary[i], boundary[(i + 1) % boundary.length]);
  return result;
}

function roadOutline(map: IslandMap, roads: ReadonlySet<number>, stairs: ReadonlyMap<number, Stair>, tile: RoadTile, inset: number): Point[] {
  const origin = worldPositionOn(map, tile.x, tile.z);
  const index = tileIndexOn(map, tile.x, tile.z);
  const connected = (dx: number, dz: number) => hasRoad(map, roads, tile.x + dx, tile.z + dz) && roadStepAllowed(map, stairs, index, tileIndexOn(map, tile.x + dx, tile.z + dz));
  const west = connected(-1, 0);
  const east = connected(1, 0);
  const north = connected(0, -1);
  const south = connected(0, 1);
  const left = origin.x + (west ? 0 : inset);
  const right = origin.x + CELL_SIZE - (east ? 0 : inset);
  const top = origin.z + (north ? 0 : inset);
  const bottom = origin.z + CELL_SIZE - (south ? 0 : inset);
  const nw = !west && !north ? .18 : 0;
  const ne = !east && !north ? .18 : 0;
  const se = !east && !south ? .18 : 0;
  const sw = !west && !south ? .18 : 0;
  const corners: Point[] = [[left + nw, top], [right - ne, top], [right, top + ne], [right, bottom - se], [right - se, bottom], [left + sw, bottom], [left, bottom - sw], [left, top + nw]];
  return corners.filter((point, i) => {
    const next = corners[(i + 1) % corners.length];
    return point[0] !== next[0] || point[1] !== next[1];
  });
}

function surface(batches: Batches, color: number, polygon: Point[], y: number): void {
  if (polygon.length < 3) return;
  const positions = batches.get(color) ?? [];
  const a = polygon[0];
  for (let i = 1; i < polygon.length - 1; i++) {
    const b = polygon[i];
    const c = polygon[i + 1];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area < 1e-10) continue;
    positions.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
  }
  if (positions.length) batches.set(color, positions);
}

function limestoneFlag(map: IslandMap, row: number, column: number): { polygon: Point[]; color: number } {
  const offset = (row % 2) * FLAG_LENGTH * .5;
  const left = column * FLAG_LENGTH + (hash(column, row, map.seed + 900) - .5) * .26 + offset + JOINT / 2;
  const right = (column + 1) * FLAG_LENGTH + (hash(column + 1, row, map.seed + 900) - .5) * .26 + offset - JOINT / 2;
  const top = row * COURSE + (hash(0, row, map.seed + 906) - .5) * .18 + JOINT / 2;
  const bottom = (row + 1) * COURSE + (hash(0, row + 1, map.seed + 906) - .5) * .18 - JOINT / 2;
  const cut = .055;
  const shoulder = hash(column, row, map.seed + 66) * .025;
  const polygon: Point[] = [
    [left + cut, top], [right - cut, top + .012], [right, top + cut], [right - shoulder, bottom - cut],
    [right - cut, bottom], [left + cut, bottom - .012], [left + shoulder, bottom - cut], [left, top + cut],
  ];
  const tone = hash(column, row, map.seed + 290);
  let color = colors.paving;
  if (tone < .14) color = colors.cream;
  else if (tone > .84) color = colors.stone;
  return { polygon, color };
}

function limestoneSurface(map: IslandMap, roads: ReadonlySet<number>, stairs: ReadonlyMap<number, Stair>, tile: RoadTile, batches: Batches): void {
  const y = groundHeight(map, tile.x, tile.z);
  surface(batches, colors.stone, roadOutline(map, roads, stairs, tile, .04), y + .02);
  const boundary = roadOutline(map, roads, stairs, tile, .07);
  if (boundary.length < 3) return;
  const origin = worldPositionOn(map, tile.x, tile.z);
  for (let row = Math.floor(origin.z / COURSE) - 1; row <= Math.ceil((origin.z + CELL_SIZE) / COURSE); row++) {
    for (let column = Math.floor(origin.x / FLAG_LENGTH) - 1; column <= Math.ceil((origin.x + CELL_SIZE) / FLAG_LENGTH); column++) {
      const flag = limestoneFlag(map, row, column);
      surface(batches, flag.color, trim(flag.polygon, boundary), y + .053);
    }
  }
}

export function buildRoads(map: IslandMap, indices: readonly number[]): T.Group {
  const roads = new Set(indices);
  const root = new T.Group();
  const flights = new T.Group();
  const stairs = stairLayout(map, roads);
  const batches: Batches = new Map();
  for (const index of [...roads].sort((a, b) => a - b)) {
    const stair = stairs.get(index);
    if (stair) carvedStair(map, stair, flights);
    else limestoneSurface(map, roads, stairs, tileAtOn(map, index), batches);
  }
  for (const [color, positions] of batches) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const model = new T.Mesh(geometry, material(color));
    model.receiveShadow = true;
    root.add(model);
  }
  if (flights.children.length) {
    bake(flights);
    for (const model of flights.children) model.userData.stairs = true;
    root.add(...flights.children.slice());
  }
  return root;
}
