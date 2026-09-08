import { ColorMatrixFilter, Container, Rectangle, Sprite, type Application } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { NIGHT_PHASE, SUN_PHASES } from './canvas';
import type { TextureCache } from './textures';

export const DAY_TICKS = 320;
const DAYLIGHT_FRACTION = 0.72;

interface Ambient {
  red: number;
  green: number;
  blue: number;
  brightness: number;
}

export class Atmosphere {
  readonly overlay = new Container();

  private readonly app: Application;
  private readonly textures: TextureCache;
  private readonly colour = new ColorMatrixFilter();
  private readonly bloom = new AdvancedBloomFilter({
    threshold: 0.85,
    bloomScale: 0.3,
    brightness: 1,
    blur: 4,
    quality: 4,
  });
  private readonly vignette = new Sprite();

  private world: Container | null = null;
  private daylight = 1;

  constructor(app: Application, textures: TextureCache) {
    this.app = app;
    this.textures = textures;
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

  get sunPhase(): number {
    if (this.daylight < 0) return NIGHT_PHASE;
    const phase = Math.floor(this.daylight * SUN_PHASES);
    return Math.min(SUN_PHASES - 1, Math.max(0, phase));
  }

  get timeOfDay(): string {
    if (this.daylight <= 0) return 'Night';
    if (this.daylight < 0.2) return 'Dawn';
    if (this.daylight < 0.45) return 'Morning';
    if (this.daylight < 0.7) return 'Afternoon';
    return 'Dusk';
  }

  update(tick: number): void {
    const progress = (tick % DAY_TICKS) / DAY_TICKS;
    this.daylight = progress < DAYLIGHT_FRACTION ? progress / DAYLIGHT_FRACTION : -1;

    const ambient = ambientFor(progress);
    this.colour.matrix = [
      ambient.red * ambient.brightness, 0, 0, 0, 0,
      0, ambient.green * ambient.brightness, 0, 0, 0,
      0, 0, ambient.blue * ambient.brightness, 0, 0,
      0, 0, 0, 1, 0,
    ];
    this.bloom.bloomScale = this.daylight < 0 ? 0.45 : 0.2 + 0.25 * this.daylight;
    this.app.renderer.background.color = seaColour(ambient);
  }

  resize(): void {
    const { width, height } = this.app.screen;
    this.vignette.texture = this.textures.vignette(Math.ceil(width), Math.ceil(height));
    this.vignette.width = width;
    this.vignette.height = height;
    if (this.world) this.world.filterArea = new Rectangle(0, 0, width, height);
  }
}

function ambientFor(progress: number): Ambient {
  if (progress >= DAYLIGHT_FRACTION) {
    const nightProgress = (progress - DAYLIGHT_FRACTION) / (1 - DAYLIGHT_FRACTION);
    const depth = Math.sin(nightProgress * Math.PI);
    const dusk = Math.max(0, 1 - nightProgress * 3);
    return {
      red: 0.62 - 0.1 * depth + 0.26 * dusk,
      green: 0.64 - 0.1 * depth + 0.1 * dusk,
      blue: 0.92 - 0.02 * depth - 0.06 * dusk,
      brightness: 0.68 - 0.08 * depth + 0.12 * dusk,
    };
  }

  const day = progress / DAYLIGHT_FRACTION;
  const altitude = Math.sin(day * Math.PI);
  const warmth = 1 - altitude;

  return {
    red: 0.9 + 0.18 * altitude + 0.14 * warmth,
    green: 0.82 + 0.22 * altitude - 0.06 * warmth,
    blue: 0.68 + 0.24 * altitude - 0.02 * warmth,
    brightness: 0.84 + 0.24 * altitude,
  };
}

function seaColour(ambient: Ambient): number {
  const channel = (base: number, tint: number) => Math.round(Math.min(255, base * tint * ambient.brightness));
  const red = channel(0x1e, ambient.red);
  const green = channel(0x52, ambient.green);
  const blue = channel(0x5c, ambient.blue);
  return (red << 16) | (green << 8) | blue;
}
