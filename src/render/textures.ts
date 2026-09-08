import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';

export interface StructureLook {
  size: number;
  height: number;
  colour: number;
  roofColour: number;
}

export function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

export class TextureCache {
  private readonly renderer: Renderer;
  private readonly cache = new Map<string, Texture>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  tile(colour: number): Texture {
    return this.get(`tile:${colour}`, () => {
      const half = { w: TILE_WIDTH / 2, h: TILE_HEIGHT / 2 };
      return new Graphics()
        .poly([0, -half.h, half.w, 0, 0, half.h, -half.w, 0])
        .fill(colour)
        .stroke({ width: 1, color: shade(colour, 0.86), alignment: 0.5 });
    });
  }

  road(): Texture {
    return this.get('road', () => {
      const half = { w: TILE_WIDTH / 2, h: TILE_HEIGHT / 2 };
      const graphics = new Graphics()
        .poly([0, -half.h, half.w, 0, 0, half.h, -half.w, 0])
        .fill(0x9d8f74);
      graphics
        .poly([0, -half.h * 0.55, half.w * 0.55, 0, 0, half.h * 0.55, -half.w * 0.55, 0])
        .fill(0xb6a888);
      return graphics;
    });
  }

  structure(key: string, look: StructureLook): Texture {
    return this.get(`structure:${key}`, () => {
      const halfWidth = (look.size * TILE_WIDTH) / 2;
      const halfHeight = (look.size * TILE_HEIGHT) / 2;
      const height = look.height;
      const graphics = new Graphics();

      graphics
        .poly([0, -halfHeight, halfWidth, 0, 0, halfHeight, -halfWidth, 0])
        .fill(shade(look.colour, 0.6));
      graphics
        .poly([-halfWidth, 0, 0, halfHeight, 0, halfHeight - height, -halfWidth, -height])
        .fill(shade(look.colour, 0.75));
      graphics
        .poly([halfWidth, 0, 0, halfHeight, 0, halfHeight - height, halfWidth, -height])
        .fill(look.colour);
      graphics
        .poly([0, -halfHeight - height, halfWidth, -height, 0, halfHeight - height, -halfWidth, -height])
        .fill(look.roofColour)
        .stroke({ width: 1, color: shade(look.roofColour, 0.75) });

      return graphics;
    });
  }

  walker(colour: number): Texture {
    return this.get(`walker:${colour}`, () =>
      new Graphics()
        .circle(0, 0, 5)
        .fill(colour)
        .stroke({ width: 1.5, color: shade(colour, 0.55) }),
    );
  }

  selection(colour: number): Texture {
    return this.get(`selection:${colour}`, () => {
      const half = { w: TILE_WIDTH / 2, h: TILE_HEIGHT / 2 };
      return new Graphics()
        .poly([0, -half.h, half.w, 0, 0, half.h, -half.w, 0])
        .fill({ color: colour, alpha: 0.35 })
        .stroke({ width: 2, color: colour });
    });
  }

  private get(key: string, draw: () => Graphics): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const graphics = draw();
    const texture = this.renderer.generateTexture({ target: graphics, resolution: 2, antialias: true });
    graphics.destroy();
    this.cache.set(key, texture);
    return texture;
  }
}
