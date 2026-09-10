import * as T from 'three';
import { Stage } from './render/stage';
import { CityScene } from './render/city';
import { ConstructionOverlay } from './render/construction';
import { BUILDINGS, footprint, ROAD_COST } from './sim/catalog';
import { demolitionPreview, footprintTileIssues, harbourRoute, suitableFarmGround } from './sim/construction';
import { CELL_SIZE, groundHeight, islandFor, LEVEL_HEIGHT, terrainOn, tileIndexOn, worldPositionOn, GROUND_Y } from './sim/island';
import { advance, build, buildingStatus, createWorld, DEFAULT_SEED, demolish, getSummary, placement, placeRoadPath, setVendor, walkerName, walkerStatus, WALKER_ROLES } from './sim/world';
import { deserializeWorld, serializeWorld } from './sim/save';
import { animalName, animalStatus } from './sim/wildlife';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './sim/scenario';
import type { ActionResult, BuildTool, Placement, Rotation, Tile, Tool } from './sim/types';
import { createHud } from './ui/hud';
import { AUTOSAVE_KEY, islandFilename, readCheckpoint, writeAutosave, writeCheckpoint } from './ui/save-slots';
import { createSound } from './ui/sound';
import { celebration, cityMilestones, rememberMilestones } from './ui/celebrations';
import { parseView, VIEW_KEY } from './ui/view';
import { canUndoConstruction, undoConstruction } from './sim/history';
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
        storageWarning = 'Saved island could not be read. A fresh island is open; Save will replace the old file.';
      }
    }
  } catch {
    autoSaveEnabled = false;
    storageWarning = 'Browser storage is unavailable. This island cannot be saved.';
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  stage.reducedMotion = reducedMotion;
  let city = new CityScene(stage, islandFor(world.seed), !reducedMotion);
  let overlay = new ConstructionOverlay(stage, islandFor(world.seed));
  const map = () => city.map;
  function viewFor(seed: number): { target: number[]; offset: number[]; size: number } {
    const island = islandFor(seed);
    const harbour = worldPositionOn(island, island.entry.x + .5, island.entry.z - 7);
    return { target: [harbour.x, GROUND_Y, harbour.z], offset: [35, 38, 48], size: 36 };
  }
  stage.setView(viewFor(world.seed));
  try {
    const saved = parseView(localStorage.getItem(VIEW_KEY), world.seed);
    if (saved) stage.setView(saved);
  } catch {}
  function rebuildScene(): void {
    city.dispose();
    city = new CityScene(stage, islandFor(world.seed), !reducedMotion);
    overlay.dispose();
    overlay = new ConstructionOverlay(stage, islandFor(world.seed));
    stage.setView(viewFor(world.seed));
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
  let milestones = cityMilestones(world);
  const sound = createSound();
  window.addEventListener('pointerdown', sound.unlock, { capture: true });
  window.addEventListener('keydown', sound.unlock, { capture: true });
  const panVelocity = { right: 0, forward: 0 };

  function refresh(): void {
    const selected = world.buildings.find((building) => building.id === selectedId) ?? (world.harbour.id === selectedId ? world.harbour : null);
    const walker = selected ? null : world.walkers.find((candidate) => candidate.id === selectedId) ?? null;
    const animal = selected || walker ? null : world.wildlife.find((candidate) => candidate.id === selectedId) ?? null;
    city.sync(world);
    city.select(selected, walker?.id ?? animal?.id ?? null);
    if (walker) hud.update(world, getSummary(world), { kind: 'person', name: walkerName(walker), role: WALKER_ROLES[walker.kind], status: walkerStatus(world, walker) });
    else if (animal) hud.update(world, getSummary(world), { kind: 'person', name: animalName(animal), role: 'Wildlife', status: animalStatus(animal) });
    else if (selected) hud.update(world, getSummary(world), { kind: 'building', building: selected, status: buildingStatus(world, selected) });
    else hud.update(world, getSummary(world), null);
    const debt = world.money < 0;
    if (debt && !inDebt) hud.notify('The treasury is in debt: upkeep outweighs income.', true);
    inDebt = debt;
    const nextMilestones = cityMilestones(world);
    const event = celebration(milestones, nextMilestones);
    milestones = rememberMilestones(milestones, nextMilestones);
    hud.setUndo(canUndoConstruction(world, undoCheckpoint));
    if (event) {
      hud.notify(event.message);
      sound.play(event.sound);
    }
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
    const previousView = stage.getView();
    world = saved;
    undoCheckpoint = null;
    milestones = cityMilestones(world);
    selectedId = null;
    accumulator = 0;
    dirtySave = true;
    autoSaveEnabled = true;
    rebuildScene();
    if (world.seed === previousSeed) stage.setView(previousView);
    selectTool('inspect');
    setSpeed(0);
    refresh();
    save(false);
  }

  function focusVillage(): void {
    const homes = world.buildings.filter((building) => building.kind === 'house');
    if (homes.length === 0) {
      const view = viewFor(world.seed);
      stage.focus(view.target[0], view.target[2]);
      return;
    }
    const x = homes.reduce((sum, home) => sum + home.x + 1.5, 0) / homes.length;
    const z = homes.reduce((sum, home) => sum + home.z + 1.5, 0) / homes.length;
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
    newIsland: () => {
      const seed = world.seed === DEFAULT_SEED ? 2 : (world.seed * 1103515245 + 12345) % 0x7fffffff;
      world = createWorld(seed);
      undoCheckpoint = null;
      milestones = cityMilestones(world);
      autoSaveEnabled = true;
      selectedId = null;
      accumulator = 0;
      rebuildScene();
      selectTool('inspect');
      setSpeed(1);
      refresh();
      save(false);
      hud.notify('A new beginning. Build four dwellings beside the road.');
    },
    vendor: (id, enabled) => apply(setVendor(world, id, enabled)),
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

  function construct(command: () => ActionResult): ActionResult {
    const before = structuredClone(world);
    const result = command();
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
    const island = map();
    for (let level = 2; level >= 0; level--) {
      const point = stage.pick(event.clientX, event.clientY, GROUND_Y + level * LEVEL_HEIGHT);
      if (!point) continue;
      const tile = { x: Math.floor(point.x / CELL_SIZE + island.width / 2), z: Math.floor(point.z / CELL_SIZE + island.depth / 2) };
      if (level === 0 || groundHeight(island, tile.x, tile.z) === GROUND_Y + level * LEVEL_HEIGHT) return tile;
    }
    return null;
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

  function roadPreview(): { placement: Placement; validTiles: Tile[]; invalidTiles: Tile[] } {
    const path = roadPath();
    const checks = path.map((tile) => placement(world, 'road', tile.x, tile.z));
    const cost = checks.reduce((sum, check) => sum + check.cost, 0);
    const failed = checks.find((check) => !check.ok);
    const inside = path.filter(insideMap);
    const tiles = inside.map((tile) => tileIndexOn(map(), tile.x, tile.z));
    const validTiles = path.filter((tile, index) => insideMap(tile) && checks[index].ok);
    const invalidTiles = path.filter((tile, index) => insideMap(tile) && !checks[index].ok);
    const reason = failed?.reason ?? (cost > world.money ? 'Not enough drachmas.' : `Road · ${cost} drachmas`);
    return { placement: { ok: !failed && cost <= world.money, reason, cost, tiles }, validTiles, invalidTiles };
  }

  function updatePreview(pointer: { x: number; y: number } | null = null): void {
    overlay.setFertileGround(tool === 'farm' ? suitableFarmGround(world) : null);
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
      const found = demolitionPreview(world, hover.x, hover.z);
      overlay.setBlockedTiles([]);
      overlay.setHarbourRoute(null);
      overlay.setDemolitionTarget(found?.footprint ?? []);
      city.showPreview(tool, hover.x, hover.z, rotation, { ok: false, reason: '', tiles: [], cost: 0 });
      if (!found) hud.setHint('Nothing to demolish here · Escape cancels');
      else if (found.kind === 'road') hud.setHint('Demolish this road · no refund · Escape cancels');
      else hud.setHint(`Demolish the ${BUILDINGS[found.kind].name.toLowerCase()} · refunds ${found.refund} drachmas · Escape cancels`);
      return;
    }
    if (tool === 'road') {
      const { placement: preview, validTiles, invalidTiles } = roadPreview();
      city.showPreview(tool, hover.x, hover.z, rotation, { ...preview, ok: true, tiles: validTiles.map((tile) => tileIndexOn(map(), tile.x, tile.z)) });
      overlay.setBlockedTiles(invalidTiles);
      overlay.setDemolitionTarget([]);
      overlay.setHarbourRoute(harbourRoute(world, preview.tiles));
      if (!preview.ok) stage.canvas.style.cursor = 'not-allowed';
      hud.setHint(`${preview.reason} · Hold Shift to bend the other way · Escape cancels`);
      return;
    }
    const preview = placement(world, tool, hover.x, hover.z, rotation);
    const issues = footprintTileIssues(world, tool, hover.x, hover.z, rotation);
    const validTiles = issues.filter((tile) => !tile.blocked);
    const invalidTiles = issues.filter((tile) => tile.blocked && insideMap(tile));
    city.showPreview(tool, hover.x, hover.z, rotation, { ...preview, ok: true, tiles: validTiles.map((tile) => tileIndexOn(map(), tile.x, tile.z)) });
    overlay.setBlockedTiles(invalidTiles);
    overlay.setDemolitionTarget([]);
    overlay.setHarbourRoute(harbourRoute(world, validTiles.map((tile) => tileIndexOn(map(), tile.x, tile.z))));
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
      if (tool === 'inspect' || tool === 'demolish') {
        const picked = city.pick(event.clientX, event.clientY);
        const hit = world.buildings.find((building) => building.id === picked.building);
        if (tool === 'inspect') {
          selectedId = picked.walker ?? picked.animal ?? picked.building;
          refresh();
        } else construct(() => demolish(world, hit?.x ?? hover!.x, hit?.z ?? hover!.z));
      } else if (tool === 'road') construct(() => placeRoadPath(world, roadPath()));
      else {
        const buildingTool = tool;
        const result = construct(() => build(world, buildingTool, hover!.x, hover!.z, rotation));
        if (result.ok) {
          selectedId = world.buildings.find((building) => building.x === hover!.x && building.z === hover!.z)?.id ?? null;
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
          stage.shadows();
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
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ seed: world.seed, view: stage.getView() })); } catch {}
  }
  window.addEventListener('pagehide', () => { if (dirtySave) save(false); saveView(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveView(); });
  selectTool('inspect');
  hud.setSpeed(speed);
  hud.setSound(sound.enabled);
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
      projectTile: (x: number, z: number) => { const p = worldPositionOn(map(), x + .5, z + .5); return stage.project(p.x, groundHeight(map(), x, z), p.z); },
      projectPoint: (x: number, z: number, y = 0) => { const p = worldPositionOn(map(), x, z); return stage.project(p.x, groundHeight(map(), Math.floor(x), Math.floor(z)) + y, p.z); },
      projectBuilding: (id: number) => {
        const building = world.buildings.find((candidate) => candidate.id === id);
        if (!building) return null;
        const size = footprint(building.kind, building.rotation);
        const p = worldPositionOn(map(), building.x + size.width / 2, building.z + size.depth / 2);
        return stage.project(p.x, groundHeight(map(), building.x, building.z) + 1.5, p.z);
      },
      advance: (seconds: number) => { setSpeed(0); advance(world, seconds); refresh(); dirtySave = true; stage.shadows(); },
      get plan() { return planStarterNeighbourhood(world); },
      buildPlan: () => { const result = buildStarterNeighbourhood(world); refresh(); save(true); stage.shadows(); return result; },
      build: (tool: BuildTool, x: number, z: number) => { const result = build(world, tool, x, z, 0); refresh(); save(true); return result; },
      road: (tiles: Tile[]) => { const result = placeRoadPath(world, tiles); refresh(); save(true); return result; },
      probe: (clientX: number, clientY: number) => city.probe(clientX, clientY),
      focusTile: (x: number, z: number) => { const point = worldPositionOn(map(), x + .5, z + .5); stage.focus(point.x, point.z, true); },
      terrainAt: (x: number, z: number) => terrainOn(map(), x, z),
      get map() { const island = map(); return { width: island.width, depth: island.depth, entry: island.entry, terrain: island.terrain, level: Array.from(island.level) }; },
      roadCost: ROAD_COST,
      saveKey: SAVE_KEY,
      get overlayCounts() { return overlay.counts; },
    });
  }
}

try { boot(); }
catch (error) {
  document.body.dataset.error = 'true';
  document.querySelector<HTMLElement>('#status')!.textContent = 'The island could not open. WebGL 2 and hardware acceleration are required.';
  console.error(error);
}
