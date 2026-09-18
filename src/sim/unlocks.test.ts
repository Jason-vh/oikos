import { describe, expect, test } from 'bun:test';
import { build, createWorld, placement } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { primaryCity } from './city';
import { built, settleHouses, spotFor } from './testing';
import { islandFor } from './island';
import { UNLOCKS, lockedTools, nextUnlock, residentsAtTier, unlockRefusal, unlocked } from './unlocks';

describe('the catalogue follows the ladder', () => {
  test('a new city may build the starter neighbourhood and nothing beyond it', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
    for (const tool of ['road', 'house', 'farm', 'granary', 'agora', 'fountain', 'maintenance', 'lodge', 'wharf'] as const) {
      expect(unlockRefusal(city, tool)).toBe('');
    }
    for (const tool of Object.keys(UNLOCKS) as (keyof typeof UNLOCKS)[]) {
      expect(unlocked(city, tool)).toBe(false);
    }
  });

  test('a locked tool is refused before anything else is checked, at no cost', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const money = city.money;
    const refusal = build(world, city, 'orchard', -50, -50);
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toBe('Needs 20 courtyard residents; 0 live here.');
    expect(city.money).toBe(money);
    expect(city.buildings).toEqual([]);
    expect(placement(world, city, 'orchard', -50, -50).reason).toBe(refusal.reason);
  });

  test('cottagers open the woodcutter and stockpile; courtyard residents open the grove and press', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    settleHouses(world, city, 2, 24);
    expect(residentsAtTier(city, 2)).toBe(24);
    expect(unlocked(city, 'woodcutter')).toBe(true);
    expect(unlocked(city, 'stockpile')).toBe(true);
    expect(unlocked(city, 'orchard')).toBe(false);
    settleHouses(world, city, 3, 20);
    expect(unlocked(city, 'orchard')).toBe(true);
    expect(unlocked(city, 'press')).toBe(true);
  });

  test('a house of a better tier counts toward every line below it', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    settleHouses(world, city, 4, 28);
    expect(residentsAtTier(city, 2)).toBe(28);
    expect(residentsAtTier(city, 4)).toBe(28);
    expect(lockedTools(city)).toEqual([]);
  });

  test('a city that falls back below a line loses the tool and keeps what stands', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    settleHouses(world, city, 3, 24);
    const spot = spotFor(world, 'orchard', islandFor(world.seed).entry)!;
    expect(build(world, city, 'orchard', spot.x, spot.z).ok).toBe(true);
    for (const house of city.buildings.filter((building) => building.kind === 'house')) {
      house.tier = 2;
      house.residents = 4;
    }
    expect(unlocked(city, 'orchard')).toBe(false);
    expect(built(world, 'orchard').kind).toBe('orchard');
    const again = spotFor(world, 'orchard', islandFor(world.seed).entry);
    expect(again).toBeNull();
  });

  test('the next unlock is the nearest one, and there is none once every line is met', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    settleHouses(world, city, 2, 12);
    const next = nextUnlock(city)!;
    expect(next.requirement.tier).toBe(2);
    expect(next.requirement.residents - next.living).toBe(12);
    settleHouses(world, city, 4, 28);
    expect(nextUnlock(city)).toBeNull();
  });
});
