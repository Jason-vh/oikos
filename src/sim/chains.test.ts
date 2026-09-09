import { describe, expect, test } from 'bun:test';
import { BUILDINGS, HOUSE_TIERS, ELITE_TIERS } from './buildings';
import { GOODS, createBuilding } from './types';

describe('the goods list', () => {
  test('carries the two new chains', () => {
    expect(GOODS.slice(0, 8)).toEqual(['food', 'olives', 'oil', 'grapes', 'wine', 'fleece', 'wood', 'marble']);
    expect(GOODS.slice(8)).toEqual(['bronze', 'armour', 'sculpture', 'horses']);
    expect(createBuilding(1, 'winery', 0, 0, 2).stock.grapes).toBe(0);
  });

  test('grapes become wine, and a winery is a pleasant neighbour', () => {
    expect(BUILDINGS.vineyard.produces).toBe('grapes');
    expect(BUILDINGS.winery.consumes).toBe('grapes');
    expect(BUILDINGS.winery.produces).toBe('wine');
    expect(BUILDINGS.winery.appeal.initial).toBe(4);
  });

  test('sheep are kept on the meadow', () => {
    expect(BUILDINGS.cardingShed.produces).toBe('fleece');
    expect(BUILDINGS.cardingShed.requiresMeadow).toBe(true);
    expect(BUILDINGS.vineyard.requiresMeadow).toBe(true);
  });

  test('a trading post takes everything the city exports', () => {
    expect(BUILDINGS.tradingPost.accepts).toEqual([
      'oil',
      'wine',
      'fleece',
      'wood',
      'marble',
      'bronze',
      'armour',
      'sculpture',
    ]);
  });

  test('timber comes from the woods and marble from the rock', () => {
    expect(BUILDINGS.timberMill.needsNear).toBe('woods');
    expect(BUILDINGS.masonryShop.needsNear).toBe('rock');
    expect(BUILDINGS.masonryShop.produces).toBe('marble');
  });
});

describe('what housing asks for', () => {
  test('a homestead wants fleece, and every tier above it', () => {
    expect(HOUSE_TIERS[2].needs).not.toContain('fleece');
    for (const tier of HOUSE_TIERS.slice(3)) expect(tier.needs).toContain('fleece');
  });

  test('a manor wants wine, a mansion does not', () => {
    expect(ELITE_TIERS[1].needs).not.toContain('wine');
    expect(ELITE_TIERS[2].needs).toContain('wine');
    expect(ELITE_TIERS[3].needs).toContain('wine');
  });
});
