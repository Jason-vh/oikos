import { TERRAIN_GRASS } from './grid';
import type { World } from './world';

/** Level, empty ground: for tests that put buildings at fixed spots and care about
 * what the city does there, not what the map generator felt like drawing. */
export function levelGround(world: World): World {
  world.grid.terrain.fill(TERRAIN_GRASS);
  world.grid.height.fill(0);
  world.grid.decor.fill(0);
  return world;
}
