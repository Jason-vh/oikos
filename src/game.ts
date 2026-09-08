import { Application, Sprite } from 'pixi.js';
import { Camera } from './render/camera';
import { attachKeyboardPan, attachPointerInput } from './render/input';
import { footprintAnchor, tileToScreen, type Point } from './render/iso';
import { Scene, structureLook } from './render/scene';
import { TextureCache } from './render/textures';
import { BUILDINGS, HOUSE_TIERS, ROAD_COST } from './sim/buildings';
import { TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_WATER } from './sim/grid';
import type { BuildingKind } from './sim/types';
import { TICKS_PER_SECOND, World } from './sim/world';

export type Tool =
  | { kind: 'inspect' }
  | { kind: 'road' }
  | { kind: 'demolish' }
  | { kind: 'build'; building: BuildingKind };

const MAP_SIZE = 48;
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME = 40;

export class Game {
  readonly world: World;
  readonly scene: Scene;
  readonly camera = new Camera();

  tool: Tool = { kind: 'road' };
  speed = 1;

  private readonly textures: TextureCache;
  private readonly panKeyboard: () => void;
  private hovered: Point = { x: -1, y: -1 };
  private dragOrigin: Point | null = null;
  private accumulator = 0;
  private cursorKey = '';

  constructor(app: Application, seed = Math.floor(Math.random() * 1e9)) {
    this.world = new World(MAP_SIZE, seed);
    this.textures = new TextureCache(app.renderer);
    this.scene = new Scene(this.world, this.textures);
    this.panKeyboard = attachKeyboardPan(this.camera);

    app.stage.addChild(this.scene.root);
    this.camera.centreOnTile(MAP_SIZE / 2, MAP_SIZE / 2, app.screen.width, app.screen.height);

    attachPointerInput(app.canvas, this.camera, {
      hover: (tile) => {
        this.hovered = tile;
      },
      press: (tile) => this.onPress(tile),
      drag: (tile) => this.onDrag(tile),
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

    this.scene.sync();
    this.updateCursor();
    this.camera.applyTo(this.scene.root);
  }

  toggleDesirabilityOverlay(): void {
    const next = this.scene.currentOverlayMode === 'desirability' ? 'none' : 'desirability';
    this.scene.setOverlayMode(next);
  }

  describeHover(): string {
    const { x, y } = this.hovered;
    if (!this.world.grid.contains(x, y)) return '—';

    const grid = this.world.grid;
    const index = grid.index(x, y);
    const building = this.world.buildingAt(index);
    const desirability = grid.desirability[index];

    if (building) {
      const name =
        building.kind === 'house'
          ? `${HOUSE_TIERS[building.tier].name} (${building.population})`
          : BUILDINGS[building.kind].name;
      const detail = describeBuildingState(building.kind, building.stock, building.supply);
      return `${name} · desirability ${desirability}${detail}`;
    }

    if (grid.isRoad(index)) return `Road · desirability ${desirability}`;
    return `${terrainName(grid.terrain[index])} · desirability ${desirability}`;
  }

  private onPress(tile: Point): void {
    this.hovered = tile;
    this.dragOrigin = tile;

    if (this.tool.kind === 'demolish') {
      this.world.demolish(tile.x, tile.y);
      return;
    }
    if (this.tool.kind === 'build') this.tryBuild(tile);
  }

  private onDrag(tile: Point): void {
    this.hovered = tile;
    if (this.tool.kind === 'demolish') this.world.demolish(tile.x, tile.y);
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
        this.addTileMarker(tile, this.world.canPlaceRoad(tile.x, tile.y) ? 0x7bd88f : 0xe06060);
      }
      return;
    }

    if (this.tool.kind === 'demolish') {
      this.addTileMarker(this.hovered, 0xe06060);
      return;
    }

    if (this.tool.kind === 'build') {
      const def = BUILDINGS[this.tool.building];
      const check = this.world.canPlace(this.tool.building, this.hovered.x, this.hovered.y);
      const tint = check.ok ? 0x7bd88f : 0xe06060;

      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          this.addTileMarker({ x: this.hovered.x + dx, y: this.hovered.y + dy }, tint);
        }
      }

      const ghost = new Sprite(
        this.textures.structure(this.tool.building, structureLook(this.tool.building)),
      );
      const anchor = footprintAnchor(this.hovered.x, this.hovered.y, def.size);
      ghost.anchor.set(0.5, 1);
      ghost.position.set(anchor.x, anchor.y);
      ghost.alpha = 0.55;
      ghost.tint = tint;
      this.scene.cursor.addChild(ghost);
    }
  }

  private addTileMarker(tile: Point, colour: number): void {
    if (!this.world.grid.contains(tile.x, tile.y)) return;
    const marker = new Sprite(this.textures.selection(colour));
    const position = tileToScreen(tile.x, tile.y);
    marker.anchor.set(0.5);
    marker.position.set(position.x, position.y);
    this.scene.cursor.addChild(marker);
  }

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
  return 'Grass';
}

function describeBuildingState(
  kind: BuildingKind,
  stock: number,
  supply: { food: number; water: number },
): string {
  if (kind === 'granary' || kind === 'wheatFarm') return ` · food ${stock}`;
  if (kind === 'house') {
    return ` · water ${Math.round(supply.water)} · food ${Math.round(supply.food)}`;
  }
  return '';
}
