import { Container, Matrix, Sprite } from 'pixi.js';
import { TERRAIN_WATER } from '../sim/grid';
import type { World } from '../sim/world';
import { CLIFF_VARIANTS, TERRAIN_PRIORITY, TERRAIN_VARIANTS, ROAD_VARIANTS, WATER_FRAMES, TileAtlas } from './atlas';
import { roadGradeAt } from './roads';
import type { BlendDirection } from './atlas';
import { shade } from './canvas';
import { ELEVATION_STEP, TILE_HEIGHT, TILE_WIDTH, tileToScreen } from './iso';

const WATER_FRAME_MS = 150;
const RIM_LIFT = 9;
const BAND_HEIGHT = ELEVATION_STEP + 4;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;

interface NeighbourEdge {
  dx: number;
  dy: number;
  direction: BlendDirection;
}

const EDGES: NeighbourEdge[] = [
  { dx: 1, dy: 0, direction: 'east' },
  { dx: 0, dy: 1, direction: 'south' },
  { dx: -1, dy: 0, direction: 'west' },
  { dx: 0, dy: -1, direction: 'north' },
];

export class TerrainLayer {
  readonly container = new Container();

  private readonly world: World;
  private readonly atlas: TileAtlas;
  private readonly tileSprites: Sprite[][];
  private readonly waterSprites: { sprite: Sprite; offset: number }[] = [];
  private readonly roadGrades: Int8Array;
  private elapsed = 0;
  private frame = 0;

  constructor(world: World, atlas: TileAtlas) {
    this.world = world;
    this.atlas = atlas;
    this.container.sortableChildren = true;
    this.tileSprites = new Array(world.grid.size * world.grid.size).fill(null).map(() => []);
    this.roadGrades = new Int8Array(world.grid.size * world.grid.size).fill(-1);
    this.rebuildAll();
  }

  rebuildAll(): void {
    const total = this.world.grid.size * this.world.grid.size;
    for (let index = 0; index < total; index++) this.buildTile(index);
  }

  rebuildTiles(tiles: number[]): void {
    for (const tile of tiles) this.buildTile(tile);
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (this.elapsed < WATER_FRAME_MS) return;

    this.elapsed = 0;
    this.frame = (this.frame + 1) % WATER_FRAMES;
    for (const water of this.waterSprites) {
      water.sprite.texture = this.atlas.water(this.frame + water.offset);
    }
  }

  private buildTile(index: number): void {
    this.clearTile(index);

    const { grid } = this.world;
    const x = grid.tileX(index);
    const y = grid.tileY(index);
    const height = grid.height[index];
    const terrain = grid.terrain[index];
    const depth = (x + y) * 10;
    const screen = tileToScreen(x, y, height);
    const sprites = this.tileSprites[index];

    const tint = groundTint(x, y, height);
    const base = new Sprite(this.baseTexture(index, x, y, terrain));
    base.anchor.set(0.5);
    base.position.set(screen.x, screen.y);
    base.zIndex = depth;
    base.tint = tint;
    sprites.push(base);

    if (terrain === TERRAIN_WATER) {
      this.waterSprites.push({ sprite: base, offset: variantOf(x, y, WATER_FRAMES) });
      this.addShores(x, y, screen, depth, sprites);
    } else if (grid.road[index] === 0) {
      this.addBlends(x, y, height, terrain, screen, depth, tint, sprites);
    }

    this.addCliffs(x, y, height, screen, depth, sprites);
    for (const sprite of sprites) this.container.addChild(sprite);
  }

  private baseTexture(index: number, x: number, y: number, terrain: number) {
    const { grid } = this.world;
    if (terrain === TERRAIN_WATER) return this.atlas.water(variantOf(x, y, WATER_FRAMES));
    if (grid.road[index] === 1) {
      this.roadGrades[index] = roadGradeAt(grid.appeal[index]);
      return this.atlas.road(this.roadGrades[index], variantOf(x, y, ROAD_VARIANTS));
    }
    return this.atlas.terrain(terrain, variantOf(x, y, TERRAIN_VARIANTS));
  }

  repaveRoads(): void {
    const { grid } = this.world;
    for (let index = 0; index < grid.road.length; index++) {
      if (grid.road[index] !== 1) continue;
      if (roadGradeAt(grid.appeal[index]) === this.roadGrades[index]) continue;
      this.buildTile(index);
    }
  }

  private addBlends(
    x: number,
    y: number,
    height: number,
    terrain: number,
    screen: { x: number; y: number },
    depth: number,
    tint: number,
    sprites: Sprite[],
  ): void {
    const { grid } = this.world;
    const priority = TERRAIN_PRIORITY[terrain] ?? 0;

    for (const edge of EDGES) {
      const nx = x + edge.dx;
      const ny = y + edge.dy;
      if (!grid.contains(nx, ny)) continue;

      const neighbourIndex = grid.index(nx, ny);
      if (grid.height[neighbourIndex] !== height) continue;

      const neighbourTerrain = grid.terrain[neighbourIndex];
      if (neighbourTerrain === TERRAIN_WATER || neighbourTerrain === terrain) continue;
      if ((TERRAIN_PRIORITY[neighbourTerrain] ?? 0) <= priority) continue;

      const blend = new Sprite(this.atlas.blend(neighbourTerrain, edge.direction));
      blend.anchor.set(0.5);
      blend.position.set(screen.x, screen.y);
      blend.zIndex = depth + 1;
      blend.tint = tint;
      sprites.push(blend);
    }
  }

  private addShores(x: number, y: number, screen: { x: number; y: number }, depth: number, sprites: Sprite[]): void {
    const { grid } = this.world;

    for (const edge of EDGES) {
      const nx = x + edge.dx;
      const ny = y + edge.dy;
      if (!grid.contains(nx, ny)) continue;
      if (grid.terrain[grid.index(nx, ny)] === TERRAIN_WATER) continue;

      const shore = new Sprite(this.atlas.shore(edge.direction));
      shore.anchor.set(0.5);
      shore.position.set(screen.x, screen.y);
      shore.zIndex = depth + 1;
      sprites.push(shore);
    }
  }

  private addCliffs(
    x: number,
    y: number,
    height: number,
    screen: { x: number; y: number },
    depth: number,
    sprites: Sprite[],
  ): void {
    const { grid } = this.world;

    const faces = [
      {
        neighbour: { x: x + 1, y },
        origin: { x: screen.x + HALF_W, y: screen.y },
        span: { x: -HALF_W, y: HALF_H },
        face: 'right' as const,
      },
      {
        neighbour: { x, y: y + 1 },
        origin: { x: screen.x - HALF_W, y: screen.y },
        span: { x: HALF_W, y: HALF_H },
        face: 'left' as const,
      },
    ];

    for (const face of faces) {
      const neighbourHeight = grid.contains(face.neighbour.x, face.neighbour.y)
        ? grid.heightAt(face.neighbour.x, face.neighbour.y)
        : 0;
      const drop = (height - neighbourHeight) * ELEVATION_STEP;
      if (drop <= 0) continue;

      const levels = Math.round(drop / ELEVATION_STEP);
      for (let level = 0; level < levels; level++) {
        const band = new Sprite(this.atlas.cliff(face.face, variantOf(x + level, y, CLIFF_VARIANTS)));
        band.setFromMatrix(
          this.cliffMatrix(face.origin, face.span, band.texture.frame, BAND_HEIGHT, -level * ELEVATION_STEP),
        );
        band.zIndex = depth + 2 + level;
        sprites.push(band);
      }

      const rim = new Sprite(this.atlas.cliffRim(face.face, variantOf(x, y, CLIFF_VARIANTS)));
      rim.setFromMatrix(
        this.cliffMatrix(face.origin, face.span, rim.texture.frame, rim.texture.frame.height, RIM_LIFT),
      );
      rim.zIndex = depth + 2 + levels;
      sprites.push(rim);
    }
  }

  private cliffMatrix(
    origin: { x: number; y: number },
    span: { x: number; y: number },
    frame: { width: number; height: number },
    drawnHeight: number,
    lift: number,
  ): Matrix {
    return new Matrix(
      span.x / frame.width,
      span.y / frame.width,
      0,
      drawnHeight / frame.height,
      origin.x,
      origin.y - lift,
    );
  }

  private clearTile(index: number): void {
    const sprites = this.tileSprites[index];
    for (const sprite of sprites) {
      const water = this.waterSprites.findIndex((entry) => entry.sprite === sprite);
      if (water >= 0) this.waterSprites.splice(water, 1);
      sprite.destroy();
    }
    sprites.length = 0;
  }
}

function groundTint(x: number, y: number, height: number): number {
  const noise = 0.5 + 0.25 * Math.sin(x * 0.21 + 0.7) + 0.25 * Math.sin(y * 0.17 + 2.1);
  return shade(0xffffff, 0.985 + 0.015 * noise + height * 0.008);
}

function variantOf(x: number, y: number, count: number): number {
  const hash = (x * 73856093) ^ (y * 19349663);
  return Math.abs(hash) % count;
}
