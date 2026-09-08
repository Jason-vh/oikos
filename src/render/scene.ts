import { Container, Sprite } from 'pixi.js';
import { BUILDINGS, HOUSE_TIERS } from '../sim/buildings';
import { TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_WATER } from '../sim/grid';
import type { Building, BuildingKind, WalkerKind } from '../sim/types';
import type { World } from '../sim/world';
import { depthOf, footprintAnchor, tileToScreen } from './iso';
import { TextureCache, shade, type StructureLook } from './textures';

const TERRAIN_COLOURS: Record<number, number> = {
  0: 0x6f9a52,
  [TERRAIN_MEADOW]: 0x8cbb5c,
  [TERRAIN_WATER]: 0x3d7fae,
  [TERRAIN_ROCK]: 0x8b8578,
};

const WALKER_COLOURS: Record<WalkerKind, number> = {
  cartPusher: 0xe0c060,
  foodVendor: 0xe07b3c,
  waterCarrier: 0x54b0e0,
};

export type OverlayMode = 'none' | 'desirability';

export class Scene {
  readonly root = new Container();
  readonly ground = new Container();
  readonly overlayTiles = new Container();
  readonly structures = new Container();
  readonly cursor = new Container();

  private readonly world: World;
  private readonly textures: TextureCache;
  private readonly buildingSprites = new Map<number, { sprite: Sprite; key: string }>();
  private readonly walkerSprites = new Map<number, Sprite>();
  private readonly groundSprites: Sprite[] = [];
  private readonly overlaySprites: Sprite[] = [];

  private syncedVersion = -1;
  private overlayMode: OverlayMode = 'none';

  constructor(world: World, textures: TextureCache) {
    this.world = world;
    this.textures = textures;
    this.structures.sortableChildren = true;
    this.overlayTiles.visible = false;
    this.root.addChild(this.ground, this.overlayTiles, this.structures, this.cursor);
    this.buildGround();
  }

  setOverlayMode(mode: OverlayMode): void {
    this.overlayMode = mode;
    this.overlayTiles.visible = mode === 'desirability';
    if (mode === 'desirability') this.refreshOverlay();
  }

  get currentOverlayMode(): OverlayMode {
    return this.overlayMode;
  }

  sync(): void {
    if (this.syncedVersion !== this.world.structureVersion) {
      this.syncedVersion = this.world.structureVersion;
      this.refreshGround();
      if (this.overlayMode === 'desirability') this.refreshOverlay();
    }
    this.syncBuildings();
    this.syncWalkers();
  }

  private buildGround(): void {
    const { grid } = this.world;
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const position = tileToScreen(x, y);

        const tile = new Sprite(this.groundTexture(x, y));
        tile.anchor.set(0.5);
        tile.position.set(position.x, position.y);
        this.ground.addChild(tile);
        this.groundSprites.push(tile);

        const overlay = new Sprite(this.textures.tile(0xffffff));
        overlay.anchor.set(0.5);
        overlay.position.set(position.x, position.y);
        overlay.alpha = 0.55;
        this.overlayTiles.addChild(overlay);
        this.overlaySprites.push(overlay);
      }
    }
  }

  private refreshGround(): void {
    const { grid } = this.world;
    for (let index = 0; index < this.groundSprites.length; index++) {
      this.groundSprites[index].texture = this.groundTexture(grid.tileX(index), grid.tileY(index));
    }
  }

  private refreshOverlay(): void {
    const { grid } = this.world;
    for (let index = 0; index < this.overlaySprites.length; index++) {
      const value = grid.desirability[index];
      this.overlaySprites[index].tint = desirabilityColour(value);
    }
  }

  private groundTexture(x: number, y: number) {
    const { grid } = this.world;
    const index = grid.index(x, y);
    if (grid.road[index] === 1) return this.textures.road();

    const base = TERRAIN_COLOURS[grid.terrain[index]] ?? TERRAIN_COLOURS[0];
    const variation = (x * 7 + y * 13) % 3 === 0 ? 0.94 : 1;
    return this.textures.tile(shade(base, variation));
  }

  private syncBuildings(): void {
    for (const [id, entry] of this.buildingSprites) {
      if (!this.world.buildings.has(id)) {
        entry.sprite.destroy();
        this.buildingSprites.delete(id);
      }
    }

    for (const building of this.world.buildings.values()) {
      const key = lookKey(building);
      const existing = this.buildingSprites.get(building.id);
      if (existing && existing.key === key) continue;

      if (existing) existing.sprite.destroy();

      const sprite = new Sprite(this.textures.structure(key, lookOf(building)));
      const anchor = footprintAnchor(building.x, building.y, building.size);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(anchor.x, anchor.y);
      sprite.zIndex = depthOf(building.x, building.y, building.size);
      this.structures.addChild(sprite);
      this.buildingSprites.set(building.id, { sprite, key });
    }
  }

  private syncWalkers(): void {
    for (const [id, sprite] of this.walkerSprites) {
      if (!this.world.walkers.has(id)) {
        sprite.destroy();
        this.walkerSprites.delete(id);
      }
    }

    const { grid } = this.world;
    for (const walker of this.world.walkers.values()) {
      let sprite = this.walkerSprites.get(walker.id);
      if (!sprite) {
        sprite = new Sprite(this.textures.walker(WALKER_COLOURS[walker.kind]));
        sprite.anchor.set(0.5, 0.8);
        this.structures.addChild(sprite);
        this.walkerSprites.set(walker.id, sprite);
      }

      const fromX = grid.tileX(walker.from);
      const fromY = grid.tileY(walker.from);
      const toX = grid.tileX(walker.to);
      const toY = grid.tileY(walker.to);
      const x = fromX + (toX - fromX) * walker.progress;
      const y = fromY + (toY - fromY) * walker.progress;
      const position = tileToScreen(x, y);
      sprite.position.set(position.x, position.y);
      sprite.zIndex = x + y + 0.5;
    }
  }
}

function lookKey(building: Building): string {
  if (building.kind === 'house') return `house:${building.tier}`;
  return building.kind;
}

function lookOf(building: Building): StructureLook {
  if (building.kind === 'house') {
    const tier = HOUSE_TIERS[building.tier];
    return { size: 1, height: tier.height, colour: tier.colour, roofColour: tier.roofColour };
  }
  return structureLook(building.kind);
}

export function structureLook(kind: BuildingKind): StructureLook {
  const def = BUILDINGS[kind];
  return { size: def.size, height: def.height, colour: def.colour, roofColour: def.roofColour };
}

function desirabilityColour(value: number): number {
  if (value > 0) {
    const strength = Math.min(1, value / 20);
    return blend(0xf2f2c8, 0x2f9e44, strength);
  }
  if (value < 0) {
    const strength = Math.min(1, -value / 20);
    return blend(0xf2f2c8, 0xc9342b, strength);
  }
  return 0xf2f2c8;
}

function blend(from: number, to: number, amount: number): number {
  const mix = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
