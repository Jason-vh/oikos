import { Application, Container, Sprite } from 'pixi.js';
import { TileAtlas } from './render/atlas';
import { Camera } from './render/camera';
import { attachKeyboardPan, attachPointerInput } from './render/input';
import { footprintAnchor, pickTile, tileToScreen, type Point } from './render/iso';
import { Scene, structureLook, type OverlayMode } from './render/scene';
import { TextureCache } from './render/textures';
import { BUILDINGS, ROAD_COST, isDwelling } from './sim/buildings';
import { MAX_HEIGHT } from './sim/grid';
import type { View } from './sim/save';
import { inspectTile, type Inspection } from './ui/inspect';
import type { BuildingKind } from './sim/types';
import { TICKS_PER_SECOND } from './sim/time';
import { World } from './sim/world';

export type Tool =
  | { kind: 'inspect' }
  | { kind: 'road' }
  | { kind: 'roadblock' }
  | { kind: 'wall' }
  | { kind: 'demolish' }
  | { kind: 'build'; building: BuildingKind };

const MAP_SIZE = 48;
const SEA_COLOUR = 0x2f8fa8;
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME = 40;
const ALLOWED = 0x8ce39a;
const REFUSED = 0xe07070;
const SELECTED = 0xf0d99b;

export class Game {
  readonly world: World;
  readonly scene: Scene;
  readonly camera = new Camera();

  tool: Tool = { kind: 'inspect' };
  speed = 1;
  selected: Point | null = null;

  private readonly atlas: TileAtlas;
  readonly textures: TextureCache;
  private readonly panKeyboard: () => void;
  private hovered: Point = { x: -1, y: -1 };
  private dragOrigin: Point | null = null;
  private accumulator = 0;
  private cursorKey = '';

  constructor(app: Application, world = new World(MAP_SIZE, randomSeed())) {
    this.world = world;
    this.atlas = new TileAtlas();
    this.textures = new TextureCache();
    this.scene = new Scene(this.world, this.atlas, this.textures);
    app.renderer.background.color = SEA_COLOUR;
    this.panKeyboard = attachKeyboardPan(this.camera);

    const worldLayer = new Container();
    worldLayer.addChild(this.scene.root);
    app.stage.addChild(worldLayer);

    this.camera.scale = 0.7;
    this.camera.centreOnTile(MAP_SIZE / 2, MAP_SIZE / 2, app.screen.width, app.screen.height);

    attachPointerInput(app.canvas, this.camera, {
      hover: (tile) => {
        this.hovered = this.resolveTile(tile);
      },
      press: (tile) => this.onPress(this.resolveTile(tile)),
      drag: (tile) => this.onDrag(this.resolveTile(tile)),
      release: () => this.onRelease(),
      cancel: () => {
        this.dragOrigin = null;
      },
    });
  }

  update(deltaMs: number): void {
    this.panKeyboard();
    this.accumulator += deltaMs * this.speed;

    let steps = 0;
    while (this.accumulator >= MS_PER_TICK && steps < MAX_TICKS_PER_FRAME) {
      this.world.update();
      this.accumulator -= MS_PER_TICK;
      steps += 1;
    }
    if (steps === MAX_TICKS_PER_FRAME) this.accumulator = 0;

    this.scene.sync(deltaMs);
    this.updateCursor();
    this.camera.applyTo(this.scene.root);
  }

  restoreView(view: View): void {
    this.camera.x = view.x;
    this.camera.y = view.y;
    this.camera.scale = view.scale;
  }

  setOverlay(mode: OverlayMode): void {
    this.scene.setOverlayMode(this.scene.currentOverlayMode === mode ? 'none' : mode);
  }

  get overlayMode(): OverlayMode {
    return this.scene.currentOverlayMode;
  }

  inspectSelection(): Inspection | null {
    if (!this.selected) return null;
    return inspectTile(this.world, this.selected.x, this.selected.y);
  }

  clearSelection(): void {
    this.selected = null;
  }

  private resolveTile(world: Point): Point {
    return pickTile(world.x, world.y, (x, y) => this.world.grid.heightAt(x, y), MAX_HEIGHT);
  }

  private onPress(tile: Point): void {
    this.hovered = tile;
    this.dragOrigin = tile;

    if (this.tool.kind === 'inspect') {
      this.selected = this.world.grid.contains(tile.x, tile.y) ? tile : null;
      return;
    }

    if (this.tool.kind === 'demolish') {
      this.world.demolish(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'roadblock') {
      this.world.placeRoadblock(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'wall') {
      this.world.placeWall(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'build') this.tryBuild(tile);
  }

  private onDrag(tile: Point): void {
    this.hovered = tile;
    if (this.tool.kind === 'demolish') this.world.demolish(tile.x, tile.y);
    if (this.tool.kind === 'roadblock') this.world.placeRoadblock(tile.x, tile.y);
    if (this.tool.kind === 'wall') this.world.placeWall(tile.x, tile.y);
    if (this.tool.kind !== 'build' || draggable(this.tool.building)) return;
    if (BUILDINGS[this.tool.building].size === 1) this.tryBuild(tile);
  }

  private onRelease(): void {
    if (this.tool.kind === 'build' && draggable(this.tool.building) && this.dragOrigin) {
      for (const plot of plotsBetween(this.dragOrigin, this.hovered, BUILDINGS[this.tool.building].size)) {
        this.world.place(this.tool.building, plot.x, plot.y);
      }
    }
    if (this.tool.kind === 'wall' && this.dragOrigin) {
      for (const tile of roadPath(this.dragOrigin, this.hovered)) {
        this.world.placeWall(tile.x, tile.y);
      }
    }
    if (this.tool.kind === 'road' && this.dragOrigin) {
      for (const tile of roadPath(this.dragOrigin, this.hovered)) {
        this.world.placeRoad(tile.x, tile.y);
      }
      if (this.world.treasury < ROAD_COST) this.world.log('The treasury is empty.');
    }
    this.dragOrigin = null;
  }

  private tryBuild(tile: Point): void {
    if (this.tool.kind !== 'build') return;
    const check = this.world.canPlace(this.tool.building, tile.x, tile.y);
    if (!check.ok) {
      this.world.log(`${BUILDINGS[this.tool.building].name}: ${check.reason}`);
      return;
    }
    this.world.place(this.tool.building, tile.x, tile.y);
  }

  private updateCursor(): void {
    const key = [
      this.tool.kind,
      this.tool.kind === 'build' ? this.tool.building : '',
      this.hovered.x,
      this.hovered.y,
      this.selected?.x ?? -1,
      this.selected?.y ?? -1,
      this.dragOrigin?.x ?? -1,
      this.dragOrigin?.y ?? -1,
      this.world.structureVersion,
    ].join('|');
    if (key === this.cursorKey) return;
    this.cursorKey = key;

    this.scene.cursor.removeChildren().forEach((child) => child.destroy());
    if (!this.world.grid.contains(this.hovered.x, this.hovered.y)) return;

    if (this.tool.kind === 'road') {
      const origin = this.dragOrigin ?? this.hovered;
      for (const tile of roadPath(origin, this.hovered)) {
        this.addTileMarker(tile, this.world.canPlaceRoad(tile.x, tile.y) ? ALLOWED : REFUSED);
      }
      return;
    }

    if (this.tool.kind === 'demolish') {
      this.addTileMarker(this.hovered, REFUSED);
      return;
    }

    if (this.tool.kind === 'inspect') {
      if (this.selected) this.addTileMarker(this.selected, SELECTED);
      return;
    }

    if (this.tool.kind === 'roadblock') {
      const allowed = this.world.canPlaceRoadblock(this.hovered.x, this.hovered.y);
      this.addTileMarker(this.hovered, allowed ? ALLOWED : REFUSED);
      return;
    }

    if (this.tool.kind === 'wall') {
      const origin = this.dragOrigin ?? this.hovered;
      for (const tile of roadPath(origin, this.hovered)) {
        this.addTileMarker(tile, this.world.canPlaceWall(tile.x, tile.y) ? ALLOWED : REFUSED);
      }
      return;
    }

    if (this.tool.kind === 'build') {
      const building = this.tool.building;
      const def = BUILDINGS[building];
      const plots = draggable(building)
        ? plotsBetween(this.dragOrigin ?? this.hovered, this.hovered, def.size)
        : [this.hovered];
      const tints = plots.map((plot) =>
        this.world.canPlace(building, plot.x, plot.y).ok ? ALLOWED : REFUSED,
      );

      plots.forEach((plot, index) => {
        for (let dy = 0; dy < def.size; dy++) {
          for (let dx = 0; dx < def.size; dx++) {
            this.addTileMarker({ x: plot.x + dx, y: plot.y + dy }, tints[index]);
          }
        }
      });
      if (plots.length > 1) return;

      const structure = this.scene.structureFor(
        { ...structureLook(building), kind: building, variant: 0 },
        0,
      );
      const ghost = new Sprite(structure.texture);
      const height = this.world.grid.heightAt(this.hovered.x, this.hovered.y);
      const anchor = footprintAnchor(this.hovered.x, this.hovered.y, def.size, height);
      ghost.anchor.set(structure.anchorX, structure.anchorY);
      ghost.position.set(anchor.x, anchor.y);
      ghost.alpha = 0.6;
      ghost.tint = tints[0];
      this.scene.cursor.addChild(ghost);
    }
  }

  private addTileMarker(tile: Point, colour: number): void {
    const grid = this.world.grid;
    if (!grid.contains(tile.x, tile.y)) return;

    const marker = new Sprite(this.atlas.marker());
    const position = tileToScreen(tile.x, tile.y, grid.heightAt(tile.x, tile.y));
    marker.anchor.set(0.5);
    marker.position.set(position.x, position.y);
    marker.tint = colour;
    this.scene.cursor.addChild(marker);
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1e9);
}

function draggable(building: BuildingKind): boolean {
  return isDwelling(building);
}

function plotsBetween(from: Point, to: Point, size: number): Point[] {
  const plots: Point[] = [];
  const stepX = to.x >= from.x ? size : -size;
  const stepY = to.y >= from.y ? size : -size;
  const withinX = (x: number) => (stepX > 0 ? x <= to.x : x >= to.x);
  const withinY = (y: number) => (stepY > 0 ? y <= to.y : y >= to.y);

  for (let y = from.y; withinY(y); y += stepY) {
    for (let x = from.x; withinX(x); x += stepX) plots.push({ x, y });
  }
  return plots;
}

function roadPath(from: Point, to: Point): Point[] {
  const tiles: Point[] = [];
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);

  let x = from.x;
  let y = from.y;
  tiles.push({ x, y });

  while (x !== to.x) {
    x += stepX;
    tiles.push({ x, y });
  }
  while (y !== to.y) {
    y += stepY;
    tiles.push({ x, y });
  }
  return tiles;
}

