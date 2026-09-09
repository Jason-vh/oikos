import { Container, Sprite } from 'pixi.js';
import { BUILDINGS, isDwelling, isVacantPlot, tierOf } from '../sim/buildings';
import { STALL_SIZE, VENDOR_GOODS, isAgora, stallSlots } from '../sim/agora';
import { FINISHED, type ServiceKind } from '../sim/types';
import { TERRAIN_WATER } from '../sim/grid';
import { RISK_LIMIT, riskOf } from '../sim/hazards';
import type { Building, BuildingKind, Good } from '../sim/types';
import type { World } from '../sim/world';
import type { TileAtlas } from './atlas';
import type { BakedStructures } from './baked';
import { DecorLayer } from './decor';
import { TILE_WIDTH, depthOf, footprintAnchor, tileToScreen } from './iso';
import { Gulls } from './gulls';
import { Particles } from './particles';
import { BarrierLayer } from './barriers';
import { TerrainLayer } from './terrain';
import {
  WALKER_FRAMES,
  WALKER_LOOKS,
  type StructureKind,
  type StructureLook,
  type StructureRequest,
  type StructureSprite,
  type TextureCache,
} from './textures';

export type OverlayMode = 'none' | 'appeal' | 'hazard' | 'water' | 'culture' | 'safety';

const SERVICE_OF_OVERLAY: Partial<Record<OverlayMode, ServiceKind>> = {
  water: 'water',
  culture: 'culture',
  safety: 'safety',
};

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
const APPEAL_COLOUR_SCALE = 20;
const GROUND_DEPTH = -0.5;
const STALL_TINTS: Record<Good, number> = {
  food: 0xe8c96a,
  fleece: 0xe8e0d0,
  oil: 0x9fbf5a,
  wine: 0xa8567a,
  armour: 0xa9b0bb,
  horses: 0xc08a4e,
  olives: 0x9fbf5a,
  grapes: 0xa8567a,
  wood: 0x9a7040,
  marble: 0xf0ece0,
  bronze: 0xb08040,
  sculpture: 0xf0ece0,
};
const SERVED_SUPPLY = 40;
const SHADOW_ALPHA = 0.45;

interface BuildingEntry {
  key: string;
  body: Sprite;
  shadow: Sprite | null;
  stalls: Sprite[];
}

export class Scene {
  readonly root = new Container();
  readonly cursor = new Container();

  private readonly world: World;
  private readonly atlas: TileAtlas;
  private readonly textures: TextureCache;
  private readonly terrain: TerrainLayer;
  private readonly decor: DecorLayer;
  private readonly barriers: BarrierLayer;
  private readonly particles: Particles;
  private readonly gulls: Gulls;
  private readonly overlayTiles = new Container();
  private readonly shadows = new Container();
  private readonly structures = new Container();
  private readonly buildingSprites = new Map<number, BuildingEntry>();
  private readonly walkerSprites = new Map<number, Sprite>();
  private readonly unitSprites = new Map<number, Sprite>();
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
    this.gulls = new Gulls(world, textures);

    this.shadows.sortableChildren = true;
    this.structures.sortableChildren = true;
    this.decor = new DecorLayer(world, textures, this.structures);
    this.barriers = new BarrierLayer(world, textures, this.structures);
    this.overlayTiles.visible = false;
    this.markEntry();
    this.root.addChild(
      this.terrain.container,
      this.overlayTiles,
      this.shadows,
      this.structures,
      this.particles.container,
      this.gulls.container,
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
    return this.baked?.get(request.kind, bakedVariant) ?? this.textures.structure(request);
  }

  setOverlayMode(mode: OverlayMode): void {
    this.overlayMode = mode;
    this.overlayTiles.visible = mode === 'appeal';
    if (mode === 'none') this.clearBuildingTints();
    if (mode !== 'none') this.refreshOverlay();
  }

  sync(deltaMs: number): void {
    this.clock += deltaMs;
    const changedTiles = this.world.consumeChangedTiles();
    this.terrain.rebuildTiles(changedTiles);
    this.terrain.update(deltaMs);
    this.decor.sync(changedTiles);
    this.barriers.sync(changedTiles);

    if (this.syncedVersion !== this.world.structureVersion) {
      this.syncedVersion = this.world.structureVersion;
      this.terrain.repaveRoads();
      if (this.overlayMode === 'appeal') this.refreshOverlay();
    }

    this.syncBuildings();
    if (this.overlayMode !== 'none' && this.overlayMode !== 'appeal') this.refreshOverlay();
    this.syncWalkers();
    this.syncUnits();
    this.emitParticles();
    this.particles.update(deltaMs);
    this.gulls.update(deltaMs);
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
    if (this.overlayMode === 'hazard') {
      for (const [id, entry] of this.buildingSprites) {
        entry.body.tint = hazardColour(this.world.buildings.get(id));
      }
      return;
    }

    const service = SERVICE_OF_OVERLAY[this.overlayMode];
    if (service) {
      for (const [id, entry] of this.buildingSprites) {
        entry.body.tint = serviceColour(this.world.buildings.get(id), service);
      }
      return;
    }

    const { grid } = this.world;
    for (let index = 0; index < this.overlaySprites.length; index++) {
      this.overlaySprites[index].tint = appealColour(grid.appeal[index]);
    }
  }

  private clearBuildingTints(): void {
    for (const [id, entry] of this.buildingSprites) {
      entry.body.tint = unfinishedTint(this.world.buildings.get(id));
    }
  }

  private syncBuildings(): void {
    for (const [id, entry] of this.buildingSprites) {
      if (this.world.buildings.has(id)) continue;
      destroyBuilding(entry);
      this.buildingSprites.delete(id);
      this.emissionSchedule.delete(id);
    }

    for (const building of this.world.buildings.values()) {
      const key = `${lookKey(building)}:${this.bakedVersion}`;
      const existing = this.buildingSprites.get(building.id);
      if (existing && existing.key === key) {
        if (this.overlayMode === 'none') existing.body.tint = unfinishedTint(building);
        continue;
      }
      if (existing) destroyBuilding(existing);

      const entry = this.createBuilding(building, key);
      entry.body.tint = unfinishedTint(building);
      this.buildingSprites.set(building.id, entry);
    }
  }

  private createBuilding(building: Building, key: string): BuildingEntry {
    const depth = isAgora(building.kind)
      ? GROUND_DEPTH + building.x + building.y
      : depthOf(building.x, building.y, building.width, building.height);
    const anchor = footprintAnchor(
      building.x,
      building.y,
      building.width,
      building.height,
      this.world.grid.heightAt(building.x, building.y),
    );

    const place = (structure: StructureSprite, layer: Container): Sprite => {
      const sprite = new Sprite(structure.texture);
      sprite.anchor.set(structure.anchorX, structure.anchorY);
      sprite.position.set(anchor.x, anchor.y);
      sprite.zIndex = depth;
      layer.addChild(sprite);
      return sprite;
    };

    const cast = this.shadowFor(building);
    const shadow = cast ? place(cast, this.shadows) : null;
    if (shadow) shadow.alpha = SHADOW_ALPHA;

    return {
      key,
      shadow,
      body: place(this.bodyFor(building), this.structures),
      stalls: this.raiseStalls(building),
    };
  }

  private raiseStalls(building: Building): Sprite[] {
    const ground = this.world.grid.heightAt(building.x, building.y);

    return stallSlots(building).flatMap((slot, index) => {
      const good = building.stalls[index];
      if (!good) return [];

      const variant = VENDOR_GOODS.indexOf(good);
      const anchor = footprintAnchor(slot.x, slot.y, STALL_SIZE, STALL_SIZE, ground);
      const depth = depthOf(slot.x, slot.y, STALL_SIZE, STALL_SIZE);

      const raise = (structure: StructureSprite, layer: Container, alpha = 1): Sprite => {
        const sprite = new Sprite(structure.texture);
        sprite.anchor.set(structure.anchorX, structure.anchorY);
        sprite.position.set(anchor.x, anchor.y);
        sprite.zIndex = depth;
        sprite.alpha = alpha;
        layer.addChild(sprite);
        return sprite;
      };

      const cast = this.baked?.shadow('stall', variant);
      const shadow = cast ? [raise(cast, this.shadows, SHADOW_ALPHA)] : [];

      const stall = this.baked?.get('stall', variant) ?? this.textures.stall();
      const body = raise(stall, this.structures);
      if (!this.baked) body.tint = STALL_TINTS[good];
      return [...shadow, body];
    });
  }

  private bodyFor(building: Building): StructureSprite {
    if (isVacantPlot(building)) {
      return this.baked?.get(plotKind(building), 0) ?? this.textures.plot(building.width);
    }
    if (isAgora(building.kind)) {
      return (
        this.baked?.get(building.kind, alongAxisOf(building)) ??
        this.textures.paving(building.width, building.height)
      );
    }

    return this.structureFor(
      { ...lookOf(building), kind: building.kind, variant: variantOf(building.id) },
      bakedVariantOf(building),
    );
  }

  private shadowFor(building: Building): StructureSprite | undefined {
    if (isVacantPlot(building)) return this.baked?.shadow(plotKind(building), 0);
    if (isAgora(building.kind)) return undefined;
    return this.baked?.shadow(building.kind, bakedVariantOf(building));
  }

  private markEntry(): void {
    const { grid } = this.world;
    const x = grid.tileX(this.world.entry);
    const y = grid.tileY(this.world.entry);
    const flag = this.textures.entryFlag();

    const sprite = new Sprite(flag.texture);
    sprite.anchor.set(flag.anchorX, flag.anchorY);
    const position = tileToScreen(x, y, grid.height[this.world.entry]);
    sprite.position.set(position.x, position.y);
    sprite.zIndex = x + y;
    this.structures.addChild(sprite);
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

  private syncUnits(): void {
    const live = new Set(this.world.units.map((unit) => unit.id));
    for (const [id, sprite] of this.unitSprites) {
      if (live.has(id)) continue;
      sprite.destroy();
      this.unitSprites.delete(id);
    }

    const { grid } = this.world;
    const baseFrame = Math.floor(this.clock / WALKER_FRAME_MS);

    for (const unit of this.world.units) {
      const x = unit.fromX + (unit.x - unit.fromX) * unit.progress;
      const y = unit.fromY + (unit.y - unit.fromY) * unit.progress;

      let sprite = this.unitSprites.get(unit.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5, 0.92);
        this.structures.addChild(sprite);
        this.unitSprites.set(unit.id, sprite);
      }

      sprite.texture = this.textures.walker(
        unit.side === 'city' ? 'soldier' : 'invader',
        unit.id % WALKER_LOOKS,
        directionOf(unit.x - unit.fromX, unit.y - unit.fromY),
        (baseFrame + unit.id) % WALKER_FRAMES,
      );

      const position = tileToScreen(x, y, grid.heightAt(unit.x, unit.y));
      sprite.position.set(position.x, position.y);
      sprite.zIndex = x + y + 0.6;
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

function destroyBuilding(entry: BuildingEntry): void {
  entry.body.destroy();
  entry.shadow?.destroy();
  for (const stall of entry.stalls) stall.destroy();
}

function alongAxisOf(building: Building): number {
  return building.width >= building.height ? 0 : 1;
}

function bakedVariantOf(building: Building): number {
  if (building.kind === 'estate') return building.tier;
  if (building.kind !== 'house') return 0;
  return building.tier * 2 + (variantOf(building.id) % 2);
}

function lookKey(building: Building): string {
  if (isVacantPlot(building)) return `${building.kind}:plot`;
  if (isDwelling(building.kind)) return `${building.kind}:${building.tier}`;
  if (isAgora(building.kind)) return `${building.kind}:${alongAxisOf(building)}:${building.stalls.join()}`;
  return building.kind;
}

function plotKind(building: Building): StructureKind {
  return building.kind === 'estate' ? 'estatePlot' : 'housePlot';
}

function lookOf(building: Building): StructureLook {
  if (isDwelling(building.kind)) {
    const tier = tierOf(building);
    const def = BUILDINGS[building.kind];
    return { size: def.size, height: tier.height, colour: tier.colour, roofColour: tier.roofColour };
  }
  return structureLook(building.kind);
}

export function structureLook(kind: BuildingKind): StructureLook {
  const def = BUILDINGS[kind];
  return { size: def.size, height: def.height, colour: def.colour, roofColour: def.roofColour };
}

function serviceColour(building: Building | undefined, service: ServiceKind): number {
  if (!building) return 0xffffff;
  if (!isDwelling(building.kind)) return 0xb9b9b9;
  return blend(0xff6b5a, 0x6fd08c, Math.min(1, building.supply[service] / SERVED_SUPPLY));
}

function unfinishedTint(building: Building | undefined): number {
  if (!building || building.built >= FINISHED) return 0xffffff;
  return blend(0x8a8478, 0xffffff, building.built / FINISHED);
}

function hazardColour(building: Building | undefined): number {
  if (!building) return 0xffffff;
  return blend(0x9ce8a0, 0xff4b3a, riskOf(building) / RISK_LIMIT);
}

function appealColour(value: number): number {
  if (value > 0) return blend(0xf2f2c8, 0x2f9e44, Math.min(1, value / APPEAL_COLOUR_SCALE));
  if (value < 0) return blend(0xf2f2c8, 0xc9342b, Math.min(1, -value / APPEAL_COLOUR_SCALE));
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
