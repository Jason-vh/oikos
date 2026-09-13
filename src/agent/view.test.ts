import { describe, expect, test } from 'bun:test';
import { cityReport, cityWindow, describeFounding, describePlacement, describeRoadPath, inspectBuilding, inspectTile, islandBounds, renderMap, surveyIsland } from './view';
import { primaryCity } from '../sim/city';
import { mapOf } from '../sim/grid';
import { ISLAND_COUNT, tileIndexOn } from '../sim/island';
import { buildStarterNeighbourhood } from '../sim/scenario';
import { foundSecondCity, spotFor } from '../sim/testing';
import { advance, build, createWorld, placeRoadPath } from '../sim/world';

function starterCity() {
  const world = createWorld();
  const city = primaryCity(world);
  buildStarterNeighbourhood(world, city);
  advance(world, 400);
  return { world, city };
}

function rowAt(map: string, z: number): string {
  const line = map.split('\n').find((candidate) => candidate.startsWith(`${z} `));
  if (!line) throw new Error(`No row ${z} in the map.`);
  return line.slice(String(z).length + 1);
}

describe('the island map', () => {
  test('labels its columns and rows with tile coordinates', () => {
    const { world, city } = starterCity();
    const map = renderMap(world, city, { x: 210, z: 180, width: 25, depth: 10 });
    const [ruler] = map.split('\n');

    expect(ruler.trimStart()).toBe('210       220       230');
    expect(map.split('\n')).toHaveLength(11);
    expect(rowAt(map, 180)).toHaveLength(25);
  });

  test('draws the city over the terrain it stands on', () => {
    const { world, city } = starterCity();
    const granary = city.buildings.find((building) => building.kind === 'granary')!;
    const road = city.roads[0];
    const grid = mapOf(world, city);

    const map = renderMap(world, city, { x: grid.entry.x - 20, z: grid.entry.z - 20, width: 40, depth: 24 });

    expect(rowAt(map, granary.z)[granary.x - (grid.entry.x - 20)]).toBe('G');
    expect(rowAt(map, Math.floor(road / grid.width))[(road % grid.width) - (grid.entry.x - 20)]).toBe('+');
  });

  test('never leaves the settled island, however far the window reaches', () => {
    const { world, city } = starterCity();
    const bounds = islandBounds(world, city);

    const map = renderMap(world, city, { x: bounds.x - 50, z: bounds.z - 50, width: 400, depth: 400 });
    const rows = map.split('\n').slice(1);

    expect(rows).toHaveLength(bounds.depth);
    expect(rows[0]).toStartWith(String(bounds.z));
    expect(rowAt(map, bounds.z)).toHaveLength(bounds.width);
  });

  test('centres itself on the city and keeps a workable minimum', () => {
    const { world, city } = starterCity();
    const window = cityWindow(world, city);
    const bounds = islandBounds(world, city);

    expect(window.width).toBeGreaterThanOrEqual(24);
    expect(window.depth).toBeGreaterThanOrEqual(16);
    expect(window.x).toBeGreaterThanOrEqual(bounds.x);
    expect(window.x + window.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  });

  test('shows another city in lowercase so ownership is readable', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const other = foundSecondCity(world, (city.home + 1) % ISLAND_COUNT);
    const grid = mapOf(world, other);
    const survey = surveyIsland(world, other, { x: other.harbour.x - 6, z: other.harbour.z - 6, width: 24, depth: 16 });
    const visiting = surveyIsland(world, city, { x: other.harbour.x - 6, z: other.harbour.z - 6, width: 24, depth: 16 });

    expect(tileIndexOn(grid, other.harbour.x, other.harbour.z)).toBeGreaterThan(0);
    expect(survey).toContain('H harbour');
    expect(visiting).not.toContain("another city's road");
  });
});

describe('the survey', () => {
  test('says where the island is, what it is made of, and how to read the map', () => {
    const { world, city } = starterCity();
    const survey = surveyIsland(world, city);

    expect(survey).toContain(`Island ${city.home}`);
    expect(survey).toContain('Landing road entry at');
    expect(survey).toContain('fertile');
    expect(survey).toContain('Legend:');
    expect(survey.length).toBeLessThan(4000);
  });
});

describe('the city report', () => {
  test('states treasury, population, employment and the goal', () => {
    const { world, city } = starterCity();
    const report = cityReport(world, city);

    expect(report).toContain(`Treasury ${Math.round(city.money)} dr`);
    expect(report).toContain('Population 80');
    expect(report).toContain('of 15 jobs');
    expect(report).toContain('4 of 4 courtyard houses');
  });

  test('lists every building with the diagnosis the inspector gives a player', () => {
    const { world, city } = starterCity();
    const report = cityReport(world, city);
    const farm = city.buildings.find((building) => building.kind === 'farm')!;

    expect(report).toContain(`farm #${farm.id} at (${farm.x},${farm.z}) 4x4`);
    expect(report).toContain('to harvest.');
    expect(report).toContain('Walkers (');
    expect(report).toContain('Roads: 50 tiles.');
  });

  test('tells an unfounded city to place its dockyard instead of reporting an economy', () => {
    const world = createWorld(1, 3, false);
    const city = primaryCity(world);
    const report = cityReport(world, city);

    expect(report).toContain('is not founded yet');
    expect(report).toContain('Time does not pass');
    expect(report).not.toContain('Population');
  });
});

describe('inspection', () => {
  test('reads terrain, level and ownership of a tile', () => {
    const { world, city } = starterCity();
    const farm = city.buildings.find((building) => building.kind === 'farm')!;

    const occupied = inspectTile(world, city, farm.x, farm.z);
    expect(occupied).toContain('fertile');
    expect(occupied).toContain('takes a wheat farm');
    expect(occupied).toContain(`farm #${farm.id}`);
    expect(occupied).toContain('On your island.');
  });

  test('names the sea, other islands and tiles off the map', () => {
    const { world, city } = starterCity();
    const grid = mapOf(world, city);

    expect(inspectTile(world, city, 0, 0)).toContain('Open sea.');
    expect(inspectTile(world, city, -1, 5)).toContain('outside the archipelago');
    expect(inspectTile(world, city, grid.width, 5)).toContain('outside the archipelago');
  });

  test('reports a road tile as a road', () => {
    const { world, city } = starterCity();
    const grid = mapOf(world, city);
    const road = city.roads[0];

    expect(inspectTile(world, city, road % grid.width, Math.floor(road / grid.width))).toContain('Your road runs here.');
  });

  test('adds the walkers a building sent out', () => {
    const { city } = starterCity();
    const fountain = city.buildings.find((building) => building.kind === 'fountain')!;

    expect(inspectBuilding(city, fountain.id)).toContain('Water carrier');
    expect(inspectBuilding(city, -1)).toBe('No building #-1 in this city.');
  });
});

describe('dry runs', () => {
  test('price a legal placement without spending', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const spot = spotFor(world, 'granary')!;
    const before = city.money;

    const answer = describePlacement(world, city, 'granary', spot.x, spot.z, 0);

    expect(answer).toContain('allowed, costs 120 dr');
    expect(answer).toContain(`leaving ${before - 120} dr`);
    expect(city.money).toBe(before);
  });

  test('pass on the refusal a player would be shown', () => {
    const world = createWorld();
    const city = primaryCity(world);

    expect(describePlacement(world, city, 'farm', 0, 0, 0)).toContain('refused.');
  });

  test('price a road path and the founding dockyard', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const grid = mapOf(world, city);
    const start = { x: grid.entry.x, z: grid.entry.z - 6 };
    const path = [start, { x: start.x + 3, z: start.z }];

    expect(describeRoadPath(world, city, path)).toContain('Road from');

    const pending = createWorld(1, 3, false);
    const pendingCity = primaryCity(pending);
    expect(describeFounding(pending, pendingCity, 0, 0)).toContain('refused.');
  });

  test('agree with the command that follows them', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const spot = spotFor(world, 'granary')!;

    const dry = describePlacement(world, city, 'granary', spot.x, spot.z, 0);
    const done = build(world, city, 'granary', spot.x, spot.z, 0);

    expect(dry).toContain('allowed');
    expect(done.ok).toBe(true);
    expect(placeRoadPath(world, city, [{ x: spot.x, z: spot.z }]).ok).toBe(false);
  });
});
