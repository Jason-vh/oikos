import { ColorMatrixFilter, Container, Rectangle, Sprite, type Application } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { TICKS_PER_MONTH } from '../sim/world';
import { NIGHT_PHASE, SUN_PHASES } from './canvas';
import type { TextureCache } from './textures';

export const DAY_TICKS = TICKS_PER_MONTH;
const DAYLIGHT_FRACTION = 0.72;
const PHASE_CENTRES = phaseCentres();

export interface Lighting {
  from: number;
  to: number;
  blend: number;
}

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
  private progress = 0;

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

  get lighting(): Lighting {
    for (let phase = 0; phase < PHASE_CENTRES.length; phase++) {
      const start = PHASE_CENTRES[phase];
      const next = (phase + 1) % PHASE_CENTRES.length;
      const end = phase === PHASE_CENTRES.length - 1 ? PHASE_CENTRES[0] + 1 : PHASE_CENTRES[next];
      const position = this.progress < start ? this.progress + 1 : this.progress;
      if (position >= start && position < end) {
        return { from: phase, to: next, blend: (position - start) / (end - start) };
      }
    }
    return { from: NIGHT_PHASE, to: 0, blend: 0 };
  }

  get timeOfDay(): string {
    if (this.daylight <= 0) return 'Night';
    if (this.daylight < 0.2) return 'Dawn';
    if (this.daylight < 0.45) return 'Morning';
    if (this.daylight < 0.55) return 'Midday';
    if (this.daylight < 0.8) return 'Afternoon';
    return 'Dusk';
  }

  update(tick: number): void {
    const progress = (tick % DAY_TICKS) / DAY_TICKS;
    this.progress = progress;
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

function phaseCentres(): number[] {
  const centres: number[] = [];
  for (let phase = 0; phase < SUN_PHASES; phase++) {
    centres.push(((phase + 0.5) / SUN_PHASES) * DAYLIGHT_FRACTION);
  }
  centres.push(DAYLIGHT_FRACTION + (1 - DAYLIGHT_FRACTION) / 2);
  return centres;
}

function ambientFor(progress: number): Ambient {
  if (progress < DAYLIGHT_FRACTION) return daylightAmbient(progress / DAYLIGHT_FRACTION);

  const night = (progress - DAYLIGHT_FRACTION) / (1 - DAYLIGHT_FRACTION);
  const depth = smoothstep(Math.sin(night * Math.PI));
  const horizon = daylightAmbient(0);

  return {
    red: horizon.red + (0.62 - horizon.red) * depth,
    green: horizon.green + (0.66 - horizon.green) * depth,
    blue: horizon.blue + (0.92 - horizon.blue) * depth,
    brightness: horizon.brightness + (0.58 - horizon.brightness) * depth,
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function daylightAmbient(day: number): Ambient {
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
