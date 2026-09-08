import { Container, Sprite } from 'pixi.js';
import { BUILDINGS, HOUSE_TIERS } from '../sim/buildings';
import { TERRAIN_WATER } from '../sim/grid';
import type { Building, BuildingKind } from '../sim/types';
import type { World } from '../sim/world';
import type { TileAtlas } from './atlas';
import type { BakedStructures } from './baked';
import { DecorLayer } from './decor';
import { TILE_WIDTH, depthOf, footprintAnchor, tileToScreen } from './iso';
import { Particles } from './particles';
import { TerrainLayer } from './terrain';
import {
  WALKER_FRAMES,
  WALKER_LOOKS,
  type StructureLook,
  type StructureRequest,
  type StructureSprite,
  type TextureCache,
} from './textures';

export type OverlayMode = 'none' | 'desirability';

const WALKER_FRAME_MS = 130;
const SMOKE_INTERVAL_MS = 700;
const SPRAY_INTERVAL_MS = 60;
const FOUNTAIN_SPOUT_Z = 0.92;
const PIXELS_PER_MODEL_UNIT_UP = (TILE_WIDTH / Math.SQRT2) * Math.cos(Math.PI / 6);
const CHIMNEYS: Record<number, { x: number; y: number; z: number }> = {
  2: { x: -0.16, y: 0.16, z: 1.0 },
  3: { x: -0.2, y: 0.2, z: 1.2 },
};
const DUST_INTERVAL_MS = 320;

interface BuildingEntry {
  sprite: Sprite;
  key: string;
}

export class Scene {
  readonly root = new Container();
  readonly cursor = new Container();

  private readonly world: World;
  private readonly atlas: TileAtlas;
  private readonly textures: TextureCache;
  private readonly terrain: TerrainLayer;
  private readonly decor: DecorLayer;
  private readonly particles: Particles;
  private readonly overlayTiles = new Container();
  private readonly structures = new Container();
  private readonly buildingSprites = new Map<number, BuildingEntry>();
  private readonly walkerSprites = new Map<number, Sprite>();
  private readonly overlaySprites: Sprite[] = [];
  private readonly emissionSchedule = new Map<number, number>();

  private overlayMode: OverlayMode = 'none';
  private syncedVersion = -1;
  private clock = 0;
  private baked: BakedStructures | null = null;
  private bakedVersion = 0;

  constructor(world: World, atlas: TileAtlas, textures: TextureCache) {
    this.world = world;
    this.atlas = atlas;
    this.textures = textures;
    this.terrain = new TerrainLayer(world, atlas);
    this.particles = new Particles(textures);

    this.structures.sortableChildren = true;
    this.decor = new DecorLayer(world, textures, this.structures);
    this.overlayTiles.visible = false;
    this.root.addChild(
      this.terrain.container,
      this.overlayTiles,
      this.structures,
      this.particles.container,
      this.cursor,
    );
    this.buildOverlay();
  }

  get currentOverlayMode(): OverlayMode {
    return this.overlayMode;
  }

  setBakedStructures(baked: BakedStructures): void {
    this.baked = baked;
    this.bakedVersion += 1;
  }

  structureFor(request: StructureRequest, bakedVariant: number): StructureSprite {
    return this.baked?.get(request.kind, bakedVariant, request.phase) ?? this.textures.structure(request);
  }

  setOverlayMode(mode: OverlayMode): void {
    this.overlayMode = mode;
    this.overlayTiles.visible = mode === 'desirability';
    if (mode === 'desirability') this.refreshOverlay();
  }

  sync(deltaMs: number, sunPhase: number): void {
    this.clock += deltaMs;
    const changedTiles = this.world.consumeChangedTiles();
    this.terrain.rebuildTiles(changedTiles);
    this.terrain.update(deltaMs);
    this.decor.sync(changedTiles);

    if (this.syncedVersion !== this.world.structureVersion) {
      this.syncedVersion = this.world.structureVersion;
      if (this.overlayMode === 'desirability') this.refreshOverlay();
    }

    this.syncBuildings(sunPhase);
    this.syncWalkers();
    this.emitParticles();
    this.particles.update(deltaMs);
  }

  private buildOverlay(): void {
    const { grid } = this.world;
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const sprite = new Sprite(this.atlas.overlay());
        const position = tileToScreen(x, y, grid.heightAt(x, y));
        sprite.anchor.set(0.5);
        sprite.position.set(position.x, position.y);
        sprite.alpha = 0.5;
        sprite.visible = grid.terrain[grid.index(x, y)] !== TERRAIN_WATER;
        this.overlayTiles.addChild(sprite);
        this.overlaySprites.push(sprite);
      }
    }
  }

  private refreshOverlay(): void {
    const { grid } = this.world;
    for (let index = 0; index < this.overlaySprites.length; index++) {
      this.overlaySprites[index].tint = desirabilityColour(grid.desirability[index]);
    }
  }

  private syncBuildings(sunPhase: number): void {
    for (const [id, entry] of this.buildingSprites) {
      if (this.world.buildings.has(id)) continue;
      entry.sprite.destroy();
      this.buildingSprites.delete(id);
      this.emissionSchedule.delete(id);
    }

    for (const building of this.world.buildings.values()) {
      const key = `${lookKey(building)}:${sunPhase}:${this.bakedVersion}`;
      const existing = this.buildingSprites.get(building.id);
      if (existing && existing.key === key) continue;
      if (existing) existing.sprite.destroy();

      const structure = this.structureFor(
        {
          ...lookOf(building),
          kind: building.kind,
          variant: variantOf(building.id),
          phase: sunPhase,
        },
        bakedVariantOf(building),
      );

      const sprite = new Sprite(structure.texture);
      const height = this.world.grid.heightAt(building.x, building.y);
      const anchor = footprintAnchor(building.x, building.y, building.size, height);
      sprite.anchor.set(structure.anchorX, structure.anchorY);
      sprite.position.set(anchor.x, anchor.y);
      sprite.zIndex = depthOf(building.x, building.y, building.size);
      this.structures.addChild(sprite);
      this.buildingSprites.set(building.id, { sprite, key });
    }
  }

  private syncWalkers(): void {
    for (const [id, sprite] of this.walkerSprites) {
      if (this.world.walkers.has(id)) continue;
      sprite.destroy();
      this.walkerSprites.delete(id);
    }

    const { grid } = this.world;
    const baseFrame = Math.floor(this.clock / WALKER_FRAME_MS);

    for (const walker of this.world.walkers.values()) {
      const fromX = grid.tileX(walker.from);
      const fromY = grid.tileY(walker.from);
      const toX = grid.tileX(walker.to);
      const toY = grid.tileY(walker.to);
      const x = fromX + (toX - fromX) * walker.progress;
      const y = fromY + (toY - fromY) * walker.progress;
      const height =
        grid.heightAt(fromX, fromY) +
        (grid.heightAt(toX, toY) - grid.heightAt(fromX, fromY)) * walker.progress;

      let sprite = this.walkerSprites.get(walker.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5, 0.92);
        this.structures.addChild(sprite);
        this.walkerSprites.set(walker.id, sprite);
      }

      sprite.texture = this.textures.walker(
        walker.kind,
        walker.id % WALKER_LOOKS,
        directionOf(toX - fromX, toY - fromY),
        (baseFrame + walker.id) % WALKER_FRAMES,
      );

      const position = tileToScreen(x, y, height);
      sprite.position.set(position.x, position.y);
      sprite.zIndex = x + y + 0.5;
    }
  }

  private emitParticles(): void {
    for (const building of this.world.buildings.values()) {
      if (building.kind !== 'house' || building.tier < 2) continue;
      if (!this.isDue(building.id, SMOKE_INTERVAL_MS)) continue;

      const height = this.world.grid.heightAt(building.x, building.y);
      const chimney = CHIMNEYS[building.tier];
      const position = tileToScreen(building.x + chimney.x, building.y + chimney.y, height);
      this.particles.smoke(position.x, position.y - chimney.z * PIXELS_PER_MODEL_UNIT_UP);
    }

    for (const building of this.world.buildings.values()) {
      if (building.kind !== 'fountain') continue;
      if (!this.isDue(building.id, SPRAY_INTERVAL_MS)) continue;

      const height = this.world.grid.heightAt(building.x, building.y);
      const position = tileToScreen(building.x, building.y, height);
      this.particles.spray(position.x, position.y - FOUNTAIN_SPOUT_Z * PIXELS_PER_MODEL_UNIT_UP);
    }

    const { grid } = this.world;
    for (const walker of this.world.walkers.values()) {
      if (walker.kind !== 'cartPusher') continue;
      if (!this.isDue(-walker.id, DUST_INTERVAL_MS)) continue;

      const x = grid.tileX(walker.from);
      const y = grid.tileY(walker.from);
      const position = tileToScreen(x, y, grid.heightAt(x, y));
      this.particles.dust(position.x, position.y);
    }
  }

  private isDue(id: number, interval: number): boolean {
    const next = this.emissionSchedule.get(id) ?? this.clock + Math.random() * interval;
    if (this.clock < next) {
      this.emissionSchedule.set(id, next);
      return false;
    }
    this.emissionSchedule.set(id, this.clock + interval * (0.7 + Math.random() * 0.6));
    return true;
  }
}

function directionOf(dx: number, dy: number): number {
  if (dx > 0) return 0;
  if (dy > 0) return 1;
  if (dx < 0) return 2;
  return 3;
}

function variantOf(id: number): number {
  return Math.abs((id * 2654435761) % 4);
}

function bakedVariantOf(building: Building): number {
  if (building.kind !== 'house') return 0;
  return building.tier * 2 + (variantOf(building.id) % 2);
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
  if (value > 0) return blend(0xf2f2c8, 0x2f9e44, Math.min(1, value / 20));
  if (value < 0) return blend(0xf2f2c8, 0xc9342b, Math.min(1, -value / 20));
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
