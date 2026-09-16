import * as T from 'three';
import { Stage } from './render/stage';
import { CityScene } from './render/city';
import { ConstructionOverlay } from './render/construction';
import { primaryCity } from './sim/city';
import { CELL_SIZE, GROUND_Y, groundHeight, islandFor, terrainOn, tileIndexOn, worldPositionOn } from './sim/island';
import { roadHeight, stairLayout } from './sim/stairs';
import { advance, build, createWorld, demolish, placement, placeRoadPath, roadPathPlacement } from './sim/world';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './sim/scenario';
import { gatherReach } from './sim/gathering';
import { footprintTileIssues } from './sim/construction';
import type { BuildingKind, BuildTool, Rotation, Tile, World } from './sim/types';
import { meterEnabled } from './ui/debug';
import { FrameMeter } from './ui/meter';
import './ui/style.css';

function boot(): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  stage.reducedMotion = reducedMotion;
  let world: World = createWorld(seedFromQuery());
  let scene = new CityScene(stage, islandFor(world.seed, primaryCity(world).home), !reducedMotion);
  let overlay = new ConstructionOverlay(stage, scene.map);
  let showGrid = false;
  let artTime = 0;
  let previous = 0;
  const meter = meterEnabled(location.search) ? new FrameMeter(document.body) : null;

  function seedFromQuery(): number {
    const raw = Number(new URLSearchParams(location.search).get('seed'));
    return Number.isSafeInteger(raw) && raw > 0 ? raw : 1;
  }

  function city() {
    return primaryCity(world);
  }

  function homeView(): void {
    const island = islandFor(world.seed, city().home);
    const landing = worldPositionOn(island, island.entry.x + .5, island.entry.z - 7);
    stage.setView({ target: [landing.x, GROUND_Y, landing.z], offset: [35, 38, 48], size: 36 });
  }

  function rebuild(): void {
    scene.dispose();
    overlay.dispose();
    const island = islandFor(world.seed, city().home);
    stage.bounds(Math.max(island.width, island.depth) * CELL_SIZE / 2 + 20);
    scene = new CityScene(stage, island, !reducedMotion);
    overlay = new ConstructionOverlay(stage, island);
    homeView();
    sync();
    pose();
  }

  function sync(): void {
    scene.setWorldTime(world.time);
    scene.sync(world);
    overlay.setRoads(city().roads);
    scene.setGrid(showGrid);
    scene.watch(stage.controls.target, stage.viewSpan());
    stage.shadows();
  }

  function pose(): void {
    if (!reducedMotion) return;
    scene.animate(0, .25, 1);
    stage.shadows();
  }

  function frame(now: number): void {
    const delta = previous === 0 || document.hidden ? 0 : Math.min((now - previous) / 1000, .25);
    previous = now;
    stage.update(delta);
    scene.watch(stage.controls.target, stage.viewSpan());
    scene.transitions(delta);
    if (!reducedMotion && !document.hidden) {
      artTime += delta;
      scene.animate(artTime, delta, 1);
      stage.shadows();
    }
    meter?.sample(now, {
      rendered: stage.frames,
      drawCalls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      span: stage.viewSpan(),
      planting: scene.growing,
    });
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'q') stage.rotate();
    else if (event.key.toLowerCase() === 'g') { showGrid = !showGrid; sync(); }
  });

  rebuild();
  requestAnimationFrame(frame);

  Reflect.set(window, 'oikos', {
    get state() { return structuredClone(world); },
    get map() { const island = scene.map; return { width: island.width, depth: island.depth, home: island.home, islands: island.islands, entry: island.entry, terrain: island.terrain, level: Array.from(island.level) }; },
    get frames() { return stage.frames; },
    get drawCalls() { return stage.renderer.info.render.calls; },
    get triangles() { return stage.renderer.info.render.triangles; },
    get foamVersion() { return (scene.scenery.foam.mesh.geometry.getAttribute('position') as T.BufferAttribute).version; },
    get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; },
    get plan() { return planStarterNeighbourhood(world, city()); },
    setSeed: (seed: number) => {
      world = createWorld(seed);
      rebuild();
    },
    advance: (seconds: number) => {
      advance(world, seconds);
      sync();
      pose();
    },
    buildPlan: () => {
      const result = buildStarterNeighbourhood(world, city());
      sync();
      return result;
    },
    build: (tool: BuildTool, x: number, z: number, rotation: Rotation = 0) => {
      const result = build(world, city(), tool, x, z, rotation);
      sync();
      return result;
    },
    road: (tiles: Tile[]) => {
      const result = placeRoadPath(world, city(), tiles);
      sync();
      return result;
    },
    demolish: (x: number, z: number) => {
      const result = demolish(world, city(), x, z);
      sync();
      return result;
    },
    previewRoad: (tiles: Tile[]) => {
      const preview = roadPathPlacement(world, city(), tiles);
      const indices = tiles.map((tile) => tileIndexOn(scene.map, tile.x, tile.z));
      scene.showPreview('road', tiles[tiles.length - 1].x, tiles[tiles.length - 1].z, 0, { ...preview, tiles: indices }, city().roads);
      return preview;
    },
    previewBuilding: (tool: Exclude<BuildingKind, 'harbour'>, x: number, z: number, rotation: Rotation = 0) => {
      const preview = placement(world, city(), tool, x, z, rotation);
      const issues = footprintTileIssues(world, city(), tool, x, z, rotation);
      const valid = issues.filter((tile) => !tile.blocked);
      scene.showPreview(tool, x, z, rotation, { ...preview, ok: true, tiles: valid.map((tile) => tileIndexOn(scene.map, tile.x, tile.z)) }, city().roads, gatherReach(world, city(), tool, x, z, rotation));
      overlay.setBlockedTiles(issues.filter((tile) => tile.blocked));
      return preview;
    },
    previewDemolition: (x: number, z: number) => {
      scene.showPreview('demolish', x, z, 0, { ok: false, reason: '', tiles: [], cost: 0 }, city().roads);
    },
    hidePreview: () => {
      scene.hidePreview();
      overlay.setBlockedTiles([]);
    },
    toggleGrid: () => { showGrid = !showGrid; sync(); },
    rotateView: () => stage.rotate(),
    focusTile: (x: number, z: number) => {
      const point = worldPositionOn(scene.map, x + .5, z + .5);
      stage.focus(point.x, point.z, true);
    },
    home: homeView,
    projectTile: (x: number, z: number) => {
      const point = worldPositionOn(scene.map, x + .5, z + .5);
      return stage.project(point.x, roadHeight(scene.map, stairLayout(scene.map, new Set(city().roads)), x + .5, z + .5), point.z);
    },
    projectPoint: (x: number, z: number, y = 0) => {
      const point = worldPositionOn(scene.map, x, z);
      return stage.project(point.x, groundHeight(scene.map, Math.floor(x), Math.floor(z)) + y, point.z);
    },
    terrainAt: (x: number, z: number) => terrainOn(scene.map, x, z),
  });
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  const status = document.querySelector<HTMLElement>('#status')!;
  status.hidden = false;
  status.textContent = 'The sandbox could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}
