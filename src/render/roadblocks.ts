import { Container, Sprite } from 'pixi.js';
import type { World } from '../sim/world';
import { tileToScreen } from './iso';
import type { TextureCache } from './textures';

export class RoadblockLayer {
  private readonly world: World;
  private readonly textures: TextureCache;
  private readonly structures: Container;
  private readonly sprites = new Map<number, Sprite>();

  constructor(world: World, textures: TextureCache, structures: Container) {
    this.world = world;
    this.textures = textures;
    this.structures = structures;

    const total = world.grid.size * world.grid.size;
    const all = new Array<number>(total);
    for (let index = 0; index < total; index++) all[index] = index;
    this.sync(all);
  }

  sync(tiles: Iterable<number>): void {
    const { grid } = this.world;

    for (const index of tiles) {
      const existing = this.sprites.get(index);

      if (!grid.isRoadblock(index)) {
        if (!existing) continue;
        existing.destroy();
        this.sprites.delete(index);
        continue;
      }
      if (existing) continue;

      const x = grid.tileX(index);
      const y = grid.tileY(index);
      const barrier = this.textures.roadblock();
      const sprite = new Sprite(barrier.texture);
      const position = tileToScreen(x, y, grid.height[index]);

      sprite.anchor.set(barrier.anchorX, barrier.anchorY);
      sprite.position.set(position.x, position.y);
      sprite.zIndex = x + y + 0.5;

      this.structures.addChild(sprite);
      this.sprites.set(index, sprite);
    }
  }
}
