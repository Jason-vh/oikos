import { CanvasSource, Texture } from 'pixi.js';

export const TEXTURE_SCALE = 2;

export interface Sun {
  azimuth: number;
  elevation: number;
}

export interface DrawSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export function createSurface(width: number, height: number): DrawSurface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * TEXTURE_SCALE);
  canvas.height = Math.ceil(height * TEXTURE_SCALE);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  return { canvas, ctx, width, height };
}

const INK = [52, 38, 28] as const;
const INK_STRENGTH = 0.55;
const GRAIN = 2;

export function ink(surface: DrawSurface): void {
  const { canvas } = surface;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = image;
  const cells = Math.ceil(width / GRAIN) * Math.ceil(height / GRAIN);
  const solid = new Uint8Array(cells);
  const columns = Math.ceil(width / GRAIN);

  for (let cy = 0; cy < height; cy += GRAIN) {
    for (let cx = 0; cx < width; cx += GRAIN) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = cy; y < Math.min(cy + GRAIN, height); y++) {
        for (let x = cx; x < Math.min(cx + GRAIN, width); x++) {
          const i = (y * width + x) * 4;
          r += data[i] * data[i + 3];
          g += data[i + 1] * data[i + 3];
          b += data[i + 2] * data[i + 3];
          a += data[i + 3];
          n++;
        }
      }
      const cell = (cy / GRAIN) * columns + cx / GRAIN;
      const alpha = a / n;
      solid[cell] = alpha > 96 ? 1 : 0;
      const [pr, pg, pb] = a > 0 ? [r / a, g / a, b / a] : [0, 0, 0];
      for (let y = cy; y < Math.min(cy + GRAIN, height); y++) {
        for (let x = cx; x < Math.min(cx + GRAIN, width); x++) {
          const i = (y * width + x) * 4;
          data[i] = pr;
          data[i + 1] = pg;
          data[i + 2] = pb;
          data[i + 3] = alpha > 96 ? 255 : 0;
        }
      }
    }
  }

  const rows = Math.ceil(height / GRAIN);
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= columns || r >= rows ? 0 : solid[r * columns + c]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const here = at(c, r);
      const neighbours = at(c - 1, r) + at(c + 1, r) + at(c, r - 1) + at(c, r + 1);
      const rim = !here && neighbours > 0;
      const edge = here && neighbours < 4;
      if (!rim && !edge) continue;
      for (let y = r * GRAIN; y < Math.min((r + 1) * GRAIN, height); y++) {
        for (let x = c * GRAIN; x < Math.min((c + 1) * GRAIN, width); x++) {
          const i = (y * width + x) * 4;
          const mix = rim ? 1 : INK_STRENGTH;
          data[i] = data[i] * (1 - mix) + INK[0] * mix;
          data[i + 1] = data[i + 1] * (1 - mix) + INK[1] * mix;
          data[i + 2] = data[i + 2] * (1 - mix) + INK[2] * mix;
          data[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function toTexture(surface: DrawSurface): Texture {
  const source = new CanvasSource({
    resource: surface.canvas,
    resolution: TEXTURE_SCALE,
    antialias: true,
  });
  return new Texture({ source });
}

export function shade(colour: number, factor: number): number {
  const r = clampByte(((colour >> 16) & 0xff) * factor);
  const g = clampByte(((colour >> 8) & 0xff) * factor);
  const b = clampByte((colour & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

export function mixColour(from: number, to: number, amount: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return clampByte(a + (b - a) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function css(colour: number, alpha = 1): string {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function diamondPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfHeight);
  ctx.lineTo(cx + halfWidth, cy);
  ctx.lineTo(cx, cy + halfHeight);
  ctx.lineTo(cx - halfWidth, cy);
  ctx.closePath();
}

export function polygonPath(ctx: CanvasRenderingContext2D, points: number[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
}

export function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  bounds: { x: number; y: number; width: number; height: number },
  count: number,
  colours: number[],
  maxRadius: number,
  alpha: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = bounds.x + random() * bounds.width;
    const y = bounds.y + random() * bounds.height;
    const radius = 0.4 + random() * maxRadius;
    ctx.fillStyle = css(colours[Math.floor(random() * colours.length)], alpha * (0.4 + random() * 0.6));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function faceLight(sun: Sun, faceAzimuth: number): number {
  const lambert = Math.max(0, Math.cos(sun.azimuth - faceAzimuth)) * Math.cos(sun.elevation);
  return 0.72 + 0.34 * lambert;
}

export function topLight(sun: Sun): number {
  return 0.82 + 0.28 * Math.sin(sun.elevation);
}

export function shadowVector(sun: Sun): { x: number; y: number; alpha: number } {
  const length = 10 + 26 * (1 - Math.sin(sun.elevation));
  return {
    x: -Math.cos(sun.azimuth) * length,
    y: -Math.sin(Math.PI / 2 - sun.elevation) * 6 + length * 0.28,
    alpha: 0.1 + 0.1 * Math.sin(sun.elevation),
  };
}

export const SUN: Sun = { azimuth: Math.PI * 0.69, elevation: 0.87 };

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
