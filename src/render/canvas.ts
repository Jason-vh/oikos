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
  return 0.52 + 0.62 * lambert;
}

export function topLight(sun: Sun): number {
  return 0.62 + 0.55 * Math.sin(sun.elevation);
}

export function shadowVector(sun: Sun): { x: number; y: number; alpha: number } {
  const length = 10 + 26 * (1 - Math.sin(sun.elevation));
  return {
    x: -Math.cos(sun.azimuth) * length,
    y: -Math.sin(Math.PI / 2 - sun.elevation) * 6 + length * 0.28,
    alpha: 0.16 + 0.18 * Math.sin(sun.elevation),
  };
}

export const SUN_PHASES = 6;
export const NIGHT_PHASE = SUN_PHASES;

export function sunForPhase(phase: number): Sun {
  if (phase >= NIGHT_PHASE) return { azimuth: Math.PI / 2, elevation: 0.5 };

  const progress = (phase + 0.5) / SUN_PHASES;
  return {
    azimuth: Math.PI * (1 - progress),
    elevation: 0.18 + Math.sin(progress * Math.PI) * 1.0,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
