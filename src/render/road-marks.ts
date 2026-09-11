import * as T from 'three';
import { CELL_SIZE, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import { roadHeight, STAIR_STEPS, type Stair } from '../sim/stairs';
import { STAIR_WIDTH } from '../art/stairs';

export function addRoadMark(root: T.Group, map: IslandMap, stairs: ReadonlyMap<number, Stair>, index: number, geometry: T.BufferGeometry, material: T.Material, inset: number): void {
  const tile = tileAtOn(map, index);
  const stair = stairs.get(index);
  const count = stair ? STAIR_STEPS : 1;
  for (let step = 0; step < count; step++) {
    const along = (step + .5) / count - .5;
    const x = tile.x + .5 + (stair?.dx ?? 0) * along;
    const z = tile.z + .5 + (stair?.dz ?? 0) * along;
    const point = worldPositionOn(map, x, z);
    const surface = new T.Mesh(geometry, material);
    surface.scale.set(CELL_SIZE - inset, 1, CELL_SIZE - inset);
    if (stair) {
      surface.scale.set(STAIR_WIDTH - .04, 1, CELL_SIZE / count - .012);
      surface.rotation.y = Math.atan2(stair.dx, stair.dz);
    }
    surface.position.set(point.x, roadHeight(map, stairs, x, z) + .09, point.z);
    root.add(surface);
  }
}
