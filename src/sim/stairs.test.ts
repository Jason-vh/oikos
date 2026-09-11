import { describe, expect, test } from 'bun:test';
import { doorTiles, mixedEdgeAllowed, roadHeight, roadStepAllowed, stairLayout, stairPlacementConflict, STAIR_STEPS } from './stairs';
import { GROUND_Y, LEVEL_HEIGHT, tileIndexOn, type IslandMap } from './island';
import type { Terrain } from './types';

function blankMap(width = 8, depth = 8): IslandMap {
  return {
    seed: 1,
    width,
    depth,
    terrain: new Array(width * depth).fill('grass') as Terrain[],
    level: new Uint8Array(width * depth),
    entry: { x: 0, z: 0 },
  };
}

function set(map: IslandMap, x: number, z: number, terrain: Terrain, level: number): void {
  const index = tileIndexOn(map, x, z);
  map.terrain[index] = terrain;
  map.level[index] = level;
}

const TILE = { x: 3, z: 3 };

interface Orientation { name: string; downOffset: [number, number]; upOffset: [number, number]; dx: number; dz: number; }

const ORIENTATIONS: Orientation[] = [
  { name: 'east down, west up', downOffset: [1, 0], upOffset: [-1, 0], dx: -1, dz: 0 },
  { name: 'west down, east up', downOffset: [-1, 0], upOffset: [1, 0], dx: 1, dz: 0 },
  { name: 'south down, north up', downOffset: [0, 1], upOffset: [0, -1], dx: 0, dz: -1 },
  { name: 'north down, south up', downOffset: [0, -1], upOffset: [0, 1], dx: 0, dz: 1 },
];

function riggedMap(orientation: Orientation): { map: IslandMap; roads: Set<number>; tile: number; down: number; up: number } {
  const map = blankMap();
  const down = { x: TILE.x + orientation.downOffset[0], z: TILE.z + orientation.downOffset[1] };
  const up = { x: TILE.x + orientation.upOffset[0], z: TILE.z + orientation.upOffset[1] };
  set(map, TILE.x, TILE.z, 'cliff', 1);
  set(map, down.x, down.z, 'grass', 0);
  set(map, up.x, up.z, 'grass', 1);
  const tile = tileIndexOn(map, TILE.x, TILE.z);
  const downIndex = tileIndexOn(map, down.x, down.z);
  const upIndex = tileIndexOn(map, up.x, up.z);
  const roads = new Set([tile, downIndex]);
  return { map, roads, tile, down: downIndex, up: upIndex };
}

describe('stairLayout orientations', () => {
  for (const orientation of ORIENTATIONS) {
    test(orientation.name, () => {
      const { map, roads, tile, down, up } = riggedMap(orientation);
      const stairs = stairLayout(map, roads);
      const stair = stairs.get(tile);
      expect(stair).toEqual({ tile, down, up, dx: orientation.dx, dz: orientation.dz });
    });
  }
});

describe('roadStepAllowed orientations', () => {
  for (const orientation of ORIENTATIONS) {
    test(`${orientation.name}: front and back pass, sides fail`, () => {
      const { map, roads, tile, down, up } = riggedMap(orientation);
      const stairs = stairLayout(map, roads);
      expect(roadStepAllowed(map, stairs, down, tile)).toBe(true);
      expect(roadStepAllowed(map, stairs, tile, up)).toBe(true);
      const perpendicular: [number, number][] = orientation.dx !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const [lx, lz] of perpendicular) {
        const side = tileIndexOn(map, TILE.x + lx, TILE.z + lz);
        expect(roadStepAllowed(map, stairs, tile, side)).toBe(false);
      }
    });
  }
});

describe('roadHeight', () => {
  test('rises from the lower tile height to the upper tile height across the cell, full width', () => {
    const orientation = ORIENTATIONS[1];
    const { map, roads } = riggedMap(orientation);
    const stairs = stairLayout(map, roads);
    const lower = GROUND_Y;
    const upper = GROUND_Y + LEVEL_HEIGHT;
    expect(roadHeight(map, stairs, TILE.x + .001, TILE.z + .5)).toBeCloseTo(lower + LEVEL_HEIGHT / STAIR_STEPS, 5);
    expect(roadHeight(map, stairs, TILE.x + .999, TILE.z + .5)).toBeCloseTo(upper, 5);
    for (let step = 0; step < STAIR_STEPS; step++) {
      const mid = (step + .5) / STAIR_STEPS;
      const expected = lower + (step + 1) / STAIR_STEPS * LEVEL_HEIGHT;
      expect(roadHeight(map, stairs, TILE.x + mid, TILE.z + .5)).toBeCloseTo(expected, 5);
    }
  });

  test('flat ground reports its nominal height, unaffected by stairs elsewhere', () => {
    const orientation = ORIENTATIONS[0];
    const { map, roads } = riggedMap(orientation);
    const stairs = stairLayout(map, roads);
    expect(roadHeight(map, stairs, 6.5, 6.5)).toBeCloseTo(GROUND_Y, 5);
  });
});

describe('roadStepAllowed', () => {
  test('permits the front (down) and back (up) edges of a stair', () => {
    const { map, roads, tile, down, up } = riggedMap(ORIENTATIONS[0]);
    const stairs = stairLayout(map, roads);
    expect(roadStepAllowed(map, stairs, down, tile)).toBe(true);
    expect(roadStepAllowed(map, stairs, tile, down)).toBe(true);
    expect(roadStepAllowed(map, stairs, tile, up)).toBe(true);
    expect(roadStepAllowed(map, stairs, up, tile)).toBe(true);
  });

  test('blocks the lateral sides of a stair even when a road sits there', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    set(map, TILE.x, TILE.z - 1, 'grass', 1);
    const side = tileIndexOn(map, TILE.x, TILE.z - 1);
    roads.add(side);
    const stairs = stairLayout(map, roads);
    expect(roadStepAllowed(map, stairs, tile, side)).toBe(false);
    expect(roadStepAllowed(map, stairs, side, tile)).toBe(false);
  });

  test('two plain roads at different levels with no derived stair cannot be crossed', () => {
    const map = blankMap();
    set(map, 3, 3, 'grass', 1);
    set(map, 4, 3, 'grass', 0);
    const a = tileIndexOn(map, 3, 3);
    const b = tileIndexOn(map, 4, 3);
    const roads = new Set([a, b]);
    const stairs = stairLayout(map, roads);
    expect(stairs.size).toBe(0);
    expect(roadStepAllowed(map, stairs, a, b)).toBe(false);
  });

  test('rejects an out-of-range tile without throwing', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    const stairs = stairLayout(map, roads);
    expect(roadStepAllowed(map, stairs, tile, -1)).toBe(false);
    expect(roadStepAllowed(map, stairs, tile, map.width * map.depth)).toBe(false);
  });

  test('rejects a pair that are not cardinal neighbours', () => {
    const { map, roads, tile, up } = riggedMap(ORIENTATIONS[0]);
    const stairs = stairLayout(map, roads);
    const farAway = tileIndexOn(map, TILE.x, TILE.z + 4);
    expect(roadStepAllowed(map, stairs, tile, farAway)).toBe(false);
    expect(roadStepAllowed(map, stairs, tile, tile)).toBe(false);
    void up;
  });

  test('does not let two independently derived, perpendicular stairs connect through each other\'s wall', () => {
    const map = blankMap();
    set(map, 3, 3, 'cliff', 1);
    set(map, 2, 3, 'grass', 0);
    set(map, 4, 3, 'cliff', 1);
    set(map, 4, 4, 'grass', 0);
    set(map, 4, 2, 'grass', 1);
    const a = tileIndexOn(map, 3, 3);
    const aDown = tileIndexOn(map, 2, 3);
    const u = tileIndexOn(map, 4, 3);
    const uDown = tileIndexOn(map, 4, 4);
    const roads = new Set([a, aDown, u, uDown]);
    const stairs = stairLayout(map, roads);
    expect(stairs.get(a)?.up).toBe(u);
    expect(stairs.get(u)?.down).toBe(uDown);
    expect(roadStepAllowed(map, stairs, a, u)).toBe(false);
    expect(roadStepAllowed(map, stairs, u, a)).toBe(false);
  });

  test('rejects an uncarved flat road sitting a full level above the landing, not just a stair chain', () => {
    const map = blankMap();
    set(map, 3, 3, 'grass', 0);
    set(map, 4, 3, 'cliff', 1);
    set(map, 5, 3, 'grass', 2);
    const low = tileIndexOn(map, 3, 3);
    const stairTile = tileIndexOn(map, 4, 3);
    const higherFlat = tileIndexOn(map, 5, 3);
    const roads = new Set([low, stairTile, higherFlat]);
    const stairs = stairLayout(map, roads);
    expect(stairs.get(stairTile)?.up).toBe(higherFlat);
    expect(stairs.has(higherFlat)).toBe(false);
    expect(roadStepAllowed(map, stairs, stairTile, higherFlat)).toBe(false);
    expect(roadStepAllowed(map, stairs, higherFlat, stairTile)).toBe(false);
  });

  test('chained ascending stairs connect through their shared landing', () => {
    const map = blankMap();
    set(map, 3, 3, 'grass', 0);
    set(map, 4, 3, 'cliff', 1);
    set(map, 5, 3, 'cliff', 2);
    set(map, 6, 3, 'grass', 2);
    const low = tileIndexOn(map, 3, 3);
    const midTile = tileIndexOn(map, 4, 3);
    const highTile = tileIndexOn(map, 5, 3);
    const top = tileIndexOn(map, 6, 3);
    const roads = new Set([low, midTile, highTile, top]);
    const stairs = stairLayout(map, roads);
    expect(stairs.size).toBe(2);
    expect(roadStepAllowed(map, stairs, low, midTile)).toBe(true);
    expect(roadStepAllowed(map, stairs, midTile, highTile)).toBe(true);
    expect(roadStepAllowed(map, stairs, highTile, top)).toBe(true);
  });
});

describe('stairPlacementConflict', () => {
  test('accepts a clean single-direction stair', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    expect(stairPlacementConflict(map, roads, tile)).toBeNull();
  });

  test('rejects two lower neighbours as ambiguous', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    set(map, TILE.x, TILE.z + 1, 'grass', 0);
    set(map, TILE.x, TILE.z - 1, 'grass', 1);
    roads.add(tileIndexOn(map, TILE.x, TILE.z + 1));
    expect(stairPlacementConflict(map, roads, tile)).toBe('ambiguous');
  });

  test('rejects a perpendicular road entering a stair from the side', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    set(map, TILE.x, TILE.z + 1, 'grass', 1);
    roads.add(tileIndexOn(map, TILE.x, TILE.z + 1));
    expect(stairPlacementConflict(map, roads, tile)).toBe('side');
  });

  test('rejects a stair whose back landing is water', () => {
    const map = blankMap();
    set(map, TILE.x, TILE.z, 'cliff', 1);
    set(map, TILE.x + 1, TILE.z, 'grass', 0);
    set(map, TILE.x - 1, TILE.z, 'water', 0);
    const tile = tileIndexOn(map, TILE.x, TILE.z);
    const roads = new Set([tile, tileIndexOn(map, TILE.x + 1, TILE.z)]);
    expect(stairPlacementConflict(map, roads, tile)).toBe('backland');
  });

  test('rejects a stair whose back landing drops below its own level', () => {
    const map = blankMap();
    set(map, TILE.x, TILE.z, 'cliff', 1);
    set(map, TILE.x + 1, TILE.z, 'grass', 0);
    set(map, TILE.x - 1, TILE.z, 'grass', 0);
    const tile = tileIndexOn(map, TILE.x, TILE.z);
    const roads = new Set([tile, tileIndexOn(map, TILE.x + 1, TILE.z)]);
    expect(stairPlacementConflict(map, roads, tile)).toBe('backland');
  });

  test('rejects a stair whose back landing runs off the map edge', () => {
    const map = blankMap();
    set(map, 0, 3, 'cliff', 1);
    set(map, 1, 3, 'grass', 0);
    const tile = tileIndexOn(map, 0, 3);
    const roads = new Set([tile, tileIndexOn(map, 1, 3)]);
    expect(stairPlacementConflict(map, roads, tile)).toBe('backland');
  });

  test('requires the higher tile itself to be cliff terrain, not just either side', () => {
    const map = blankMap();
    set(map, TILE.x, TILE.z, 'grass', 1);
    set(map, TILE.x + 1, TILE.z, 'cliff', 0);
    set(map, TILE.x - 1, TILE.z, 'grass', 1);
    const tile = tileIndexOn(map, TILE.x, TILE.z);
    const roads = new Set([tile, tileIndexOn(map, TILE.x + 1, TILE.z)]);
    const stairs = stairLayout(map, roads);
    expect(stairs.has(tile)).toBe(false);
    expect(stairPlacementConflict(map, roads, tile)).toBeNull();
  });
});

describe('doorTiles', () => {
  test('excludes a stair tile from the perpendicular side, includes it from the landing', () => {
    const { map, roads, up } = riggedMap(ORIENTATIONS[0]);
    const tile = tileIndexOn(map, TILE.x, TILE.z);
    const stairs = stairLayout(map, roads);
    const buildingBehind = new Set([up]);
    expect(doorTiles(map, stairs, buildingBehind)).toContain(tile);

    const buildingBeside = new Set([tileIndexOn(map, TILE.x, TILE.z - 1)]);
    expect(doorTiles(map, stairs, buildingBeside)).not.toContain(tile);
  });

  test('excludes the landing when it sits a level above the stair, a gap only a further stair could cross', () => {
    const map = blankMap();
    set(map, TILE.x, TILE.z, 'cliff', 1);
    set(map, TILE.x + 1, TILE.z, 'grass', 0);
    set(map, TILE.x - 1, TILE.z, 'grass', 2);
    const tile = tileIndexOn(map, TILE.x, TILE.z);
    const down = tileIndexOn(map, TILE.x + 1, TILE.z);
    const up = tileIndexOn(map, TILE.x - 1, TILE.z);
    const roads = new Set([tile, down]);
    const stairs = stairLayout(map, roads);
    expect(stairs.get(tile)?.up).toBe(up);
    expect(doorTiles(map, stairs, new Set([up]))).not.toContain(tile);
  });
});

describe('mixedEdgeAllowed', () => {
  test('a road-road pair defers entirely to roadStepAllowed, even off a stair', () => {
    const map = blankMap();
    set(map, 3, 3, 'grass', 1);
    set(map, 4, 3, 'grass', 0);
    const a = tileIndexOn(map, 3, 3);
    const b = tileIndexOn(map, 4, 3);
    const roads = new Set([a, b]);
    const stairs = stairLayout(map, roads);
    expect(mixedEdgeAllowed(map, roads, stairs, a, b)).toBe(roadStepAllowed(map, stairs, a, b));
    expect(mixedEdgeAllowed(map, roads, stairs, a, b)).toBe(false);
  });

  test('a step touching a stair tile is road-restricted even when the other side is off-road', () => {
    const { map, roads, tile } = riggedMap(ORIENTATIONS[0]);
    const stairs = stairLayout(map, roads);
    const side = tileIndexOn(map, TILE.x, TILE.z - 1);
    expect(roads.has(side)).toBe(false);
    expect(mixedEdgeAllowed(map, roads, stairs, tile, side)).toBe(false);
  });

  test('an off-road cliff scramble away from any stair keeps the original permissive rule', () => {
    const map = blankMap();
    set(map, 3, 3, 'cliff', 1);
    set(map, 4, 3, 'grass', 0);
    const roads = new Set<number>();
    const stairs = stairLayout(map, roads);
    const a = tileIndexOn(map, 3, 3);
    const b = tileIndexOn(map, 4, 3);
    expect(mixedEdgeAllowed(map, roads, stairs, a, b)).toBe(true);
  });

  test('bounds and adjacency guards apply just like roadStepAllowed', () => {
    const map = blankMap();
    const roads = new Set<number>();
    const stairs = stairLayout(map, roads);
    expect(mixedEdgeAllowed(map, roads, stairs, 0, -1)).toBe(false);
    expect(mixedEdgeAllowed(map, roads, stairs, 0, 2)).toBe(false);
  });
});
