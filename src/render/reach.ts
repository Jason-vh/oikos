import * as T from 'three';
import { colors } from '../art';
import { CELL_SIZE, groundHeight, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';

const BAND = .11;
const INSET = .3;
const LIFT = .1;
const HALF = CELL_SIZE / 2;
const STEPS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const bandMaterial = new T.MeshBasicMaterial({ color: colors.blue, side: T.DoubleSide, transparent: true, opacity: 1, depthWrite: false });

type Inside = (x: number, z: number) => boolean;

function onMap(map: IslandMap, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < map.width && z < map.depth;
}

function filledRegion(map: IslandMap, reachable: ReadonlySet<number>): Inside {
  let left = map.width;
  let right = -1;
  let top = map.depth;
  let bottom = -1;
  for (const tile of reachable) {
    const { x, z } = tileAtOn(map, tile);
    left = Math.min(left, x - 1);
    right = Math.max(right, x + 1);
    top = Math.min(top, z - 1);
    bottom = Math.max(bottom, z + 1);
  }
  const within = (x: number, z: number) => onMap(map, x, z) && x >= left && x <= right && z >= top && z <= bottom;
  const outside = new Set<number>();
  const queue: Array<[number, number]> = [];
  const open = (x: number, z: number) => {
    if (!within(x, z) || outside.has(tileIndexOn(map, x, z)) || reachable.has(tileIndexOn(map, x, z))) return;
    outside.add(tileIndexOn(map, x, z));
    queue.push([x, z]);
  };
  for (let x = left; x <= right; x++) {
    open(x, top);
    open(x, bottom);
  }
  for (let z = top; z <= bottom; z++) {
    open(left, z);
    open(right, z);
  }
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head];
    for (const [dx, dz] of STEPS) open(x + dx, z + dz);
  }
  return (x, z) => within(x, z) && !outside.has(tileIndexOn(map, x, z));
}

function joinLength(inside: Inside, x: number, z: number, dx: number, dz: number, ex: number, ez: number): number {
  if (!inside(x + ex, z + ez)) return HALF - INSET + BAND / 2;
  if (!inside(x + ex + dx, z + ez + dz)) return HALF;
  return HALF + INSET + BAND / 2;
}

function addBand(positions: number[], map: IslandMap, x: number, z: number, dx: number, dz: number, inside: Inside): void {
  const offset = (HALF - INSET) / CELL_SIZE;
  const centre = worldPositionOn(map, x + .5 + dx * offset, z + .5 + dz * offset);
  const y = groundHeight(map, x, z) + LIFT;
  const [ex, ez] = [dz, -dx];
  const ahead = joinLength(inside, x, z, dx, dz, ex, ez);
  const behind = joinLength(inside, x, z, dx, dz, -ex, -ez);
  const across = { x: dx * BAND / 2, z: dz * BAND / 2 };
  const corners = [
    [centre.x + ex * ahead - across.x, centre.z + ez * ahead - across.z],
    [centre.x + ex * ahead + across.x, centre.z + ez * ahead + across.z],
    [centre.x - ex * behind + across.x, centre.z - ez * behind + across.z],
    [centre.x - ex * behind - across.x, centre.z - ez * behind - across.z],
  ];
  for (const index of [0, 1, 2, 0, 2, 3]) positions.push(corners[index][0], y, corners[index][1]);
}

export function reachOutline(map: IslandMap, tiles: readonly number[]): T.Mesh | null {
  if (tiles.length === 0) return null;
  const region = new Set(tiles);
  const inside = filledRegion(map, region);
  const positions: number[] = [];
  for (const tile of region) {
    const { x, z } = tileAtOn(map, tile);
    for (const [dx, dz] of STEPS) {
      if (!inside(x + dx, z + dz)) addBand(positions, map, x, z, dx, dz, inside);
    }
  }
  if (positions.length === 0) return null;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(positions.map((_, index) => index % 3 === 1 ? 1 : 0), 3));
  geometry.computeBoundingSphere();
  const centre = geometry.boundingSphere!.center.clone();
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const mesh = new T.Mesh(geometry, bandMaterial.clone());
  mesh.position.copy(centre);
  mesh.renderOrder = 2;
  return mesh;
}
