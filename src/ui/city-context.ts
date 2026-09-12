import { applyCommand } from '../sim/commands';
import type { ActionResult, City, World } from '../sim/types';

export interface CityContext {
  readonly viewedId: number | null;
  readonly activeId: number | null;
}

export function bootstrapCityContext(world: World): CityContext {
  const id = world.cities[0]?.id ?? null;
  return { viewedId: id, activeId: id };
}

export function resolveCity(world: World, id: number | null): City | null {
  if (id === null) return null;
  return world.cities.find((city) => city.id === id) ?? null;
}

export function viewedCity(world: World, context: CityContext): City | null {
  return resolveCity(world, context.viewedId);
}

export function activeCity(world: World, context: CityContext): City | null {
  return resolveCity(world, context.activeId);
}

export function canWrite(world: World, context: CityContext): boolean {
  return context.activeId !== null && context.viewedId === context.activeId && resolveCity(world, context.activeId) !== null;
}

export function withViewed(context: CityContext, id: number | null): CityContext {
  return { ...context, viewedId: id };
}

export function returnToActive(context: CityContext): CityContext {
  return { ...context, viewedId: context.activeId };
}

const NO_ACTIVE_CITY: ActionResult = { ok: false, reason: 'You have no city of your own here.' };
const VISITING: ActionResult = { ok: false, reason: 'Viewing another city grants no writes.' };

export function submitCityCommand(world: World, context: CityContext, raw: unknown): ActionResult {
  if (context.activeId === null) return NO_ACTIVE_CITY;
  if (context.viewedId !== context.activeId) return VISITING;
  return applyCommand(world, context.activeId, raw);
}

export function withPersistence<T extends ActionResult>(result: T, persist: () => void): T {
  if (result.ok) persist();
  return result;
}
