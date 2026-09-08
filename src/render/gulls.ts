import { Container, Sprite } from 'pixi.js';
import { TERRAIN_WATER } from '../sim/grid';
import type { World } from '../sim/world';
import { tileToScreen } from './iso';
import { GULL_FRAMES, TextureCache } from './textures';

const GULL_COUNT = 6;
const GULL_SPEED = 28;
const GULL_ALTITUDE = 90;
const FLAP_MS = 140;
const GLIDE_MS = 1800;

interface Gull {
  sprite: Sprite;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  flapClock: number;
  frame: number;
}

export class Gulls {
  readonly container = new Container();

  private readonly world: World;
  private readonly textures: TextureCache;
  private readonly gulls: Gull[] = [];
  private readonly waterTiles: number[] = [];

  constructor(world: World, textures: TextureCache) {
    this.world = world;
    this.textures = textures;
    this.container.eventMode = 'none';

    const { grid } = world;
    for (let index = 0; index < grid.size * grid.size; index++) {
      if (grid.terrain[index] === TERRAIN_WATER) this.waterTiles.push(index);
    }
    if (this.waterTiles.length < 20) return;

    for (let i = 0; i < GULL_COUNT; i++) {
      const start = this.randomWaterPoint();
      const target = this.randomWaterPoint();
      const sprite = new Sprite(textures.gull(0));
      sprite.anchor.set(0.5);
      sprite.alpha = 0.9;
      this.container.addChild(sprite);
      this.gulls.push({
        sprite,
        x: start.x,
        y: start.y,
        targetX: target.x,
        targetY: target.y,
        flapClock: Math.random() * GLIDE_MS,
        frame: 0,
      });
    }
  }

  update(deltaMs: number): void {
    const seconds = deltaMs / 1000;
    for (const gull of this.gulls) {
      const dx = gull.targetX - gull.x;
      const dy = gull.targetY - gull.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 4) {
        const target = this.randomWaterPoint();
        gull.targetX = target.x;
        gull.targetY = target.y;
        continue;
      }

      gull.x += (dx / distance) * GULL_SPEED * seconds;
      gull.y += (dy / distance) * GULL_SPEED * seconds;
      gull.sprite.scale.x = dx < 0 ? -1 : 1;
      gull.sprite.position.set(gull.x, gull.y - GULL_ALTITUDE);

      gull.flapClock += deltaMs;
      const cycle = GLIDE_MS + FLAP_MS * GULL_FRAMES * 2;
      const phase = gull.flapClock % cycle;
      const flapping = phase < FLAP_MS * GULL_FRAMES * 2;
      const frame = flapping ? Math.floor(phase / FLAP_MS) % GULL_FRAMES : 1;
      if (frame !== gull.frame) {
        gull.frame = frame;
        gull.sprite.texture = this.textures.gull(frame);
      }
    }
  }

  private randomWaterPoint(): { x: number; y: number } {
    const { grid } = this.world;
    const index = this.waterTiles[Math.floor(Math.random() * this.waterTiles.length)];
    const point = tileToScreen(grid.tileX(index), grid.tileY(index), 0);
    return { x: point.x + (Math.random() - 0.5) * 60, y: point.y + (Math.random() - 0.5) * 30 };
  }
}
