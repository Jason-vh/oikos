import type { Container } from 'pixi.js';
import { tileToScreen, type Point } from './iso';

const MIN_SCALE = 0.22;
const MAX_SCALE = 1.8;

export class Camera {
  x = 0;
  y = 0;
  scale = 1;

  applyTo(container: Container): void {
    container.position.set(this.x, this.y);
    container.scale.set(this.scale);
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.x += (after.x - before.x) * this.scale;
    this.y += (after.y - before.y) * this.scale;
  }

  screenToWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.x) / this.scale,
      y: (screenY - this.y) / this.scale,
    };
  }

  centreOnTile(tileX: number, tileY: number, viewWidth: number, viewHeight: number): void {
    const target = tileToScreen(tileX, tileY);
    this.x = viewWidth / 2 - target.x * this.scale;
    this.y = viewHeight / 2 - target.y * this.scale;
  }
}
