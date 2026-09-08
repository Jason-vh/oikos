import { Container, Sprite } from 'pixi.js';
import { NO_BUILDING } from '../sim/grid';
import { decorKindOf, decorVariantOf } from '../sim/mapgen';
import type { World } from '../sim/world';
import { tileToScreen } from './iso';
import type { TextureCache } from './textures';

export class DecorLayer {
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
    for (let i = 0; i < total; i++) all[i] = i;
    this.sync(all);
  }

  sync(tiles: Iterable<number>): void {
    const { grid } = this.world;

    for (const index of tiles) {
      const byte = grid.decor[index];
      const blocked = grid.occupant[index] !== NO_BUILDING || grid.road[index] === 1;
      const existing = this.sprites.get(index);

      if (byte === 0 || blocked) {
        if (existing) {
          existing.destroy();
          this.sprites.delete(index);
        }
        continue;
      }

      if (existing) continue;

      const x = grid.tileX(index);
      const y = grid.tileY(index);
      const decor = this.textures.decor(decorKindOf(byte), decorVariantOf(byte));

      const sprite = new Sprite(decor.texture);
      sprite.anchor.set(decor.anchorX, decor.anchorY);
      const position = tileToScreen(x, y, grid.height[index]);
      sprite.position.set(position.x, position.y);
      sprite.zIndex = x + y;

      this.structures.addChild(sprite);
      this.sprites.set(index, sprite);
    }
  }
}
