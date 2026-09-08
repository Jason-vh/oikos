import { Container, Sprite } from 'pixi.js';
import type { TextureCache } from './textures';

interface Particle {
  sprite: Sprite;
  velocityX: number;
  velocityY: number;
  gravity: number;
  life: number;
  maxLife: number;
  peakAlpha: number;
  growth: number;
  fade: number;
}

const MAX_PARTICLES = 320;

export class Particles {
  readonly container = new Container();

  private readonly textures: TextureCache;
  private readonly active: Particle[] = [];
  private readonly pool: Sprite[] = [];

  constructor(textures: TextureCache) {
    this.textures = textures;
    this.container.eventMode = 'none';
  }

  smoke(x: number, y: number, tint = 0xd6d1c8): void {
    this.spawn({
      x,
      y,
      tint,
      scale: 0.14 + Math.random() * 0.05,
      alpha: 0.7,
      velocityX: -4 - Math.random() * 5,
      velocityY: -16 - Math.random() * 8,
      life: 2600 + Math.random() * 1000,
      growth: 0.2,
      fade: 1.2,
    });
  }

  spray(x: number, y: number): void {
    this.spawn({
      x,
      y,
      tint: 0xd8f6ff,
      scale: 0.12 + Math.random() * 0.05,
      alpha: 0.95,
      velocityX: (Math.random() - 0.5) * 56,
      velocityY: -36 - Math.random() * 12,
      gravity: 200,
      life: 850 + Math.random() * 150,
      growth: 0,
      fade: 0.5,
    });
  }

  dust(x: number, y: number): void {
    this.spawn({
      x,
      y,
      tint: 0xbfae8c,
      scale: 0.16 + Math.random() * 0.1,
      alpha: 0.3,
      velocityX: (Math.random() - 0.5) * 14,
      velocityY: -6 - Math.random() * 6,
      life: 700 + Math.random() * 400,
      growth: 0.5,
      fade: 1.3,
    });
  }

  update(deltaMs: number): void {
    const seconds = deltaMs / 1000;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const particle = this.active[i];
      particle.life -= deltaMs;

      if (particle.life <= 0) {
        this.recycle(i);
        continue;
      }

      const progress = 1 - particle.life / particle.maxLife;
      particle.velocityY += particle.gravity * seconds;
      particle.sprite.x += particle.velocityX * seconds;
      particle.sprite.y += particle.velocityY * seconds;
      particle.sprite.scale.set(particle.sprite.scale.x + particle.growth * seconds);
      particle.sprite.alpha = particle.peakAlpha * Math.max(0, (1 - progress) ** particle.fade);
    }
  }

  private spawn(options: {
    x: number;
    y: number;
    tint: number;
    scale: number;
    alpha: number;
    velocityX: number;
    velocityY: number;
    gravity?: number;
    life: number;
    growth: number;
    fade: number;
  }): void {
    if (this.active.length >= MAX_PARTICLES) return;

    const sprite = this.pool.pop() ?? new Sprite(this.textures.puff());
    sprite.anchor.set(0.5);
    sprite.position.set(options.x, options.y);
    sprite.scale.set(options.scale);
    sprite.alpha = options.alpha;
    sprite.tint = options.tint;
    sprite.visible = true;
    this.container.addChild(sprite);

    this.active.push({
      sprite,
      velocityX: options.velocityX,
      velocityY: options.velocityY,
      gravity: options.gravity ?? 0,
      life: options.life,
      maxLife: options.life,
      peakAlpha: options.alpha,
      growth: options.growth,
      fade: options.fade,
    });
  }

  private recycle(index: number): void {
    const particle = this.active[index];
    particle.sprite.visible = false;
    this.container.removeChild(particle.sprite);
    this.pool.push(particle.sprite);
    this.active.splice(index, 1);
  }
}
