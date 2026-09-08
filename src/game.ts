import { Application, Container, Sprite } from 'pixi.js';
import { Atmosphere } from './render/atmosphere';
import { TileAtlas } from './render/atlas';
import { Camera } from './render/camera';
import { attachKeyboardPan, attachPointerInput } from './render/input';
import { footprintAnchor, pickTile, tileToScreen, type Point } from './render/iso';
import { Scene, structureLook } from './render/scene';
import { TextureCache } from './render/textures';
import { BUILDINGS, HOUSE_TIERS, ROAD_COST } from './sim/buildings';
import { MAX_HEIGHT, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from './sim/grid';
import type { View } from './sim/save';
import type { Building, BuildingKind } from './sim/types';
import { TICKS_PER_SECOND } from './sim/time';
import { World } from './sim/world';

export type Tool =
  | { kind: 'inspect' }
  | { kind: 'road' }
  | { kind: 'roadblock' }
  | { kind: 'demolish' }
  | { kind: 'build'; building: BuildingKind };

const MAP_SIZE = 48;
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME = 40;

export class Game {
  readonly world: World;
  readonly scene: Scene;
  readonly camera = new Camera();
  readonly atmosphere: Atmosphere;

  tool: Tool = { kind: 'road' };
  speed = 1;

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
    this.atmosphere = new Atmosphere(app, this.textures);
    this.panKeyboard = attachKeyboardPan(this.camera);

    const worldLayer = new Container();
    worldLayer.addChild(this.scene.root);
    app.stage.addChild(worldLayer, this.atmosphere.overlay);
    this.atmosphere.attach(worldLayer);

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

  resize(): void {
    this.atmosphere.resize();
  }

  toggleAppealOverlay(): void {
    const next = this.scene.currentOverlayMode === 'appeal' ? 'none' : 'appeal';
    this.scene.setOverlayMode(next);
  }

  describeHover(): string {
    const { x, y } = this.hovered;
    const grid = this.world.grid;
    if (!grid.contains(x, y)) return '—';

    const index = grid.index(x, y);
    const building = this.world.buildingAt(index);
    const suffix = `appeal ${grid.appeal[index]} · level ${grid.height[index]}`;

    if (building) {
      const name =
        building.kind === 'house'
          ? `${HOUSE_TIERS[building.tier].name} (${building.population})`
          : BUILDINGS[building.kind].name;
      return `${name}${describeStaff(building)}${describeBuildingState(building.kind, building.stock, building.supply)} · ${suffix}`;
    }

    if (grid.isRoadblock(index)) return `Roadblock · turns roaming walkers back · ${suffix}`;
    if (grid.isRoad(index)) return `Road · ${suffix}`;
    return `${terrainName(grid.terrain[index])} · ${suffix}`;
  }

  private resolveTile(world: Point): Point {
    return pickTile(world.x, world.y, (x, y) => this.world.grid.heightAt(x, y), MAX_HEIGHT);
  }

  private onPress(tile: Point): void {
    this.hovered = tile;
    this.dragOrigin = tile;

    if (this.tool.kind === 'demolish') {
      this.world.demolish(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'roadblock') {
      this.world.placeRoadblock(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'build') this.tryBuild(tile);
  }

  private onDrag(tile: Point): void {
    this.hovered = tile;
    if (this.tool.kind === 'demolish') this.world.demolish(tile.x, tile.y);
    if (this.tool.kind === 'roadblock') this.world.placeRoadblock(tile.x, tile.y);
    if (this.tool.kind === 'build' && BUILDINGS[this.tool.building].size === 1) this.tryBuild(tile);
  }

  private onRelease(): void {
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
        this.addTileMarker(tile, this.world.canPlaceRoad(tile.x, tile.y) ? 0x8ce39a : 0xe07070);
      }
      return;
    }

    if (this.tool.kind === 'demolish') {
      this.addTileMarker(this.hovered, 0xe07070);
      return;
    }

    if (this.tool.kind === 'roadblock') {
      const allowed = this.world.canPlaceRoadblock(this.hovered.x, this.hovered.y);
      this.addTileMarker(this.hovered, allowed ? 0x8ce39a : 0xe07070);
      return;
    }

    if (this.tool.kind === 'build') {
      const def = BUILDINGS[this.tool.building];
      const check = this.world.canPlace(this.tool.building, this.hovered.x, this.hovered.y);
      const tint = check.ok ? 0x8ce39a : 0xe07070;

      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          this.addTileMarker({ x: this.hovered.x + dx, y: this.hovered.y + dy }, tint);
        }
      }

      const structure = this.scene.structureFor(
        {
          ...structureLook(this.tool.building),
          kind: this.tool.building,
          variant: 0,
        },
        0,
      );
      const ghost = new Sprite(structure.texture);
      const height = this.world.grid.heightAt(this.hovered.x, this.hovered.y);
      const anchor = footprintAnchor(this.hovered.x, this.hovered.y, def.size, height);
      ghost.anchor.set(structure.anchorX, structure.anchorY);
      ghost.position.set(anchor.x, anchor.y);
      ghost.alpha = 0.6;
      ghost.tint = tint;
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

function terrainName(terrain: number): string {
  if (terrain === TERRAIN_WATER) return 'Water';
  if (terrain === TERRAIN_MEADOW) return 'Meadow';
  if (terrain === TERRAIN_ROCK) return 'Rocks';
  if (terrain === TERRAIN_SAND) return 'Sand';
  return 'Grass';
}

function describeStaff(building: Building): string {
  const needed = BUILDINGS[building.kind].workers;
  if (needed === 0) return '';
  return ` · ${building.staff}/${needed} workers`;
}

function describeBuildingState(
  kind: BuildingKind,
  stock: number,
  supply: { food: number; water: number },
): string {
  if (kind === 'granary' || kind === 'wheatFarm') return ` · food ${stock}`;
  if (kind === 'house') return ` · water ${Math.round(supply.water)} · food ${Math.round(supply.food)}`;
  return '';
}
