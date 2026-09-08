import type { Texture } from 'pixi.js';
import { createRandom } from '../sim/mapgen';
import type { BuildingKind, WalkerKind } from '../sim/types';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';
import {
  createSurface,
  css,
  diamondPath,
  faceLight,
  mixColour,
  polygonPath,
  shade,
  shadowVector,
  speckle,
  sunForPhase,
  NIGHT_PHASE,
  toTexture,
  topLight,
  type DrawSurface,
  type Sun,
} from './canvas';

export interface StructureSprite {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}

export interface StructureLook {
  size: number;
  height: number;
  colour: number;
  roofColour: number;
}

export interface StructureRequest extends StructureLook {
  kind: BuildingKind;
  variant: number;
  phase: number;
}

const WALKER_PALETTES: Record<WalkerKind, { tunic: number; trim: number }> = {
  cartPusher: { tunic: 0xe3d3a8, trim: 0x9c6b35 },
  foodVendor: { tunic: 0xe08a45, trim: 0x7c3f1d },
  waterCarrier: { tunic: 0x6fb6de, trim: 0x2f6a8c },
};

export const WALKER_FRAMES = 4;

const FOOTPRINT_INSET: Record<BuildingKind, number> = {
  house: 0.82,
  granary: 0.9,
  wheatFarm: 1,
  fountain: 1,
  statue: 1,
};

export class TextureCache {
  private readonly textures = new Map<string, Texture>();
  private readonly structures = new Map<string, StructureSprite>();

  walker(kind: WalkerKind, direction: number, frame: number): Texture {
    return this.cache(`walker:${kind}:${direction}:${frame}`, () => {
      const surface = createSurface(34, 50);
      drawWalker(surface, kind, direction, frame);
      return surface;
    });
  }

  puff(): Texture {
    return this.cache('puff', () => {
      const size = 48;
      const surface = createSurface(size, size);
      const gradient = surface.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      surface.ctx.fillStyle = gradient;
      surface.ctx.fillRect(0, 0, size, size);
      return surface;
    });
  }

  vignette(width: number, height: number): Texture {
    return this.cache(`vignette:${width}x${height}`, () => {
      const surface = createSurface(width, height);
      const { ctx } = surface;
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.28,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.6, 'rgba(0,0,0,0.1)');
      gradient.addColorStop(1, 'rgba(10,7,16,0.5)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      return surface;
    });
  }

  structure(request: StructureRequest): StructureSprite {
    const key = [
      request.kind,
      request.size,
      request.height,
      request.colour,
      request.roofColour,
      request.variant,
      request.phase,
    ].join(':');

    const existing = this.structures.get(key);
    if (existing) return existing;

    const sprite = buildStructure(request);
    this.structures.set(key, sprite);
    return sprite;
  }

  private cache(key: string, draw: () => DrawSurface): Texture {
    const existing = this.textures.get(key);
    if (existing) return existing;

    const texture = toTexture(draw());
    this.textures.set(key, texture);
    return texture;
  }
}

function buildStructure(request: StructureRequest): StructureSprite {
  const sun = sunForPhase(request.phase);
  const halfWidth = (request.size * TILE_WIDTH) / 2;
  const halfHeight = (request.size * TILE_HEIGHT) / 2;
  const marginX = 40;
  const marginTop = 20;
  const marginBottom = 34;

  const width = halfWidth * 2 + marginX * 2;
  const centreY = marginTop + request.height + halfHeight;
  const height = centreY + halfHeight + marginBottom;
  const surface = createSurface(width, height);
  const cx = width / 2;

  const inset = FOOTPRINT_INSET[request.kind];
  const bodyWidth = halfWidth * inset;
  const bodyHeight = halfHeight * inset;
  const varied: StructureRequest = {
    ...request,
    roofColour: shade(request.roofColour, 0.9 + (request.variant % 4) * 0.06),
    colour: shade(request.colour, 0.95 + (request.variant % 3) * 0.04),
  };

  drawShadow(surface, cx, centreY, bodyWidth, bodyHeight, request.height, sun);
  drawStructureBody(surface, cx, centreY, bodyWidth, bodyHeight, varied, sun);

  return { texture: toTexture(surface), anchorX: 0.5, anchorY: (centreY + halfHeight) / height };
}

function drawShadow(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  bodyHeight: number,
  sun: Sun,
): void {
  const { ctx } = surface;
  const offset = shadowVector(sun);
  const stretch = 1 + bodyHeight / 110;

  ctx.save();
  ctx.filter = 'blur(7px)';
  ctx.fillStyle = `rgba(26, 21, 14, ${offset.alpha})`;
  diamondPath(ctx, cx + offset.x * 0.5, cy + offset.y * 0.35, halfWidth * stretch, halfHeight * stretch);
  ctx.fill();
  ctx.restore();
}

function drawStructureBody(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  if (request.kind === 'wheatFarm') {
    drawFarm(surface, cx, cy, halfWidth, halfHeight, request, sun);
    return;
  }
  if (request.kind === 'fountain') {
    drawFountain(surface, cx, cy, halfWidth, halfHeight, sun);
    return;
  }
  if (request.kind === 'statue') {
    drawStatue(surface, cx, cy, halfWidth, halfHeight, request, sun);
    return;
  }

  drawPrism(surface, cx, cy, halfWidth, halfHeight, request, sun);
  if (request.kind === 'granary') drawGranaryDome(surface, cx, cy, halfWidth, halfHeight, request, sun);
  if (request.kind === 'house') drawHouseDetails(surface, cx, cy, halfWidth, halfHeight, request, sun);
}

function drawPrism(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const { ctx } = surface;
  const height = request.height;
  const leftLight = faceLight(sun, Math.PI);
  const rightLight = faceLight(sun, 0);

  polygonPath(ctx, [
    cx - halfWidth, cy,
    cx, cy + halfHeight,
    cx, cy + halfHeight - height,
    cx - halfWidth, cy - height,
  ]);
  ctx.fillStyle = css(shade(request.colour, leftLight));
  ctx.fill();
  drawWallDetail(ctx, cx - halfWidth, cy - height, halfWidth, halfHeight, height, leftLight, request, 1);

  polygonPath(ctx, [
    cx + halfWidth, cy,
    cx, cy + halfHeight,
    cx, cy + halfHeight - height,
    cx + halfWidth, cy - height,
  ]);
  ctx.fillStyle = css(shade(request.colour, rightLight));
  ctx.fill();
  drawWallDetail(ctx, cx + halfWidth, cy - height, -halfWidth, halfHeight, height, rightLight, request, -1);

  drawRoof(ctx, cx, cy - height, halfWidth, halfHeight, request, sun);
}

function drawWallDetail(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  spanX: number,
  spanY: number,
  height: number,
  light: number,
  request: StructureRequest,
  facing: number,
): void {
  ctx.save();
  ctx.transform(spanX, spanY, 0, height, originX, originY);
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  ctx.clip();

  const random = createRandom(request.variant * 7717 + request.size * 31 + (facing > 0 ? 3 : 11));

  ctx.lineWidth = 0.008;
  for (let i = 0; i < 12; i++) {
    const v = random();
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + random() * 0.05})`;
    ctx.beginPath();
    ctx.moveTo(0, v);
    ctx.lineTo(1, v);
    ctx.stroke();
  }

  if (request.kind === 'house' || request.kind === 'granary') {
    const lit = request.phase >= NIGHT_PHASE;
    const windows = request.size === 1 ? 2 : 3;
    for (let i = 0; i < windows; i++) {
      const u = (i + 1) / (windows + 1) - 0.07;
      ctx.fillStyle = lit ? 'rgb(255, 216, 138)' : `rgba(38, 26, 18, ${0.5 + light * 0.16})`;
      ctx.fillRect(u, 0.3, 0.13, 0.32);
      ctx.fillStyle = lit ? 'rgba(255, 240, 200, 0.9)' : 'rgba(255, 228, 168, 0.14)';
      ctx.fillRect(u + 0.02, 0.33, 0.09, 0.11);
    }
  }

  const shading = ctx.createLinearGradient(0, 0, 0, 1);
  shading.addColorStop(0, 'rgba(255,255,255,0.09)');
  shading.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = shading;
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();

  if (request.phase >= NIGHT_PHASE && request.kind === 'house') {
    drawWindowGlow(ctx, originX, originY, spanX, spanY, height);
  }
}

function drawWindowGlow(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  spanX: number,
  spanY: number,
  height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(5px)';
  ctx.transform(spanX, spanY, 0, height, originX, originY);
  ctx.fillStyle = 'rgba(255, 196, 96, 0.55)';
  ctx.fillRect(0.15, 0.2, 0.7, 0.5);
  ctx.restore();
}

function drawRoof(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const light = topLight(sun);
  const roof = shade(request.roofColour, light);

  ctx.save();
  diamondPath(ctx, cx, cy, halfWidth, halfHeight);
  ctx.clip();
  ctx.fillStyle = css(roof);
  ctx.fillRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2);

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  const rows = Math.round(halfHeight / 5);
  for (let i = -rows * 2; i <= rows * 2; i++) {
    const offset = i * 5;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth + offset * 2, cy + offset);
    ctx.lineTo(cx + halfWidth + offset * 2, cy + offset);
    ctx.stroke();
  }

  const sheen = ctx.createLinearGradient(cx - halfWidth, cy, cx + halfWidth, cy);
  sheen.addColorStop(0, 'rgba(0,0,0,0.14)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2);
  ctx.restore();

  diamondPath(ctx, cx, cy, halfWidth, halfHeight);
  ctx.strokeStyle = css(shade(request.roofColour, light * 0.66), 0.85);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawHouseDetails(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const { ctx } = surface;

  ctx.save();
  ctx.transform(-halfWidth, halfHeight, 0, request.height, cx + halfWidth, cy - request.height);
  ctx.fillStyle = 'rgba(58, 38, 22, 0.85)';
  ctx.fillRect(0.6, 0.4, 0.2, 0.6);
  ctx.fillStyle = 'rgba(220, 200, 160, 0.25)';
  ctx.fillRect(0.6, 0.4, 0.2, 0.04);
  ctx.restore();

  if (request.variant % 2 === 1) {
    ctx.fillStyle = css(shade(0x8f8878, topLight(sun)), 0.95);
    ctx.fillRect(cx - 5, cy - request.height - halfHeight * 0.25 - 13, 8, 15);
  }
}

function drawGranaryDome(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const { ctx } = surface;
  const top = cy - request.height;
  const light = topLight(sun);

  ctx.fillStyle = css(shade(0xd9cfb4, light));
  ctx.beginPath();
  ctx.ellipse(cx, top - 3, halfWidth * 0.42, halfHeight * 0.46, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = css(shade(0x9c9179, light), 0.9);
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawFarm(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const { ctx } = surface;
  const light = topLight(sun);
  const random = createRandom(request.variant * 613 + 7);

  ctx.save();
  diamondPath(ctx, cx, cy, halfWidth, halfHeight);
  ctx.clip();
  ctx.fillStyle = css(shade(0x8a6a44, light));
  ctx.fillRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2);

  for (let row = -10; row <= 10; row++) {
    const offset = row * 9;
    ctx.strokeStyle = css(shade(0xd9c264, light), 0.9);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth + offset, cy + offset * (halfHeight / halfWidth) + 5);
    ctx.lineTo(cx + offset, cy - halfHeight + offset * (halfHeight / halfWidth) + 5);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(70, 50, 26, 0.3)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  speckle(
    ctx,
    random,
    { x: cx - halfWidth, y: cy - halfHeight, width: halfWidth * 2, height: halfHeight * 2 },
    110,
    [0xe8d47a, 0xc2a94e],
    1.8,
    0.5,
  );
  ctx.restore();

  const hut: StructureRequest = {
    ...request,
    kind: 'house',
    size: 1,
    colour: 0xbfa87e,
    roofColour: 0x8b5a34,
  };
  drawPrism(surface, cx - halfWidth / 2, cy - halfHeight / 2, halfWidth / 2, halfHeight / 2, hut, sun);
}

function drawFountain(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  sun: Sun,
): void {
  const { ctx } = surface;
  const light = topLight(sun);

  diamondPath(ctx, cx, cy, halfWidth * 0.94, halfHeight * 0.94);
  ctx.fillStyle = css(shade(0xcfc7b4, light));
  ctx.fill();
  ctx.strokeStyle = css(shade(0x9a9182, light), 0.9);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy - 2, halfWidth * 0.56, halfHeight * 0.56, 0, 0, Math.PI * 2);
  ctx.fillStyle = css(shade(0x3f8fbe, light));
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx - 6, cy - 6, halfWidth * 0.2, halfHeight * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(232, 247, 255, 0.45)';
  ctx.fill();

  ctx.fillStyle = css(shade(0xe4dcc8, light));
  ctx.fillRect(cx - 3, cy - 26, 6, 24);
  ctx.beginPath();
  ctx.arc(cx, cy - 28, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStatue(
  surface: DrawSurface,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  request: StructureRequest,
  sun: Sun,
): void {
  const { ctx } = surface;
  const pedestal: StructureRequest = {
    ...request,
    kind: 'statue',
    height: 16,
    colour: 0xd3cab4,
    roofColour: 0xe8e2d2,
  };
  drawPrism(surface, cx, cy, halfWidth * 0.68, halfHeight * 0.68, pedestal, sun);

  const light = topLight(sun);
  const marble = shade(0xf1ecdd, light);
  const top = cy - 16;

  ctx.fillStyle = css(marble);
  ctx.beginPath();
  ctx.ellipse(cx, top - 18, 8, 19, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, top - 41, 6.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 4.5;
  ctx.strokeStyle = css(marble);
  ctx.beginPath();
  ctx.moveTo(cx + 2, top - 28);
  ctx.lineTo(cx + 15, top - 38);
  ctx.stroke();

  ctx.strokeStyle = css(shade(marble, 0.7), 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 5, top - 10);
  ctx.lineTo(cx - 2, top - 30);
  ctx.stroke();
}

function drawWalker(surface: DrawSurface, kind: WalkerKind, direction: number, frame: number): void {
  const { ctx, height } = surface;
  const palette = WALKER_PALETTES[kind];
  const cx = surface.width / 2;
  const feet = height - 8;
  const facingAway = direction === 2 || direction === 3;
  const swing = Math.sin((frame / WALKER_FRAMES) * Math.PI * 2);
  const bob = Math.abs(Math.cos((frame / WALKER_FRAMES) * Math.PI * 2)) * 1.5;

  ctx.filter = 'blur(2px)';
  ctx.fillStyle = 'rgba(20,16,10,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx, feet + 3, 9, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';

  ctx.translate(0, -bob);

  ctx.strokeStyle = css(0x51402c);
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(cx, feet - 11);
  ctx.lineTo(cx - 4 * swing, feet);
  ctx.moveTo(cx, feet - 11);
  ctx.lineTo(cx + 4 * swing, feet);
  ctx.stroke();

  const body = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
  body.addColorStop(0, css(shade(palette.tunic, 0.76)));
  body.addColorStop(0.55, css(palette.tunic));
  body.addColorStop(1, css(shade(palette.tunic, 0.9)));
  ctx.fillStyle = body;
  polygonPath(ctx, [cx - 7, feet - 9, cx - 5, feet - 27, cx + 5, feet - 27, cx + 7, feet - 9]);
  ctx.fill();

  ctx.fillStyle = css(palette.trim);
  ctx.fillRect(cx - 7, feet - 14, 14, 3.2);

  ctx.fillStyle = css(0xd9ac82);
  ctx.beginPath();
  ctx.arc(cx, feet - 32, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = css(0x3a2a1c);
  ctx.beginPath();
  ctx.arc(cx, feet - 34, 6, Math.PI, Math.PI * 2);
  ctx.fill();

  if (!facingAway) {
    ctx.fillStyle = 'rgba(30,22,14,0.8)';
    ctx.fillRect(cx - 3.2, feet - 33, 1.8, 1.8);
    ctx.fillRect(cx + 1.4, feet - 33, 1.8, 1.8);
  }

  if (kind === 'cartPusher') drawCart(ctx, cx, feet, direction);
  if (kind === 'waterCarrier') {
    ctx.fillStyle = css(0x6c757d);
    ctx.beginPath();
    ctx.ellipse(cx + 9, feet - 18, 4.2, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCart(ctx: CanvasRenderingContext2D, cx: number, feet: number, direction: number): void {
  const side = direction === 1 || direction === 2 ? -1 : 1;
  const x = cx + 10 * side;

  ctx.fillStyle = css(0x8a5f33);
  ctx.fillRect(x - 6.5, feet - 18, 13, 9);
  ctx.fillStyle = css(mixColour(0xd9c264, 0x8a5f33, 0.2));
  ctx.fillRect(x - 5.5, feet - 20, 11, 3);
  ctx.fillStyle = css(0x3f2d1b);
  ctx.beginPath();
  ctx.arc(x, feet - 7, 3.6, 0, Math.PI * 2);
  ctx.fill();
}
