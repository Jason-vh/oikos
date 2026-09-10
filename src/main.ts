import * as T from 'three';
import { Stage } from './render/stage';
import { CityScene } from './render/city';
import { BUILDINGS, footprint, ROAD_COST } from './sim/catalog';
import { CELL_SIZE, GROUND_Y, MAP_DEPTH, MAP_WIDTH, terrainAt, tileIndex, worldPosition } from './sim/island';
import { advance, build, buildingStatus, createWorld, demolish, getSummary, placement, placeRoadPath, setVendor, walkerName, walkerStatus, WALKER_ROLES } from './sim/world';
import { deserializeWorld, serializeWorld } from './sim/save';
import type { ActionResult, Placement, Rotation, Tile, Tool } from './sim/types';
import { createHud } from './ui/hud';
import './ui/style.css';

const SAVE_KEY = 'oikos.island.v1';
const DEFAULT_VIEW = { target: [0, 0, 0], offset: [35, 38, 48], size: 43 };

function boot(): void {
  let world = createWorld();
  let storageWarning = '';
  let autoSaveEnabled = true;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const saved = deserializeWorld(raw);
      if (saved) world = saved;
      else {
        autoSaveEnabled = false;
        storageWarning = 'Saved island could not be read. A fresh island is open; Save will replace the old file.';
      }
    }
  } catch {
    autoSaveEnabled = false;
    storageWarning = 'Browser storage is unavailable. This island cannot be saved.';
  }
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  stage.setView(DEFAULT_VIEW);
  const city = new CityScene(stage);
  let tool: Tool = 'inspect';
  let rotation: Rotation = 0;
  let speed: 0 | 1 | 3 = 1;
  let selectedId: number | null = null;
  let hover: Tile | null = null;
  let drag: { tile: Tile; x: number; y: number; pointer: number } | null = null;
  let accumulator = 0;
  let dirtySave = false;
  let showGrid = false;
  let artTime = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function refresh(): void {
    const selected = world.buildings.find((building) => building.id === selectedId) ?? null;
    const walker = selected ? null : world.walkers.find((candidate) => candidate.id === selectedId) ?? null;
    city.sync(world);
    city.select(selected, walker?.id ?? null);
    if (walker) hud.update(world, getSummary(world), { kind: 'person', name: walkerName(walker), role: WALKER_ROLES[walker.kind], status: walkerStatus(world, walker) });
    else if (selected) hud.update(world, getSummary(world), { kind: 'building', building: selected, status: buildingStatus(world, selected) });
    else hud.update(world, getSummary(world), null);
  }

  function selectTool(next: Tool): void {
    tool = next;
    drag = null;
    hud.setTool(tool, rotation);
    stage.controls.touches.ONE = tool === 'inspect' ? T.TOUCH.ROTATE : null;
    city.scenery.grid.visible = showGrid || tool !== 'inspect';
    updatePreview();
    stage.invalidate();
  }

  function setGrid(enabled: boolean): void {
    showGrid = enabled;
    city.scenery.grid.visible = enabled || tool !== 'inspect';
    hud.setGrid(enabled);
    stage.invalidate();
  }

  function setSpeed(next: 0 | 1 | 3): void {
    speed = next;
    accumulator = 0;
    hud.setSpeed(speed);
  }

  function save(manual = true): void {
    if (!manual && !autoSaveEnabled) return;
    try {
      localStorage.setItem(SAVE_KEY, serializeWorld(world));
      dirtySave = false;
      autoSaveEnabled = true;
      if (manual) hud.notify('Island saved.');
    } catch {
      autoSaveEnabled = false;
      hud.notify('Could not save. Browser storage may be full or unavailable.', true);
    }
  }

  const hud = createHud(document.querySelector<HTMLElement>('#ui')!, {
    tool: selectTool,
    rotate: () => { rotation = ((rotation + 1) % 4) as Rotation; hud.setTool(tool, rotation); updatePreview(); },
    speed: setSpeed,
    save: () => save(),
    load: () => {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        const saved = raw ? deserializeWorld(raw) : null;
        if (!saved) { hud.notify('No valid saved island found. Your current island is unchanged.', true); return; }
        world = saved;
        selectedId = null;
        accumulator = 0;
        dirtySave = false;
        autoSaveEnabled = true;
        refresh();
        updatePreview();
        hud.notify('Saved island restored.');
      } catch { hud.notify('Browser storage is unavailable.', true); }
    },
    newIsland: () => {
      world = createWorld();
      selectedId = null;
      accumulator = 0;
      stage.setView(DEFAULT_VIEW);
      selectTool('inspect');
      setSpeed(1);
      refresh();
      save(false);
      hud.notify('A new beginning. Build four dwellings beside the road.');
    },
    vendor: (id, enabled) => apply(setVendor(world, id, enabled)),
    focus: (x, z) => { const point = worldPosition(x + .5, z + .5); stage.focus(point.x, point.z); },
    grid: setGrid,
  });

  function apply(result: ActionResult): void {
    hud.notify(result.reason, !result.ok);
    if (result.ok) {
      dirtySave = true;
      refresh();
      updatePreview();
    }
  }

  function atPointer(event: PointerEvent): Tile | null {
    const point = stage.pick(event.clientX, event.clientY, GROUND_Y);
    if (!point) return null;
    return { x: Math.floor(point.x / CELL_SIZE + MAP_WIDTH / 2), z: Math.floor(point.z / CELL_SIZE + MAP_DEPTH / 2) };
  }

  function roadPath(): Tile[] {
    if (!hover) return [];
    const start = drag?.tile ?? hover;
    const tiles: Tile[] = [];
    const dx = Math.sign(hover.x - start.x);
    const dz = Math.sign(hover.z - start.z);
    for (let x = start.x; x !== hover.x; x += dx) tiles.push({ x, z: start.z });
    for (let z = start.z; z !== hover.z; z += dz) tiles.push({ x: hover.x, z });
    tiles.push(hover);
    return tiles;
  }

  function roadPreview(): Placement {
    const path = roadPath();
    const checks = path.map((tile) => placement(world, 'road', tile.x, tile.z));
    const cost = checks.reduce((sum, check) => sum + check.cost, 0);
    const failed = checks.find((check) => !check.ok);
    return { ok: !failed && cost <= world.money, reason: failed?.reason ?? (cost > world.money ? 'Not enough drachmas.' : `Road · ${cost} drachmas`), cost, tiles: path.filter((tile) => tile.x >= 0 && tile.x < MAP_WIDTH && tile.z >= 0 && tile.z < MAP_DEPTH).map((tile) => tileIndex(tile.x, tile.z)) };
  }

  function updatePreview(): void {
    if (!hover || tool === 'inspect') {
      city.hidePreview();
      hud.setHint('Click a building to inspect · Right-drag to pan · Scroll to zoom · Q rotates the view');
      return;
    }
    if (tool === 'demolish') {
      const building = world.buildings.find((candidate) => {
        const size = footprint(candidate.kind, candidate.rotation);
        return hover!.x >= candidate.x && hover!.x < candidate.x + size.width && hover!.z >= candidate.z && hover!.z < candidate.z + size.depth;
      });
      const tiles: number[] = [];
      if (building) {
        const size = footprint(building.kind, building.rotation);
        for (let z = building.z; z < building.z + size.depth; z++) {
          for (let x = building.x; x < building.x + size.width; x++) tiles.push(tileIndex(x, z));
        }
      } else tiles.push(tileIndex(hover.x, hover.z));
      city.showPreview(tool, hover.x, hover.z, rotation, { ok: false, reason: '', tiles, cost: 0 });
      hud.setHint('Click to demolish · Buildings refund half their cost; roads none · Escape cancels');
      return;
    }
    const preview = tool === 'road' ? roadPreview() : placement(world, tool, hover.x, hover.z, rotation);
    city.showPreview(tool, hover.x, hover.z, rotation, preview);
    let hint = preview.reason;
    if (preview.ok && tool !== 'road') hint = `${BUILDINGS[tool].name} · ${preview.cost} drachmas · R to rotate · Escape cancels`;
    hud.setHint(hint);
  }

  stage.canvas.addEventListener('pointerdown', (event) => {
    stage.controls.mouseButtons.LEFT = event.altKey ? T.MOUSE.ROTATE : null;
  }, true);
  stage.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.altKey || !event.isPrimary) return;
    hover = atPointer(event);
    if (!hover) return;
    drag = { tile: hover, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    stage.canvas.setPointerCapture(event.pointerId);
    updatePreview();
  });
  stage.canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary || event.altKey || event.buttons === 2) return;
    hover = atPointer(event);
    updatePreview();
  });
  stage.canvas.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    hover = atPointer(event);
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (hover && (tool === 'road' || moved < 9)) {
      if (tool === 'inspect' || tool === 'demolish') {
        const picked = city.pick(event.clientX, event.clientY);
        const hit = world.buildings.find((building) => building.id === picked.building);
        if (tool === 'inspect') {
          selectedId = picked.walker ?? picked.building;
          refresh();
        } else apply(demolish(world, hit?.x ?? hover.x, hit?.z ?? hover.z));
      } else if (tool === 'road') apply(placeRoadPath(world, roadPath()));
      else {
        const result = build(world, tool, hover.x, hover.z, rotation);
        if (result.ok) selectedId = world.buildings.find((building) => building.x === hover!.x && building.z === hover!.z)?.id ?? null;
        apply(result);
      }
    }
    drag = null;
    updatePreview();
  });
  stage.canvas.addEventListener('pointercancel', () => { drag = null; city.hidePreview(); });
  stage.canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; city.hidePreview(); } });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,dialog') || event.target.isContentEditable)) return;
    const keys: Record<string, Tool> = { '1': 'road', '2': 'house', '3': 'farm', '4': 'granary', '5': 'agora', '6': 'fountain', '7': 'maintenance', x: 'demolish' };
    if (event.key === 'Escape') {
      escapeOpensMenu = tool === 'inspect';
      if (!escapeOpensMenu) selectTool('inspect');
    } else if (keys[event.key]) selectTool(keys[event.key]);
    else if (event.key.toLowerCase() === 'g') setGrid(!showGrid);
    else if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); setSpeed(speed === 0 ? 1 : 0); }
    else if (event.key.toLowerCase() === 'r') { rotation = ((rotation + 1) % 4) as Rotation; hud.setTool(tool, rotation); updatePreview(); }
    else if (event.key.toLowerCase() === 'q') stage.rotate();
  });

  let escapeOpensMenu = false;
  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Escape' || !escapeOpensMenu) return;
    escapeOpensMenu = false;
    if (event.target instanceof HTMLElement && event.target.closest('dialog')) return;
    hud.toggleMenu();
  });

  let previous = 0;
  let lastRender = 0;
  let lastSave = 0;
  let lastShadow = 0;
  let visualDelta = 0;
  function frame(now: number): void {
    const delta = previous === 0 || document.hidden ? 0 : Math.min((now - previous) / 1000, .25);
    previous = now;
    if (speed > 0 && !document.hidden) {
      accumulator += delta * speed;
      let changed = false;
      while (accumulator >= .25) {
        advance(world, .25);
        accumulator -= .25;
        changed = true;
      }
      if (changed) {
        dirtySave = true;
        refresh();
        if (reducedMotion) city.animate(0, .25, 1);
      }
      visualDelta += delta;
      if (now - lastRender >= 1000 / 30) {
        if (!reducedMotion) {
          artTime += visualDelta;
          city.animate(artTime, visualDelta, speed);
        }
        visualDelta = 0;
        lastRender = now;
      }
      if (world.walkers.length && now - lastShadow > 150) { stage.shadows(); lastShadow = now; }
    }
    if (now - lastSave >= 5000) {
      if (dirtySave) save(false);
      lastSave = now;
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { previous = 0; if (!document.hidden) stage.invalidate(); });
  window.addEventListener('pagehide', () => { if (dirtySave) save(false); });
  selectTool('inspect');
  hud.setSpeed(speed);
  refresh();
  stage.shadows();
  if (storageWarning) hud.notify(storageWarning, true);
  requestAnimationFrame(frame);

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    Reflect.set(window, 'oikos', {
      get state() { return structuredClone(world); },
      get summary() { return getSummary(world); },
      get frames() { return stage.frames; },
      get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; },
      projectTile: (x: number, z: number) => { const p = worldPosition(x + .5, z + .5); return stage.project(p.x, GROUND_Y, p.z); },
      projectBuilding: (id: number) => {
        const building = world.buildings.find((candidate) => candidate.id === id);
        if (!building) return null;
        const size = footprint(building.kind, building.rotation);
        const p = worldPosition(building.x + size.width / 2, building.z + size.depth / 2);
        return stage.project(p.x, GROUND_Y + 1.5, p.z);
      },
      advance: (seconds: number) => { setSpeed(0); advance(world, seconds); refresh(); dirtySave = true; stage.shadows(); },
      terrainAt,
      roadCost: ROAD_COST,
      saveKey: SAVE_KEY,
    });
  }
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The island could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}
