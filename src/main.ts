import * as T from 'three';
import { Stage } from './render/stage';
import type { View } from './render/stage';
import { CityScene } from './render/city';
import { ConstructionOverlay } from './render/construction';
import { BUILDINGS } from './sim/catalog';
import { demolitionPreview, footprintTileIssues, harbourRoute, suitableFarmGround } from './sim/construction';
import { CELL_SIZE, groundHeight, islandFor, terrainOn, tileIndexOn, worldPositionOn, GROUND_Y } from './sim/island';
import { buildingStatus, getSummary, placement, roadPathPlacement, walkerName, walkerStatus, WALKER_ROLES } from './sim/world';
import { animalName, animalStatus } from './sim/wildlife';
import type { Building, City, Placement, Rotation, Tile, Tool, Walker, World } from './sim/types';
import { createHud, type CityScope, type HudTool } from './ui/hud';
import { createSound } from './ui/sound';
import { celebration, cityMilestones, NO_MILESTONES, rememberMilestones } from './ui/celebrations';
import { harbourPlacement } from './sim/founding';
import type { AuthorityRequest } from './server/authority';
import { parseCommand, type CityCommand } from './sim/commands';
import { activeCity, canWrite, contextForOwnedCity, reconcileContext, resolveCity, viewedCity, withViewed } from './ui/city-context';
import { cadence, debugEnabled, protocolLog, snapshotLog } from './ui/debug';
import { SharedSession, type SendOutcome, type SharedRequestOutcome, type SharedSessionStatus, type SharedSnapshot } from './ui/shared-session';
import { SharedIntent } from './ui/shared-intent';
import { PredictedWorld } from './ui/predicted-world';
import { WorldClock } from './ui/world-clock';
import './ui/style.css';

export interface SharedBootSource {
  session: SharedSession;
  initialSnapshot: SharedSnapshot;
}

const CONNECTION_NOTICE_DELAY = 900;

function isSettling(status: SharedSessionStatus): boolean {
  return status === 'pending' || status === 'reconciling';
}

export interface BootHandles {
  onSnapshot(snapshot: SharedSnapshot): void;
  onStatus(status: SharedSessionStatus, reason: string): void;
  onRealmChanged(): void;
  onOutcome(result: SharedRequestOutcome): void;
}

export function boot(source: SharedBootSource): BootHandles {
  const scripting = debugEnabled(location.search);
  const predicted = new PredictedWorld(source.initialSnapshot.world);
  const clock = new WorldClock(source.initialSnapshot.world.time);
  let world: World = predicted.world;
  let realmId: string = source.initialSnapshot.realmId;
  let bindingId: string = source.initialSnapshot.session.binding;
  let stateGeneration = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = new Stage(document.querySelector<HTMLElement>('#app')!, false);
  stage.reducedMotion = reducedMotion;
  let context = contextForOwnedCity(world, source.initialSnapshot.session.ownedCityIds);
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
  function overviewView(seed: number): { target: number[]; offset: number[]; size: number } {
    const island = islandFor(seed);
    const centre = worldPositionOn(island, island.width / 2, island.depth / 2);
    return { target: [centre.x, GROUND_Y, centre.z], offset: [52, 66, 70], size: 240 };
  }
  stage.bounds(seaBounds(world.seed));
  const initialActive = activeCity(world, context);
  if (initialActive) stage.setView(viewFor(initialActive));
  else stage.setView(overviewView(world.seed));
  function rebuildScene(preserveView = false): void {
    const previousView = stage.getView();
    city.dispose();
    stage.bounds(seaBounds(world.seed));
    const home = activeCity(world, context);
    city = new CityScene(stage, mapFor(home), !reducedMotion);
    city.setWorldTime(clock.now);
    city.watch(stage.controls.target, stage.viewSpan());
    overlay.dispose();
    overlay = new ConstructionOverlay(stage, mapFor(home));
    if (preserveView) stage.setView(previousView);
    else {
      const viewed = viewedCity(world, context);
      if (viewed) stage.setView(cameraMemory.get(viewed.id) ?? viewFor(viewed));
      else stage.setView(overviewView(world.seed));
    }
    stage.shadows();
  }
  let tool: Tool = 'inspect';
  let harbourArmed = false;
  let rotation: Rotation = 0;
  let selectedId: number | null = null;
  let hover: Tile | null = null;
  let drag: { tile: Tile; x: number; y: number; pointer: number; gestureWritable: boolean; gestureGeneration: number } | null = null;
  let bendVertical = false;
  let renderedWritable = false;
  let showGrid = false;
  let artTime = 0;
  let inDebt = false;
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

  function settling(): boolean {
    return isSettling(source.session.currentStatus);
  }

  function writable(): boolean {
    return canWrite(world, context) && (source.session.canSend() || settling());
  }

  function siting(): boolean {
    return context.activeId === null && (source.session.canSend() || settling() || sharedIntent.busy);
  }

  function connectionHint(): string {
    if (!source.session.canSend() && !settling()) return connectionMessage(source.session.currentStatus);
    if (harbourArmed) return 'Choose a shore: two rows of land, three of water \u00b7 R turns the harbour';
    if (context.activeId === null) return 'Choose the harbour to found your city.';
    if (context.viewedId !== context.activeId) return 'Visiting another city · read-only. H returns home.';
    return 'Viewing another city grants no writes.';
  }

  function refresh(): void {
    const viewed = viewedCity(world, context);
    const active = activeCity(world, context);
    const found = findBuildingOwner(selectedId);
    const foundWalker = found ? null : findWalkerOwner(selectedId);
    const animal = found || foundWalker ? null : world.wildlife.find((candidate) => candidate.id === selectedId) ?? null;
    if (!found && !foundWalker && !animal) selectedId = null;
    city.sync(world);
    overlay.setRoads(active?.roads ?? []);
    city.select(found?.building ?? null, foundWalker?.walker.id ?? animal?.id ?? null);
    const viewedScope = scopeOf(viewed);
    const activeScope = scopeOf(active);
    const canEdit = writable();
    renderedWritable = canEdit;
    if (foundWalker) hud.update(world, viewedScope, activeScope, { kind: 'person', name: walkerName(foundWalker.walker), role: WALKER_ROLES[foundWalker.walker.kind], status: walkerStatus(foundWalker.city, foundWalker.walker) }, canEdit);
    else if (animal) hud.update(world, viewedScope, activeScope, { kind: 'person', name: animalName(animal), role: 'Wildlife', status: animalStatus(animal) }, canEdit);
    else if (found) hud.update(world, viewedScope, activeScope, { kind: 'building', building: found.building, status: buildingStatus(found.city, found.building), editable: canEdit && found.city.id === active?.id }, canEdit);
    else hud.update(world, viewedScope, activeScope, null, canEdit);
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
  }

  function selectTool(next: HudTool): void {
    if (next === 'harbour') {
      if (!siting()) { hud.notify('You cannot found a city here.', true); return; }
    } else if (next !== 'inspect') {
      if (!writable()) { hud.notify('Viewing another city grants no writes.', true); return; }
      const home = activeCity(world, context);
      if (!home) { hud.notify('Place your harbour first.', true); return; }
    }
    harbourArmed = next === 'harbour';
    tool = next === 'harbour' ? 'inspect' : next;
    drag = null;
    hud.setTool(next, rotation);
    stage.controls.touches.ONE = next === 'inspect' ? T.TOUCH.ROTATE : null;
    const home = activeCity(world, context);
    city.scenery.grid.visible = !home || showGrid || tool !== 'inspect';
    updatePreview();
    stage.invalidate();
  }

  function setGrid(enabled: boolean): void {
    showGrid = enabled;
    const home = activeCity(world, context);
    city.scenery.grid.visible = !home || enabled || tool !== 'inspect';
    hud.setGrid(enabled);
    stage.invalidate();
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
    vendor: (id, enabled) => dispatchShared({ type: 'vendor', id, enabled }),
    focus: (x, z) => { const point = worldPositionOn(map(), x + .5, z + .5); stage.focus(point.x, point.z); },
    grid: setGrid,
    menu: (open) => {
      if (!open) return;
      held.clear();
      panVelocity.right = 0;
      panVelocity.forward = 0;
      drag = null;
    },
    sound: (enabled) => { sound.setEnabled(enabled); hud.setSound(enabled); },
    discardPending: () => {
      if (source.session.discardPending()) sharedIntent.reset();
    },
  });

  const sharedIntent = new SharedIntent(source.session, () => realmId, (outcome, kind) => {
    applySharedOutcome(outcome, kind !== 'command');
    if (kind === 'claim') updateFounding();
    onStatusUpdate(source.session.currentStatus, source.session.statusReason);
  });

  function applySharedOutcome(outcome: SendOutcome, announce = true): void {
    const resolveSeam = seamOutcome;
    seamOutcome = null;
    resolveSeam?.(outcome);
    const uncertain = outcome.status === 'indeterminate';
    if (outcome.reason.length > 0) hud.notify(outcome.reason, !outcome.ok && !uncertain);
    if (!outcome.ok && !uncertain) sound.play('error');
    else if (outcome.ok && announce) sound.play('build');
    if (outcome.ok || !predicted.predicting) return;
    predicted.discard();
    world = predicted.world;
    refresh();
    updatePreview();
  }

  let bufferedRequest: AuthorityRequest | null = null;

  function submitShared(request: AuthorityRequest): void {
    if (source.session.canSend() && !sharedIntent.busy) {
      sendShared(request);
      return;
    }
    bufferedRequest = settling() ? request : null;
  }

  function sendShared(request: AuthorityRequest): void {
    if (!sharedIntent.send(request) || request.kind !== 'command') return;
    const command = parseCommand(request.command);
    if (!command || !predicted.predict(request.cityId, command)) return;
    sound.play('build');
    world = predicted.world;
    refresh();
    updatePreview();
  }

  function flushBufferedRequest(): void {
    const request = bufferedRequest;
    bufferedRequest = null;
    if (!request || !source.session.canSend() || sharedIntent.busy) return;
    if (request.kind === 'claim' && context.activeId !== null) return;
    if (request.kind === 'command' && request.cityId !== context.activeId) return;
    sendShared(request);
  }

  function dispatchShared(command: CityCommand): void {
    if (!writable()) { applySharedOutcome({ ok: false, reason: 'Viewing another city grants no writes.', status: 'unsent' }); return; }
    submitShared({ kind: 'command', cityId: context.activeId!, command });
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

  function previewHarbourSite(site: Tile): void {
    const preview = harbourPlacement(world, site.x, site.z, rotation);
    city.showPreview('harbour', site.x, site.z, rotation, preview);
    city.clearHover();
    overlay.setFertileGround(null);
    overlay.setBlockedTiles([]);
    overlay.setDemolitionTarget([]);
    overlay.setHarbourRoute(null);
    stage.canvas.style.cursor = preview.ok ? 'crosshair' : 'not-allowed';
    hud.setHint(preview.ok ? 'Found your city here · the harbour is free · R turns it' : preview.reason);
  }

  function updatePreview(pointer: { x: number; y: number } | null = null): void {
    if (harbourArmed && siting() && hover) {
      previewHarbourSite(hover);
      return;
    }
    if (!writable()) {
      city.hidePreview();
      city.clearHover();
      overlay.setFertileGround(null);
      overlay.setBlockedTiles([]);
      overlay.setDemolitionTarget([]);
      overlay.setHarbourRoute(null);
      stage.canvas.style.cursor = '';
      hud.setHint(connectionHint());
      if (pointer && !drag && city.hover(pointer.x, pointer.y, world)) stage.canvas.style.cursor = 'pointer';
      return;
    }
    const homeCity = activeCity(world, context)!;
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
    drag = { tile: hover, x: event.clientX, y: event.clientY, pointer: event.pointerId, gestureWritable: writable() || siting(), gestureGeneration: stateGeneration };
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
      const gestureStillValid = drag.gestureWritable && drag.gestureGeneration === stateGeneration;
      const home = gestureStillValid && writable() ? activeCity(world, context) : null;
      if (gestureStillValid && harbourArmed && siting()) {
        submitShared({ kind: 'claim', x: hover.x, z: hover.z, rotation });
      } else if (!home || tool === 'inspect') {
        const picked = city.pick(event.clientX, event.clientY);
        selectedId = picked.walker ?? picked.animal ?? picked.building;
        refresh();
      } else if (tool === 'demolish') {
        const picked = city.pick(event.clientX, event.clientY);
        const hit = home.buildings.find((building) => building.id === picked.building);
        dispatchShared({ type: 'demolish', x: hit?.x ?? hover.x, z: hit?.z ?? hover.z });
      } else if (tool === 'road') dispatchShared({ type: 'roadPath', tiles: roadPath() });
      else dispatchShared({ type: 'build', tool, x: hover.x, z: hover.z, rotation });
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
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys: Record<string, Tool> = { '1': 'road', '2': 'house', '3': 'farm', '4': 'granary', '5': 'agora', '6': 'fountain', '7': 'maintenance', '8': 'lodge', '9': 'woodcutter', '0': 'stockpile', x: 'demolish' };
    if (event.key === 'Escape') {
      escapeOpensMenu = tool === 'inspect' && !harbourArmed;
      if (!escapeOpensMenu) selectTool('inspect');
    } else if (event.key === '1' && context.activeId === null) selectTool('harbour');
    else if (keys[event.key]) selectTool(keys[event.key]);
    else if (event.key.toLowerCase() === 'g') setGrid(!showGrid);
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
    clock.advance(delta);
    city.setWorldTime(clock.now);
    stage.pan(panVelocity.right * delta * .9, panVelocity.forward * delta * .9);
    stage.update(delta);
    city.watch(stage.controls.target, stage.viewSpan());
    city.transitions(delta);
    if (!document.hidden) {
      visualDelta += delta;
      if (now - lastRender >= 1000 / 30) {
        if (!reducedMotion) {
          artTime += visualDelta;
          city.animate(artTime, visualDelta, 1);
          stage.shadowsFromMotion();
        }
        visualDelta = 0;
        lastRender = now;
      }
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { previous = 0; if (!document.hidden) stage.invalidate(); });
  selectTool('inspect');
  hud.setSound(sound.enabled);
  updateFounding();
  refresh();
  if (reducedMotion) city.animate(0, .25, 1);
  city.watch(stage.controls.target, stage.viewSpan());
  stage.shadows();
  requestAnimationFrame(frame);

  function updateFounding(): void {
    const founding = context.activeId === null;
    const ready = founding && siting() && !sharedIntent.busy && bufferedRequest === null;
    hud.setFounding(founding, ready);
  }


  function connectionMessage(status: SharedSessionStatus): string {
    switch (status) {
      case 'connecting': return 'Connecting\u2026';
      case 'open': return 'Connected. Waiting for the world\u2026';
      case 'reconciling': return 'Confirming your last action\u2026';
      case 'pending': return 'Sending\u2026';
      case 'exhausted': return 'This session can no longer send requests.';
      case 'offline': return 'Disconnected. Reconnecting\u2026';
      case 'closed': return 'Disconnected.';
      case 'protocol-error': return 'A protocol error occurred. Reload only once the connection problem is resolved.';
      case 'storage-error': return 'Local storage is blocked. Resolve it to continue.';
      case 'indeterminate': return 'Your last action may or may not have applied. You can discard it to continue.';
      default: return '';
    }
  }

  function onSnapshotUpdate(snapshot: SharedSnapshot): void {
    if (scripting) snapshotLog.record(snapshot.serial, snapshot.world.time);
    const realmChanged = realmId !== null && realmId !== snapshot.realmId;
    const bindingChanged = bindingId !== null && bindingId !== snapshot.session.binding;
    if (realmChanged || bindingChanged) stateGeneration += 1;
    const previousContext = context;
    if (realmChanged || bindingChanged) {
      sharedIntent.reset();
      bufferedRequest = null;
    }
    predicted.sync(snapshot.world);
    if (!sharedIntent.busy) predicted.discard();
    world = predicted.world;
    clock.observe(snapshot.world.time);
    city.setWorldTime(clock.now);
    realmId = snapshot.realmId;
    bindingId = snapshot.session.binding;
    context = reconcileContext(world, context, snapshot.session.ownedCityIds, realmChanged, bindingChanged);
    if (!realmChanged && previousContext.viewedId !== null && previousContext.viewedId !== context.viewedId) {
      cameraMemory.set(previousContext.viewedId, stage.getView());
    }
    const contextChanged = previousContext.activeId !== context.activeId || previousContext.viewedId !== context.viewedId;
    if (realmChanged || bindingChanged || contextChanged) {
      if (realmChanged) cameraMemory.clear();
      const active = activeCity(world, context);
      milestones = active ? cityMilestones(active) : NO_MILESTONES;
      selectedId = null;
      hover = null;
      drag = null;
      rebuildScene(!realmChanged && previousContext.viewedId === context.viewedId);
      selectTool('inspect');
    }
    updateFounding();
    refresh();
    if (tool !== 'inspect' || hover !== null) updatePreview();
    if (reducedMotion) {
      city.animate(0, .25, 1);
      stage.shadowsFromMotion();
    }
  }

  let connectionNotice = 0;
  let connectionNoticeArmed = false;

  function presentConnection(status: SharedSessionStatus, reason: string): void {
    if (isSettling(status) && connectionNoticeArmed) return;
    window.clearTimeout(connectionNotice);
    connectionNoticeArmed = false;
    if (status === 'ready') {
      hud.setConnection(false, '');
      return;
    }
    if (!isSettling(status)) {
      hud.setConnection(true, reason.length > 0 ? reason : connectionMessage(status));
      return;
    }
    connectionNoticeArmed = true;
    connectionNotice = window.setTimeout(() => {
      const current = source.session.currentStatus;
      hud.setConnection(true, source.session.statusReason || connectionMessage(current));
    }, CONNECTION_NOTICE_DELAY);
  }

  function onStatusUpdate(status: SharedSessionStatus, reason: string): void {
    presentConnection(status, reason);
    hud.setDiscardAvailable(status === 'indeterminate' || status === 'storage-error');
    updateFounding();
    const nowWritable = writable();
    if (!nowWritable) {
      if (tool !== 'inspect') selectTool('inspect');
      else drag = null;
    }
    if (nowWritable !== renderedWritable) {
      refresh();
      updatePreview();
    }
    flushBufferedRequest();
    releaseSeamWaiters();
  }

  function onOutcomeUpdate(result: SharedRequestOutcome): void {
    sharedIntent.outcome(result);
  }

  let seamOutcome: ((outcome: SendOutcome) => void) | null = null;
  const seamWaiters = new Set<() => void>();

  function seamReady(): boolean {
    return source.session.canSend() && !sharedIntent.busy;
  }

  function releaseSeamWaiters(): void {
    if (!seamReady()) return;
    for (const waiter of [...seamWaiters]) waiter();
    seamWaiters.clear();
  }

  function seamSettled(): Promise<void> {
    if (seamReady()) return Promise.resolve();
    return new Promise((resolve) => seamWaiters.add(resolve));
  }

  async function seamSubmit(request: AuthorityRequest): Promise<SendOutcome> {
    await seamSettled();
    return new Promise<SendOutcome>((resolve) => {
      seamOutcome = resolve;
      submitShared(request);
    });
  }

  function seamCommand(command: CityCommand): Promise<SendOutcome> {
    if (context.activeId === null) return Promise.resolve({ ok: false, reason: 'No city of your own yet.', status: 'unsent' });
    return seamSubmit({ kind: 'command', cityId: context.activeId, command });
  }

  function installDebugSeam(): void {
    Reflect.set(window, 'oikos', {
      get state() { return structuredClone(world); },
      get map() {
        const island = map();
        return { width: island.width, depth: island.depth, home: island.home, entry: island.entry, islands: island.islands, terrain: island.terrain, level: Array.from(island.level) };
      },
      get status() {
        return {
          status: source.session.currentStatus,
          reason: source.session.statusReason,
          ready: seamReady(),
          busy: sharedIntent.busy,
          writable: writable(),
          siting: siting(),
        };
      },
      get session() {
        return { ...source.session.currentSession, realmId, activeCityId: context.activeId, viewedCityId: context.viewedId };
      },
      get log() { return protocolLog.all; },
      get snapshots() { return snapshotLog.all; },
      get cadence() { return cadence(snapshotLog.all); },
      clearLog: () => { protocolLog.clear(); snapshotLog.clear(); },
      get clock() { return clock.now; },
      get frames() { return stage.frames; },
      get drawCalls() { return stage.renderer.info.render.calls; },
      get triangles() { return stage.renderer.info.render.triangles; },
      get camera() { return [...stage.camera.position.toArray(), ...stage.controls.target.toArray(), stage.camera.zoom]; },
      settled: seamSettled,
      claim: (x: number, z: number, turn: Rotation = 0) => seamSubmit({ kind: 'claim', x, z, rotation: turn }),
      build: (kind: Exclude<Tool, 'inspect' | 'demolish' | 'road'>, x: number, z: number, turn: Rotation = 0) => seamCommand({ type: 'build', tool: kind, x, z, rotation: turn }),
      road: (tiles: Tile[]) => seamCommand({ type: 'roadPath', tiles }),
      demolish: (x: number, z: number) => seamCommand({ type: 'demolish', x, z }),
      vendor: (id: number, enabled: boolean) => seamCommand({ type: 'vendor', id, enabled }),
      checkClaim: (x: number, z: number, turn: Rotation = 0) => harbourPlacement(world, x, z, turn),
      checkBuild: (kind: Exclude<Tool, 'inspect' | 'demolish'>, x: number, z: number, turn: Rotation = 0) => {
        const home = activeCity(world, context);
        if (!home) return { ok: false, reason: 'No city of your own yet.', cost: 0, tiles: [] };
        return placement(world, home, kind, x, z, turn);
      },
      select: (x: number, z: number) => {
        const point = projectTile(x, z);
        const picked = city.pick(point.x, point.y);
        selectedId = picked.walker ?? picked.animal ?? picked.building;
        refresh();
        return selectedId;
      },
      setTool: (next: Tool) => selectTool(next),
      toggleGrid: () => setGrid(!showGrid),
      focusTile: (x: number, z: number) => {
        const point = worldPositionOn(map(), x + .5, z + .5);
        stage.focus(point.x, point.z, true);
      },
      home: focusVillage,
      visit: viewCity,
      projectTile,
      terrainAt: (x: number, z: number) => terrainOn(map(), x, z),
    });
  }

  function projectTile(x: number, z: number): { x: number; y: number } {
    const point = worldPositionOn(map(), x + .5, z + .5);
    return stage.project(point.x, groundHeight(map(), x, z), point.z);
  }

  if (scripting) installDebugSeam();

  return {
    onSnapshot: onSnapshotUpdate,
    onStatus: onStatusUpdate,
    onRealmChanged: () => {},
    onOutcome: onOutcomeUpdate,
  };
}
