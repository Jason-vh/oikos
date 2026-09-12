import type { City, World } from './types';

export function primaryCity(world: World): City {
  return world.cities[0];
}
