import * as T from 'three';
import { Stage } from './render/stage';
import type { View } from './render/stage';
import { CityScene } from './render/city';
import { ConstructionOverlay } from './render/construction';
import { BUILDINGS, footprint, ROAD_COST } from './sim/catalog';
import { demolitionPreview, footprintTileIssues, harbourRoute, suitableFarmGround } from './sim/construction';
import { CELL_SIZE, groundHeight, islandFor, nextArchipelagoSeed, terrainOn, tileIndexOn, worldPositionOn, GROUND_Y } from './sim/island';
import { roadHeight, stairLayout } from './sim/stairs';
import { advance, buildingStatus, createWorld, getSummary, placement, roadPathPlacement, walkerName, walkerStatus, WALKER_ROLES } from './sim/world';
import { deserializeWorld, savedBeforeArchipelago, serializeWorld } from './sim/save';
import { animalName, animalStatus } from './sim/wildlife';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './sim/scenario';
import type { ActionResult, Building, BuildTool, City, Placement, Rotation, Tile, Tool, Walker } from './sim/types';
import { createHud, type CityScope } from './ui/hud';
import { AUTOSAVE_KEY, islandFilename, readCheckpoint, writeAutosave, writeCheckpoint } from './ui/save-slots';
import { createSound } from './ui/sound';
import { celebration, cityMilestones, NO_MILESTONES, rememberMilestones } from './ui/celebrations';
import { parseView, VIEW_KEY } from './ui/view';
import { canUndoConstruction, undoConstruction } from './sim/history';
import { foundingPlacement } from './sim/founding';
import type { CityCommand } from './sim/commands';
import { activeCity, bootstrapCityContext, canWrite, resolveCity, submitCityCommand, viewedCity, withPersistence, withViewed } from './ui/city-context';
import './ui/style.css';

const SAVE_KEY = AUTOSAVE_KEY;

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
        storageWarning = savedBeforeArchipelago(raw)
          ? 'The sea opened up: a city built on the single island cannot be moved to the archipelago. A fresh map is open; Save will replace the old file.'
          : 'Saved island could not be read. A fresh island is open; Save will replace the old file.';
      }
    }
  } catch {
    autoSaveEnabled = false;
    storageWarning = 'Browser storage is unavailable. This island cannot be saved.';
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  stage.reducedMotion = reducedMotion;
  let context = bootstrapCityContext(world);
  const cameraMemory = new Map<number, View>();
  function mapFor(home: City | null): ReturnType<typeof islandFor> {
    return home ? islandFor(world.seed, home.home) : islandFor(world.seed);
  }
  let city = new CityScene(stage, mapFor(activeCity(world, context)), !reducedMotion);
  let overlay = new ConstructionOverlay(stage, mapFor(activeCity(world, context)));
  const map = () => city.map;
  function viewFor(homeCity: City): { target: number[]; offset: number[]; size: number } {
    const island = islandFor(world.seed, homeCity.home);
    const harbour = worldPositionOn(island, island.entry.x + .5, island.entry.z - 7);
    return { target: [harbour.x, GROUND_Y, harbour.z], offset: [35, 38, 48], size: 36 };
  }
  function seaBounds(seed: number): number {
    const island = islandFor(seed);
    return Math.max(island.width, island.depth) * CELL_SIZE / 2 + 20;
  }
  stage.bounds(seaBounds(world.seed));
  const initialActive = activeCity(world, context);
  if (initialActive) stage.setView(viewFor(initialActive));
  try {
    const saved = parseView(localStorage.getItem(VIEW_KEY), world.seed, initialActive?.home);
    if (saved) stage.setView(saved);
  } catch {}
  function rebuildScene(): void {
    city.dispose();
    stage.bounds(seaBounds(world.seed));
    const home = activeCity(world, context);
    city = new CityScene(stage, mapFor(home), !reducedMotion);
    city.watch(stage.controls.target, stage.viewSpan());
    overlay.dispose();
    overlay = new ConstructionOverlay(stage, mapFor(home));
    if (home) stage.setView(viewFor(home));
    stage.shadows();
  }
  let tool: Tool = 'inspect';
  let rotation: Rotation = 0;
  let speed: 0 | 1 | 3 = 1;
  let selectedId: number | null = null;
  let hover: Tile | null = null;
  let drag: { tile: Tile; x: number; y: number; pointer: number } | null = null;
  let bendVertical = false;
  let accumulator = 0;
  let dirtySave = false;
  let showGrid = false;
  let artTime = 0;
  let inDebt = false;
  let menuSpeed: 0 | 1 | 3 | null = null;
  let importing = false;
  let undoCheckpoint: typeof world | null = null;
  let milestones = initialActive ? cityMilestones(initialActive) : NO_MILESTONES;
  const sound = createSound();
  window.addEventListener('pointerdown', sound.unlock, { capture: true });
  window.addEventListener('keydown', sound.unlock, { capture: true });
  const panVelocity = { right: 0, forward: 0 };

  function findBuildingOwner(id: number | null): { city: City; building: Building } | null {
    if (id === null) return null;
    for (const candidate of world.cities) {
      if (candidate.harbour.id === id) return { city: candidate, building: candidate.harbour };
      const building = candidate.buildings.find((b) => b.id === id);
      if (building) return { city: candidate, building };
    }
    return null;
  }

  function findWalkerOwner(id: number | null): { city: City; walker: Walker } | null {
    if (id === null) return null;
    for (const candidate of world.cities) {
      const walker = candidate.walkers.find((w) => w.id === id);
      if (walker) return { city: candidate, walker };
    }
    return null;
  }

  function scopeOf(target: City | null): CityScope | null {
    return target ? { city: target, summary: getSummary(target) } : null;
  }

  function refresh(): void {
    const viewed = viewedCity(world, context);
    const active = activeCity(world, context);
    const found = findBuildingOwner(selectedId);
    const foundWalker = found ? null : findWalkerOwner(selectedId);
    const animal = found || foundWalker ? null : world.wildlife.find((candidate) => candidate.id === selectedId) ?? null;
    city.sync(world);
    overlay.setRoads(active?.roads ?? []);
    city.select(found?.building ?? null, foundWalker?.walker.id ?? animal?.id ?? null);
    const viewedScope = scopeOf(viewed);
    const activeScope = scopeOf(active);
    if (foundWalker) hud.update(world, viewedScope, activeScope, { kind: 'person', name: walkerName(foundWalker.walker), role: WALKER_ROLES[foundWalker.walker.kind], status: walkerStatus(foundWalker.city, foundWalker.walker) });
    else if (animal) hud.update(world, viewedScope, activeScope, { kind: 'person', name: animalName(animal), role: 'Wildlife', status: animalStatus(animal) });
    else if (found) hud.update(world, viewedScope, activeScope, { kind: 'building', building: found.building, status: buildingStatus(found.city, found.building), editable: canWrite(world, context) && found.city.id === active?.id });
    else hud.update(world, viewedScope, activeScope, null);
    hud.setCities(world.cities.map((candidate) => ({ id: candidate.id, label: candidate.id === active?.id ? 'Your city' : `City ${candidate.id}` })), context.viewedId);
    const debt = (active?.money ?? 0) < 0;
    if (debt && !inDebt) hud.notify('The treasury is in debt: upkeep outweighs income.', true);
    inDebt = debt;
    if (active) {
      const nextMilestones = cityMilestones(active);
      const event = celebration(milestones, nextMilestones);
      milestones = rememberMilestones(milestones, nextMilestones);
      if (event) {
        hud.notify(event.message);
        sound.play(event.sound);
      }
    }
    hud.setUndo(canUndoConstruction(world, undoCheckpoint));
  }

  function selectTool(next: Tool): void {
    if (next !== 'inspect') {
      if (!canWrite(world, context)) { hud.notify('Viewing another city grants no writes.', true); return; }
      const home = activeCity(world, context);
      if (!home || !home.founded) { hud.notify('Place your founding harbour first.', true); return; }
    }
    tool = next;
    drag = null;
    hud.setTool(tool, rotation);
    stage.controls.touches.ONE = tool === 'inspect' ? T.TOUCH.ROTATE : null;
    const home = activeCity(world, context);
    city.scenery.grid.visible = !(home?.founded ?? false) || showGrid || tool !== 'inspect';
    updatePreview();
    stage.invalidate();
  }

  function setGrid(enabled: boolean): void {
    showGrid = enabled;
    const home = activeCity(world, context);
    city.scenery.grid.visible = !(home?.founded ?? false) || enabled || tool !== 'inspect';
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
      if (manual) writeCheckpoint(localStorage, world);
      writeAutosave(localStorage, world);
      dirtySave = false;
      autoSaveEnabled = true;
      hud.setSaved();
      if (manual) hud.notify('Checkpoint saved. Autosaves will not replace it.');
    } catch {
      autoSaveEnabled = false;
      hud.notify('Could not save. Browser storage may be full or unavailable.', true);
    }
  }

  function restore(saved: typeof world): void {
    const previousSeed = world.seed;
    const previousHome = activeCity(world, context)?.home;
    world = saved;
    context = bootstrapCityContext(world);
    cameraMemory.clear();
    undoCheckpoint = null;
    const active = activeCity(world, context);
    milestones = active ? cityMilestones(active) : NO_MILESTONES;
    selectedId = null;
    hover = null;
    accumulator = 0;
    dirtySave = true;
    autoSaveEnabled = true;
    if (world.seed !== previousSeed || active?.home !== previousHome) rebuildScene();
    else city.reload(world);
    selectTool('inspect');
    setSpeed(0);
    refresh();
    save(false);
  }

  function switchView(id: number): boolean {
    if (id === context.viewedId) return false;
    const target = resolveCity(world, id);
    if (!target) return false;
    if (context.viewedId !== null) cameraMemory.set(context.viewedId, stage.getView());
    context = withViewed(context, id);
    selectedId = null;
    hover = null;
    drag = null;
    selectTool('inspect');
    stage.setView(cameraMemory.get(id) ?? viewFor(target));
    return true;
  }

  function viewCity(id: number): void {
    if (!switchView(id)) return;
    refresh();
    updatePreview();
  }

  function focusVillage(): void {
    if (context.activeId !== null && switchView(context.activeId)) {
      refresh();
      updatePreview();
    }
    const home = activeCity(world, context);
    if (!home) return;
    const dwellings = home.buildings.filter((building) => building.kind === 'house');
    if (dwellings.length === 0) {
      const view = viewFor(home);
      stage.focus(view.target[0], view.target[2]);
      return;
    }
    const x = dwellings.reduce((sum, dwelling) => sum + dwelling.x + 1.5, 0) / dwellings.length;
    const z = dwellings.reduce((sum, dwelling) => sum + dwelling.z + 1.5, 0) / dwellings.length;
    const point = worldPositionOn(map(), x, z);
    stage.focus(point.x, point.z);
  }

  const hud = createHud(document.querySelector<HTMLElement>('#ui')!, {
    tool: selectTool,
    rotate: () => { rotation = ((rotation + 1) % 4) as Rotation; hud.setTool(tool, rotation); updatePreview(); },
    speed: setSpeed,
    save: () => save(),
    load: () => {
      try {
        const saved = readCheckpoint(localStorage);
        if (!saved) { hud.notify('No valid checkpoint found. Your current island is unchanged.', true); return; }
        restore(saved);
        hud.notify('Checkpoint restored. Paused for you to look around.');
      } catch { hud.notify('Browser storage is unavailable.', true); }
    },
    newIsland: (home) => {
      const seed = nextArchipelagoSeed(world.seed);
      world = createWorld(seed, home, false);
      context = bootstrapCityContext(world);
      cameraMemory.clear();
      undoCheckpoint = null;
      const active = activeCity(world, context);
      milestones = active ? cityMilestones(active) : NO_MILESTONES;
      autoSaveEnabled = true;
      selectedId = null;
      hover = null;
      accumulator = 0;
      rebuildScene();
      selectTool('inspect');
      setSpeed(1);
      refresh();
      save(false);
      hud.notify(`Island ${(active?.home ?? 0) + 1} awaits. Place your harbour beside the landing road.`);
    },
    vendor: (id, enabled) => apply(submitCityCommand(world, context, { type: 'vendor', id, enabled })),
    focus: (x, z) => { const point = worldPositionOn(map(), x + .5, z + .5); stage.focus(point.x, point.z); },
    grid: setGrid,
    home: focusVillage,
    undo: undoLastConstruction,
    menu: (open) => {
      if (open) {
        if (menuSpeed === null) menuSpeed = speed;
        setSpeed(0);
        held.clear();
        panVelocity.right = 0;
        panVelocity.forward = 0;
        drag = null;
      } else if (menuSpeed !== null) {
        const previousSpeed = menuSpeed;
        menuSpeed = null;
        setSpeed(previousSpeed);
      }
    },
    sound: (enabled) => { sound.setEnabled(enabled); hud.setSound(enabled); },
    export: () => {
      const url = URL.createObjectURL(new Blob([serializeWorld(world)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = islandFilename(world);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    import: async (file) => {
      if (importing) return;
      if (file.size > 5_000_000) { hud.notify('That file is too large to be an island save.', true); return; }
      importing = true;
      const previousSpeed = speed;
      setSpeed(0);
      try {
        const saved = deserializeWorld(await file.text());
        if (!saved) {
          hud.notify('That island could not be read. Your current island is unchanged.', true);
          setSpeed(previousSpeed);
          return;
        }
        restore(saved);
        hud.notify('Island imported. Your checkpoint is unchanged.');
      } catch {
        hud.notify('Could not read that file. Your current island is unchanged.', true);
        setSpeed(previousSpeed);
      } finally {
        importing = false;
      }
    },
    visit: viewCity,
  });

  function apply(result: ActionResult): void {
    hud.notify(result.reason, !result.ok);
    if (!result.ok) sound.play('error');
    else if (tool === 'road') sound.play('road');
    else if (tool === 'demolish') sound.play('remove');
    else sound.play('build');
    if (result.ok) {
      undoCheckpoint = null;
      dirtySave = true;
      refresh();
      updatePreview();
    }
  }

  function construct(command: CityCommand): ActionResult {
    const before = structuredClone(world);
    const result = submitCityCommand(world, context, command);
    apply(result);
    if (result.ok) {
      undoCheckpoint = before;
      hud.setUndo(true);
    }
    return result;
  }

  function undoLastConstruction(): void {
    const restored = undoConstruction(world, undoCheckpoint);
    if (!restored) return;
    world = restored;
    undoCheckpoint = null;
    selectedId = null;
    dirtySave = true;
    refresh();
    updatePreview();
    sound.play('remove');
    hud.notify('Construction undone.');
  }

  function atPointer(event: PointerEvent): Tile | null {
    return city.tileAtPointer(event.clientX, event.clientY);
  }

  function roadPath(): Tile[] {
    if (!hover) return [];
    const start = drag?.tile ?? hover;
    const tiles: Tile[] = [];
    const dx = Math.sign(hover.x - start.x);
    const dz = Math.sign(hover.z - start.z);
    if (bendVertical) {
      for (let z = start.z; z !== hover.z; z += dz) tiles.push({ x: start.x, z });
      for (let x = start.x; x !== hover.x; x += dx) tiles.push({ x, z: hover.z });
    } else {
      for (let x = start.x; x !== hover.x; x += dx) tiles.push({ x, z: start.z });
      for (let z = start.z; z !== hover.z; z += dz) tiles.push({ x: hover.x, z });
    }
    tiles.push(hover);
    return tiles;
  }

  function insideMap(tile: Tile): boolean {
    return tile.x >= 0 && tile.x < map().width && tile.z >= 0 && tile.z < map().depth;
  }

  function roadPreview(homeCity: City): Placement {
    const path = roadPath();
    const preview = roadPathPlacement(world, homeCity, path);
    const tiles = path.filter(insideMap).map((tile) => tileIndexOn(map(), tile.x, tile.z));
    const reason = preview.ok ? `Road · ${preview.cost} drachmas` : preview.reason;
    return { ...preview, reason, tiles };
  }

  function updatePreview(pointer: { x: number; y: number } | null = null): void {
    if (!canWrite(world, context)) {
      city.hidePreview();
      city.clearHover();
      overlay.setFertileGround(null);
      overlay.setBlockedTiles([]);
      overlay.setDemolitionTarget([]);
      overlay.setHarbourRoute(null);
      stage.canvas.style.cursor = '';
      hud.setHint(context.activeId === null ? 'You have no city of your own here.' : 'Visiting another city · read-only. H returns home.');
      if (pointer && !drag && city.hover(pointer.x, pointer.y, world)) stage.canvas.style.cursor = 'pointer';
      return;
    }
    const homeCity = activeCity(world, context)!;
    if (!homeCity.founded) {
      const site = hover ?? homeCity.harbour;
      const preview = foundingPlacement(world, homeCity, site.x, site.z);
      city.showPreview('harbour', site.x, site.z, 0, preview, homeCity.roads);
      city.clearHover();
      overlay.setFertileGround(null);
      overlay.setBlockedTiles([]);
      overlay.setDemolitionTarget([]);
      overlay.setHarbourRoute(preview.ok ? harbourRoute(world, homeCity, preview.tiles) : null);
      stage.canvas.style.cursor = preview.ok ? 'crosshair' : 'not-allowed';
      hud.setHint(preview.ok ? 'Found your city here · Harbour is free · H returns to the landing · Escape opens the menu' : preview.reason);
      return;
    }
    overlay.setFertileGround(tool === 'farm' ? suitableFarmGround(world, homeCity) : null);
    stage.canvas.style.cursor = tool === 'inspect' ? '' : 'crosshair';
    if (tool !== 'inspect') city.clearHover();
    if (!hover || tool === 'inspect') {
      city.hidePreview();
      overlay.setBlockedTiles([]);
      overlay.setHarbourRoute(null);
      overlay.setDemolitionTarget([]);
      hud.setHint('Click anything to inspect · WASD pans · Scroll zooms · Q rotates');
      if (tool === 'inspect' && pointer && !drag && city.hover(pointer.x, pointer.y, world)) stage.canvas.style.cursor = 'pointer';
      return;
    }
    if (tool === 'demolish') {
      const found = demolitionPreview(world, homeCity, hover.x, hover.z);
      overlay.setBlockedTiles([]);
      overlay.setHarbourRoute(null);
      overlay.setDemolitionTarget(found?.footprint ?? []);
      city.showPreview(tool, hover.x, hover.z, rotation, { ok: false, reason: '', tiles: [], cost: 0 }, homeCity.roads);
      if (!found) hud.setHint('Nothing to demolish here · Escape cancels');
      else if (found.kind === 'road') hud.setHint('Demolish this road · no refund · Escape cancels');
      else hud.setHint(`Demolish the ${BUILDINGS[found.kind].name.toLowerCase()} · refunds ${found.refund} drachmas · Escape cancels`);
      return;
    }
    if (tool === 'road') {
      const preview = roadPreview(homeCity);
      city.showPreview(tool, hover.x, hover.z, rotation, preview, homeCity.roads);
      overlay.setBlockedTiles([]);
      overlay.setDemolitionTarget([]);
      overlay.setHarbourRoute(preview.ok ? harbourRoute(world, homeCity, preview.tiles) : null);
      if (!preview.ok) stage.canvas.style.cursor = 'not-allowed';
      hud.setHint(`${preview.reason} · Hold Shift to bend the other way · Escape cancels`);
      return;
    }
    const preview = placement(world, homeCity, tool, hover.x, hover.z, rotation);
    const issues = footprintTileIssues(world, homeCity, tool, hover.x, hover.z, rotation);
    const validTiles = issues.filter((tile) => !tile.blocked);
    const invalidTiles = issues.filter((tile) => tile.blocked && insideMap(tile));
    city.showPreview(tool, hover.x, hover.z, rotation, { ...preview, ok: true, tiles: validTiles.map((tile) => tileIndexOn(map(), tile.x, tile.z)) }, homeCity.roads);
    overlay.setBlockedTiles(invalidTiles);
    overlay.setDemolitionTarget([]);
    overlay.setHarbourRoute(harbourRoute(world, homeCity, validTiles.map((tile) => tileIndexOn(map(), tile.x, tile.z))));
    if (!preview.ok) stage.canvas.style.cursor = 'not-allowed';
    hud.setHint(preview.ok ? `${BUILDINGS[tool].name} · ${preview.cost} drachmas · R to rotate · Escape cancels` : preview.reason);
  }

  stage.canvas.addEventListener('pointerdown', (event) => {
    stage.controls.mouseButtons.LEFT = event.altKey ? T.MOUSE.ROTATE : null;
  }, true);
  stage.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.altKey || !event.isPrimary) return;
    hover = atPointer(event);
    if (!hover) return;
    bendVertical = event.shiftKey;
    drag = { tile: hover, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    stage.canvas.setPointerCapture(event.pointerId);
    updatePreview();
  });
  stage.canvas.addEventListener('pointermove', (event) => {
    if (!event.isPrimary || event.altKey || event.buttons === 2) return;
    hover = atPointer(event);
    bendVertical = event.shiftKey;
    updatePreview({ x: event.clientX, y: event.clientY });
  });
  stage.canvas.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    hover = atPointer(event);
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (hover && (tool === 'road' || moved < 9)) {
      const home = canWrite(world, context) ? activeCity(world, context) : null;
      if (home && !home.founded) {
        const result = submitCityCommand(world, context, { type: 'foundHarbour', x: hover.x, z: hover.z });
        apply(result);
        if (result.ok) {
          selectedId = home.harbour.id;
          selectTool('inspect');
          refresh();
          save(false);
        }
      } else if (!home || tool === 'inspect') {
        const picked = city.pick(event.clientX, event.clientY);
        selectedId = picked.walker ?? picked.animal ?? picked.building;
        refresh();
      } else if (tool === 'demolish') {
        const picked = city.pick(event.clientX, event.clientY);
        const hit = home.buildings.find((building) => building.id === picked.building);
        construct({ type: 'demolish', x: hit?.x ?? hover.x, z: hit?.z ?? hover.z });
      } else if (tool === 'road') construct({ type: 'roadPath', tiles: roadPath() });
      else {
        const buildingTool = tool;
        const result = construct({ type: 'build', tool: buildingTool, x: hover.x, z: hover.z, rotation });
        if (result.ok) {
          selectedId = home.buildings.find((building) => building.x === hover!.x && building.z === hover!.z)?.id ?? null;
          refresh();
        }
      }
    }
    drag = null;
    updatePreview();
  });
  stage.canvas.addEventListener('pointercancel', () => { drag = null; city.hidePreview(); });
  stage.canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; city.hidePreview(); city.clearHover(); } });
  const held = new Set<string>();
  const PAN_KEYS: Record<string, [number, number]> = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  window.addEventListener('keyup', (event) => held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
  window.addEventListener('blur', () => { held.clear(); bendVertical = false; });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,dialog') || event.target.isContentEditable)) return;
    const panKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (PAN_KEYS[panKey] && !event.metaKey && !event.ctrlKey && !event.altKey) {
      held.add(panKey);
      event.preventDefault();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,dialog') || event.target.isContentEditable)) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoLastConstruction();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys: Record<string, Tool> = { '1': 'road', '2': 'house', '3': 'farm', '4': 'granary', '5': 'agora', '6': 'fountain', '7': 'maintenance', '8': 'lodge', '9': 'woodcutter', '0': 'stockpile', x: 'demolish' };
    if (event.key === 'Escape') {
      escapeOpensMenu = tool === 'inspect';
      if (!escapeOpensMenu) selectTool('inspect');
    } else if (keys[event.key]) selectTool(keys[event.key]);
    else if (event.key.toLowerCase() === 'g') setGrid(!showGrid);
    else if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); setSpeed(speed === 0 ? 1 : 0); }
    else if (event.key.toLowerCase() === 'r') { rotation = ((rotation + 1) % 4) as Rotation; hud.setTool(tool, rotation); updatePreview(); }
    else if (event.key.toLowerCase() === 'q') stage.rotate();
    else if (event.key.toLowerCase() === 'h') focusVillage();
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
  let visualDelta = 0;
  function frame(now: number): void {
    const delta = previous === 0 || document.hidden ? 0 : Math.min((now - previous) / 1000, .25);
    previous = now;
    let right = 0;
    let forward = 0;
    for (const key of held) {
      right += PAN_KEYS[key][0];
      forward += PAN_KEYS[key][1];
    }
    const ease = 1 - Math.exp(-delta * 12);
    panVelocity.right += (Math.sign(right) - panVelocity.right) * ease;
    panVelocity.forward += (Math.sign(forward) - panVelocity.forward) * ease;
    if (Math.abs(panVelocity.right) < .002) panVelocity.right = 0;
    if (Math.abs(panVelocity.forward) < .002) panVelocity.forward = 0;
    stage.pan(panVelocity.right * delta * .9, panVelocity.forward * delta * .9);
    stage.update(delta);
    city.watch(stage.controls.target, stage.viewSpan());
    city.transitions(delta);
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
        if (reducedMotion) {
          city.animate(0, .25, 1);
          stage.shadows();
        }
      }
      visualDelta += delta;
      if (now - lastRender >= 1000 / 30) {
        if (!reducedMotion) {
          artTime += visualDelta;
          city.animate(artTime, visualDelta, speed);
          stage.shadowsFromMotion();
        }
        visualDelta = 0;
        lastRender = now;
      }
    }
    if (now - lastSave >= 5000) {
      if (dirtySave) save(false);
      lastSave = now;
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { previous = 0; if (!document.hidden) stage.invalidate(); });
  function saveView(): void {
    try {
      const active = activeCity(world, context);
      if (!active) return;
      const view = context.viewedId === context.activeId ? stage.getView() : cameraMemory.get(active.id);
      if (!view) return;
      localStorage.setItem(VIEW_KEY, JSON.stringify({ seed: world.seed, home: active.home, view }));
    } catch {}
  }
  window.addEventListener('pagehide', () => { if (dirtySave) save(false); saveView(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveView(); });
  selectTool('inspect');
  hud.setSpeed(speed);
  hud.setSound(sound.enabled);
  refresh();
  city.watch(stage.controls.target, stage.viewSpan());
  stage.shadows();
  if (storageWarning) hud.notify(storageWarning, true);
  requestAnimationFrame(frame);

  function debugCommand(raw: unknown): ActionResult {
    return withPersistence(submitCityCommand(world, context, raw), () => { refresh(); save(true); });
  }

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    Reflect.set(window, 'oikos', {
      get state() { return structuredClone(world); },
      freshWorld: (seed: number, home: number, founded = true) => createWorld(seed, home, founded),
      get summary() { const home = activeCity(world, context); return home ? getSummary(home) : { population: 0, workers: 0, jobs: 0, food: 0, income: 0, upkeep: 0, balance: 0, prosperous: 0, goal: false }; },
      get frames() { return stage.frames; },
      get drawCalls() { return stage.renderer.info.render.calls; },
      get sceneBudget() {
        const tally: Record<string, { meshes: number; triangles: number }> = {};
        stage.scene.traverse((object) => {
          const mesh = object as T.InstancedMesh;
          if (!(mesh as T.Mesh).isMesh) return;
          const position = mesh.geometry.getAttribute('position');
          if (!position) return;
          const instances = mesh.isInstancedMesh ? mesh.count : 1;
          const triangles = (mesh.geometry.index ? mesh.geometry.index.count : position.count) / 3 * instances;
          let owner: T.Object3D | null = mesh;
          let name = mesh.isInstancedMesh ? 'instanced' : 'mesh';
          while (owner) {
            if (owner.name) { name = owner.name; break; }
            owner = owner.parent;
          }
          const entry = tally[name] ?? { meshes: 0, triangles: 0 };
          entry.meshes += 1;
          entry.triangles += triangles;
          tally[name] = entry;
        });
        return tally;
      },
      get triangles() { return stage.renderer.info.render.triangles; },
      get foamVersion() { return (city.scenery.foam.mesh.geometry.attributes.position as T.BufferAttribute).version; },
      get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; },
      projectTile: (x: number, z: number) => { const p = worldPositionOn(map(), x + .5, z + .5); const roads = activeCity(world, context)?.roads ?? []; return stage.project(p.x, roadHeight(map(), stairLayout(map(), new Set(roads)), x + .5, z + .5), p.z); },
      projectPoint: (x: number, z: number, y = 0) => { const p = worldPositionOn(map(), x, z); return stage.project(p.x, groundHeight(map(), Math.floor(x), Math.floor(z)) + y, p.z); },
      projectBuilding: (id: number) => {
        const building = findBuildingOwner(id)?.building;
        if (!building) return null;
        const size = footprint(building.kind, building.rotation);
        const p = worldPositionOn(map(), building.x + size.width / 2, building.z + size.depth / 2);
        return stage.project(p.x, groundHeight(map(), building.x, building.z) + 1.5, p.z);
      },
      advance: (seconds: number) => { setSpeed(0); advance(world, seconds); refresh(); dirtySave = true; stage.shadows(); },
      get plan() { const home = activeCity(world, context); return home ? planStarterNeighbourhood(world, home) : null; },
      foundingPlacement: (x: number, z: number) => {
        const home = activeCity(world, context);
        return home ? foundingPlacement(world, home, x, z) : { ok: false, reason: 'You have no city of your own here.', cost: 0, tiles: [] };
      },
      buildPlan: () => {
        if (!canWrite(world, context)) return { ok: false, reason: 'Viewing another city grants no writes.' };
        const home = activeCity(world, context);
        if (!home) return { ok: false, reason: 'You have no city of your own here.' };
        const result = buildStarterNeighbourhood(world, home);
        refresh();
        save(true);
        stage.shadows();
        return result;
      },
      build: (tool: BuildTool, x: number, z: number) => debugCommand({ type: 'build', tool, x, z, rotation: 0 }),
      road: (tiles: Tile[]) => debugCommand({ type: 'roadPath', tiles }),
      projectWalker: (id: number) => {
        const point = city.moverPoint(id);
        return point ? stage.project(point.x, point.y + .5, point.z) : null;
      },
      probe: (clientX: number, clientY: number) => city.probe(clientX, clientY),
      focusTile: (x: number, z: number) => { const point = worldPositionOn(map(), x + .5, z + .5); stage.focus(point.x, point.z, true); },
      terrainAt: (x: number, z: number) => terrainOn(map(), x, z),
      get map() { const island = map(); return { width: island.width, depth: island.depth, home: island.home, islands: island.islands, entry: island.entry, terrain: island.terrain, level: Array.from(island.level) }; },
      roadCost: ROAD_COST,
      saveKey: SAVE_KEY,
      get overlayCounts() { return overlay.counts; },
      get cityContext() { return { ...context }; },
      visit: (id: number) => viewCity(id),
    });
  }
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The island could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}
