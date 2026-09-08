import { ColorMatrixFilter, Container, Rectangle, Sprite, type Application } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import type { TextureCache } from './textures';

const GRADE = { red: 1.08, green: 0.97, blue: 0.85 };
const SEA_COLOUR = 0x20504f;

export class Atmosphere {
  readonly overlay = new Container();

  private readonly app: Application;
  private readonly textures: TextureCache;
  private readonly colour = new ColorMatrixFilter();
  private readonly bloom = new AdvancedBloomFilter({
    threshold: 0.85,
    bloomScale: 0.35,
    brightness: 1,
    blur: 4,
    quality: 4,
  });
  private readonly vignette = new Sprite();

  private world: Container | null = null;

  constructor(app: Application, textures: TextureCache) {
    this.app = app;
    this.textures = textures;
    this.colour.matrix = [
      GRADE.red, 0, 0, 0, 0,
      0, GRADE.green, 0, 0, 0,
      0, 0, GRADE.blue, 0, 0,
      0, 0, 0, 1, 0,
    ];
    this.app.renderer.background.color = SEA_COLOUR;
    this.vignette.anchor.set(0);
    this.overlay.addChild(this.vignette);
    this.overlay.eventMode = 'none';
    this.resize();
  }

  attach(world: Container): void {
    this.world = world;
    world.filters = [this.colour, this.bloom];
    this.resize();
  }

  resize(): void {
    const { width, height } = this.app.screen;
    this.vignette.texture = this.textures.vignette(Math.ceil(width), Math.ceil(height));
    this.vignette.width = width;
    this.vignette.height = height;
    if (this.world) this.world.filterArea = new Rectangle(0, 0, width, height);
  }
}
