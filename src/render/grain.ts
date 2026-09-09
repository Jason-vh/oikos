import { css } from './canvas';

export const GRAIN_CELL = 2;

export interface Ramp {
  colours: number[];
  scale: number;
  jitter: number;
}

export interface Tuft {
  colours: number[];
  density: number;
  height: number;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const top = hash(x0, y0, seed) + (hash(x0 + 1, y0, seed) - hash(x0, y0, seed)) * tx;
  const bottom = hash(x0, y0 + 1, seed) + (hash(x0 + 1, y0 + 1, seed) - hash(x0, y0 + 1, seed)) * tx;
  return top + (bottom - top) * ty;
}

export function fbm(x: number, y: number, seed: number): number {
  return 0.55 * valueNoise(x, y, seed) + 0.3 * valueNoise(x * 2.1, y * 2.1, seed + 1) + 0.15 * valueNoise(x * 4.3, y * 4.3, seed + 2);
}

export function fillGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  ramp: Ramp,
  seed: number,
): void {
  const columns = Math.ceil(width / GRAIN_CELL);
  const rows = Math.ceil(height / GRAIN_CELL);
  const last = ramp.colours.length - 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const noise = fbm(column / ramp.scale, (row * 2) / ramp.scale, seed);
      const jitter = (hash(column, row, seed + 7) - 0.5) * ramp.jitter;
      const index = Math.round(Math.min(1, Math.max(0, noise + jitter)) * last);
      ctx.fillStyle = css(ramp.colours[index]);
      ctx.fillRect(x + column * GRAIN_CELL, y + row * GRAIN_CELL, GRAIN_CELL, GRAIN_CELL);
    }
  }
}

export function scatterTufts(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tuft: Tuft,
  seed: number,
): void {
  const columns = Math.ceil(width / GRAIN_CELL);
  const rows = Math.ceil(height / GRAIN_CELL);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (hash(column, row, seed + 11) > tuft.density) continue;
      const colour = tuft.colours[Math.floor(hash(column, row, seed + 13) * tuft.colours.length)];
      const height = 1 + Math.floor(hash(column, row, seed + 17) * tuft.height);
      ctx.fillStyle = css(colour);
      ctx.fillRect(x + column * GRAIN_CELL, y + (row - height + 1) * GRAIN_CELL, GRAIN_CELL, height * GRAIN_CELL);
    }
  }
}
