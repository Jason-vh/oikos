import { describe, expect, test } from 'bun:test';
import { cityReport, cityWindow, describeHarbourSite, describePlacement, describeRoadPath, inspectBuilding, inspectTile, islandBounds, MAX_WINDOW_DEPTH, MAX_WINDOW_WIDTH, renderMap, surveyIsland, viewpointAt, viewpointOf } from './view';
import { primaryCity } from '../sim/city';
import { harbourSite } from '../sim/founding';
import { mapOf } from '../sim/grid';
import { ISLAND_COUNT, terrainOn, tileIndexOn } from '../sim/island';
import type { Terrain } from '../sim/types';
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
  const line = map.split('\n').find((candidate) => candidate.trimStart().startsWith(`${z} `));
  if (!line) throw new Error(`No row ${z} in the map.`);
  return line.trimStart().slice(String(z).length + 1);
}

function tenColumnRuler(from: number, labels: number): string {
  return Array.from({ length: labels }, (_, step) => String(from + step * 10).padEnd(10)).join('').trimEnd();
}

describe('the island map', () => {
  test('labels its columns and rows with tile coordinates', () => {
    const { world, city } = starterCity();
    const bounds = islandBounds(viewpointOf(world, city));
    const x = Math.ceil(bounds.x / 10) * 10;
    const z = bounds.z + 10;
    const map = renderMap(world, viewpointOf(world, city), { x, z, width: 25, depth: 10 });
    const [ruler] = map.split('\n');

    expect(ruler.trimStart()).toBe(tenColumnRuler(x, 3));
    expect(map.split('\n')).toHaveLength(11);
    expect(rowAt(map, z)).toHaveLength(25);
  });

  test('draws the city over the terrain it stands on', () => {
    const { world, city } = starterCity();
    const granary = city.buildings.find((building) => building.kind === 'granary')!;
    const road = city.roads[0];
    const grid = mapOf(world, city);

    const map = renderMap(world, viewpointOf(world, city), { x: grid.entry.x - 20, z: grid.entry.z - 20, width: 40, depth: 24 });

    expect(rowAt(map, granary.z)[granary.x - (grid.entry.x - 20)]).toBe('G');
    expect(rowAt(map, Math.floor(road / grid.width))[(road % grid.width) - (grid.entry.x - 20)]).toBe('+');
  });

  test('never leaves the settled island, nor outgrows a window worth reading', () => {
    const { world, city } = starterCity();
    const bounds = islandBounds(viewpointOf(world, city));

    const map = renderMap(world, viewpointOf(world, city), { x: bounds.x - 50, z: bounds.z - 50, width: 400, depth: 400 });
    const rows = map.split('\n').slice(1);

    expect(rows).toHaveLength(Math.min(bounds.depth, MAX_WINDOW_DEPTH));
    expect(rows[0].trimStart()).toStartWith(String(bounds.z));
    expect(rowAt(map, bounds.z)).toHaveLength(Math.min(bounds.width, MAX_WINDOW_WIDTH));
  });

  test('centres itself on the city and keeps a workable minimum', () => {
    const { world, city } = starterCity();
    const window = cityWindow(world, city);
    const bounds = islandBounds(viewpointOf(world, city));

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
    const survey = surveyIsland(world, viewpointOf(world, other), { x: other.harbour.x - 6, z: other.harbour.z - 6, width: 24, depth: 16 });
    const visiting = surveyIsland(world, viewpointOf(world, city), { x: other.harbour.x - 6, z: other.harbour.z - 6, width: 24, depth: 16 });

    expect(tileIndexOn(grid, other.harbour.x, other.harbour.z)).toBeGreaterThan(0);
    expect(survey).toContain('H harbour');
    expect(visiting).not.toContain("another city's road");
  });
});

describe('the survey', () => {
  test('says where the island is, what it is made of, and how to read the map', () => {
    const { world, city } = starterCity();
    const survey = surveyIsland(world, viewpointOf(world, city));

    expect(survey).toContain(`Island ${city.home}`);
    expect(survey).toContain('A harbour needs two rows');
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
    expect(report).toContain('Roads: 45 tiles.');
  });

});

describe('looking before founding', () => {
  test('reads a window by coordinates alone, on any island', () => {
    const world = createWorld();
    const grid = mapOf(world, primaryCity(world));
    const elsewhere = grid.islands[(grid.home + 1) % ISLAND_COUNT];
    const view = viewpointAt(world, null, elsewhere.entry.x, elsewhere.entry.z)!;

    expect(view.home).toBe(grid.islands.indexOf(elsewhere));
    expect(view.city).toBeNull();
    expect(viewpointAt(world, null, 0, 0)).toBeNull();
    expect(surveyIsland(world, view, { x: elsewhere.entry.x, z: elsewhere.entry.z, width: 20, depth: 10 }))
      .toContain(`Island ${grid.islands.indexOf(elsewhere)} of the archipelago`);
  });

  test('reads a tile with no city to read it from', () => {
    const world = createWorld();
    const grid = mapOf(world, primaryCity(world));
    const shore = grid.islands[(grid.home + 1) % ISLAND_COUNT].entry;

    const answer = inspectTile(world, null, shore.x, shore.z);

    expect(answer).toContain(`(${shore.x},${shore.z})`);
    expect(answer).toContain('found_city could claim a shore');
    expect(inspectTile(world, null, 0, 0)).toContain('Open sea.');
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
    const { world, city } = starterCity();
    const fountain = city.buildings.find((building) => building.kind === 'fountain')!;

    expect(inspectBuilding(world, city, fountain.id)).toContain('Water carrier');
    expect(inspectBuilding(world, city, -1)).toBe('No building #-1 in this city.');
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

  test('pass on the refusal a player would be shown, and name the ground that refused it', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const grid = mapOf(world, city);
    const dry = spotFor(world, 'granary')!;

    expect(describePlacement(world, city, 'farm', 0, 0, 0)).toContain('refused.');

    const answer = describePlacement(world, city, 'farm', dry.x, dry.z, 0);
    const named = [...answer.matchAll(/\((\d+),(\d+)\) (\w+)/g)].slice(1);

    expect(answer).toContain('Farms need fertile ground.');
    expect(answer).toContain('Blocked at');
    expect(named.length).toBeGreaterThan(0);
    for (const [, x, z, terrain] of named) {
      expect(terrainOn(grid, Number(x), Number(z))).toBe(terrain as Terrain);
    }
  });

  test('state the footprint a placement would cover', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const spot = spotFor(world, 'granary')!;

    expect(describePlacement(world, city, 'granary', spot.x, spot.z, 0))
      .toContain(`covering (${spot.x},${spot.z})-(${spot.x + 2},${spot.z + 2})`);
  });

  test('price a road path and the founding dockyard', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const grid = mapOf(world, city);
    const start = { x: grid.entry.x, z: grid.entry.z - 6 };
    const path = [start, { x: start.x + 3, z: start.z }];

    expect(describeRoadPath(world, city, path)).toContain('Road from');

    expect(describeHarbourSite(world, 0, 0, 0)).toContain('refused.');
  });

  test('show which rows a harbour would take and which of them refused it', () => {
    const world = createWorld();
    const grid = mapOf(world, primaryCity(world));
    const inland = { x: grid.entry.x, z: grid.entry.z - 12 };

    const answer = describeHarbourSite(world, inland.x, inland.z, 0);
    const site = harbourSite(inland.x, inland.z, 0);

    expect(answer).toContain('refused.');
    for (const tile of [...site.land, ...site.water]) expect(answer).toContain(`(${tile.x},${tile.z})`);
    expect(answer).toContain('Blocked at');
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
