import type { City, Rotation, World } from './types';
import type { CityColor } from './colors';
import { STARTING_MONEY } from './catalog';
import { freshHarbour } from './harbour';
import { harbourIslandAt, harbourPlacement } from './founding';
import { islandFor } from './island';
import { recomputeConnectivity } from './world';

export interface ClaimResult { ok: boolean; reason: string; city: City | null; }

export const CITY_NAME_LIMIT = 24;

export function cityName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > CITY_NAME_LIMIT) return null;
  return /^[^\p{C}]+$/u.test(name) ? name : null;
}

export function claimHarbour(world: World, name: string, color: CityColor, x: number, z: number, rotation: Rotation): ClaimResult {
  const chosen = cityName(name);
  if (!chosen) return { ok: false, reason: `A city needs a name of up to ${CITY_NAME_LIMIT} characters.`, city: null };
  const placement = harbourPlacement(world, x, z, rotation);
  if (!placement.ok) return { ok: false, reason: placement.reason, city: null };
  if (world.nextCityId >= Number.MAX_SAFE_INTEGER || world.nextId >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'No safe ids remain to found another city.', city: null };

  const map = islandFor(world.seed);
  const island = harbourIslandAt(map, x, z, rotation)!;
  const city: City = {
    id: world.nextCityId++,
    name: chosen,
    color,
    home: map.islands.indexOf(island),
    money: STARTING_MONEY,
    harbour: { ...freshHarbour({ x, z, rotation }), id: world.nextId++ },
    produced: 0,
    delivered: 0,
    roads: [],
    buildings: [],
    walkers: [],
  };
  world.cities.push(city);
  recomputeConnectivity(world, city);
  return { ok: true, reason: 'Your harbour stands. Lay a road from it and build.', city };
}
