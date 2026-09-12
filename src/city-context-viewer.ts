import { Stage } from './render/stage';
import { CityScene } from './render/city';
import { advance, createWorld, getSummary } from './sim/world';
import { primaryCity } from './sim/city';
import { foundSecondCity } from './sim/testing';
import { buildStarterNeighbourhood } from './sim/scenario';
import { CELL_SIZE, GROUND_Y, islandFor, worldPositionOn } from './sim/island';
import { createHud, type CityScope } from './ui/hud';
import { activeCity, bootstrapCityContext, canWrite, resolveCity, submitCityCommand, viewedCity, withViewed, type CityContext } from './ui/city-context';
import type { City, World } from './sim/types';
import './ui/style.css';

const DEVELOP_SECONDS = 600;

function viewOf(world: World, city: City) {
  const island = islandFor(world.seed, city.home);
  const harbour = worldPositionOn(island, island.entry.x + .5, island.entry.z - 7);
  return { target: [harbour.x, GROUND_Y, harbour.z], offset: [35, 38, 48], size: 36 };
}

function seaBounds(world: World): number {
  const island = islandFor(world.seed);
  return Math.max(island.width, island.depth) * CELL_SIZE / 2 + 20;
}

function boot(): void {
  const world = createWorld(1, 0);
  const city1 = primaryCity(world);
  buildStarterNeighbourhood(world, city1);
  const city2 = foundSecondCity(world, (city1.home + 1) % 8);
  buildStarterNeighbourhood(world, city2);
  advance(world, DEVELOP_SECONDS);

  let context: CityContext = bootstrapCityContext(world);
  let selectedId: number | null = null;

  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  const city = new CityScene(stage, islandFor(world.seed, city1.home), false);
  stage.bounds(seaBounds(world));
  stage.setView(viewOf(world, city1));
  stage.shadows();

  function scopeOf(target: City | null): CityScope | null {
    return target ? { city: target, summary: getSummary(target) } : null;
  }

  function refresh(): void {
    const viewed = viewedCity(world, context);
    const active = activeCity(world, context);
    city.sync(world);
    const found = viewed ? viewed.buildings.find((b) => b.id === selectedId) ?? (viewed.harbour.id === selectedId ? viewed.harbour : null) : null;
    city.select(found ?? null, null);
    hud.update(
      world,
      scopeOf(viewed),
      scopeOf(active),
      found ? { kind: 'building' as const, building: found, status: [], editable: canWrite(world, context) && viewed?.id === active?.id } : null,
    );
    hud.setCities(
      world.cities.map((candidate) => ({ id: candidate.id, label: candidate.id === active?.id ? 'Your city' : `City ${candidate.id}` })),
      context.viewedId,
    );
  }

  function watchCurrent(): void {
    city.watch(stage.controls.target, stage.viewSpan());
  }

  function viewCity(id: number): void {
    const target = resolveCity(world, id);
    if (!target) return;
    context = withViewed(context, id);
    selectedId = null;
    stage.setView(viewOf(world, target));
    watchCurrent();
    refresh();
  }

  const hud = createHud(document.querySelector<HTMLElement>('#ui')!, {
    tool: () => {},
    rotate: () => {},
    speed: () => {},
    save: () => {},
    load: () => {},
    newIsland: () => {},
    vendor: (id, enabled) => { submitCityCommand(world, context, { type: 'vendor', id, enabled }); refresh(); },
    focus: () => {},
    grid: () => {},
    menu: () => {},
    home: () => {},
    export: () => {},
    import: async () => {},
    sound: () => {},
    undo: () => {},
    visit: viewCity,
  });

  refresh();
  watchCurrent();
  document.body.dataset.ready = 'true';

  Reflect.set(window, 'cityContextFixture', {
    get state() { return structuredClone(world); },
    get context() { return { ...context }; },
    get cities() { return world.cities.map((candidate) => ({ id: candidate.id, home: candidate.home })); },
    visit: viewCity,
    select: (id: number | null) => { selectedId = id; refresh(); },
  });
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  console.error(error);
}
