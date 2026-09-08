import { Container, Matrix, Sprite } from 'pixi.js';
import { TERRAIN_WATER } from '../sim/grid';
import type { World } from '../sim/world';
import { TERRAIN_PRIORITY, TERRAIN_VARIANTS, ROAD_VARIANTS, WATER_FRAMES, TileAtlas } from './atlas';
import type { BlendDirection } from './atlas';
import { shade } from './canvas';
import { ELEVATION_STEP, TILE_HEIGHT, TILE_WIDTH, tileToScreen } from './iso';

const WATER_FRAME_MS = 150;
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
  private elapsed = 0;
  private frame = 0;

  constructor(world: World, atlas: TileAtlas) {
    this.world = world;
    this.atlas = atlas;
    this.container.sortableChildren = true;
    this.tileSprites = new Array(world.grid.size * world.grid.size).fill(null).map(() => []);
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
    if (grid.road[index] === 1) return this.atlas.road(variantOf(x, y, ROAD_VARIANTS));
    return this.atlas.terrain(terrain, variantOf(x, y, TERRAIN_VARIANTS));
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
        texture: this.atlas.cliff('right'),
      },
      {
        neighbour: { x, y: y + 1 },
        origin: { x: screen.x - HALF_W, y: screen.y },
        span: { x: HALF_W, y: HALF_H },
        texture: this.atlas.cliff('left'),
      },
    ];

    for (const face of faces) {
      const neighbourHeight = grid.contains(face.neighbour.x, face.neighbour.y)
        ? grid.heightAt(face.neighbour.x, face.neighbour.y)
        : 0;
      const drop = (height - neighbourHeight) * ELEVATION_STEP;
      if (drop <= 0) continue;

      const sprite = new Sprite(face.texture);
      const width = sprite.texture.frame.width;
      const heightPixels = sprite.texture.frame.height;
      sprite.setFromMatrix(
        new Matrix(
          face.span.x / width,
          face.span.y / width,
          0,
          drop / heightPixels,
          face.origin.x,
          face.origin.y,
        ),
      );
      sprite.zIndex = depth + 2;
      sprites.push(sprite);
    }
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
  return shade(0xffffff, 0.94 + 0.05 * noise + height * 0.03);
}

function variantOf(x: number, y: number, count: number): number {
  const hash = (x * 73856093) ^ (y * 19349663);
  return Math.abs(hash) % count;
}
