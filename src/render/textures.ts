import type { Texture } from 'pixi.js';
import { createRandom, type DecorKind } from '../sim/mapgen';
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
  SUN,
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

export type DecorSprite = StructureSprite;

export interface StructureLook {
  size: number;
  height: number;
  colour: number;
  roofColour: number;
}

export interface StructureRequest extends StructureLook {
  kind: BuildingKind;
  variant: number;
}

const WALKER_PALETTES: Record<WalkerKind, { tunic: number; trim: number }> = {
  cartPusher: { tunic: 0xe3d3a8, trim: 0x9c6b35 },
  peddler: { tunic: 0xe08a45, trim: 0x7c3f1d },
  waterCarrier: { tunic: 0x6fb6de, trim: 0x2f6a8c },
  clerk: { tunic: 0xd8d2c2, trim: 0x4f6f7a },
  deliveryman: { tunic: 0xc7b48b, trim: 0x6d5230 },
  philosopher: { tunic: 0xf0ece0, trim: 0x8a7a52 },
  athlete: { tunic: 0xe8d9a8, trim: 0xb8763a },
  soldier: { tunic: 0xc94b32, trim: 0xd8c06a },
  artisan: { tunic: 0xd8c8a4, trim: 0x6b4a30 },
  invader: { tunic: 0x3f4a63, trim: 0x8a2f2f },
  actor: { tunic: 0xd9c2e0, trim: 0x6b4a7a },
  doctor: { tunic: 0xf2efe4, trim: 0x9c5a4a },
  watchman: { tunic: 0x8d6b3f, trim: 0x4a3a24 },
  superintendent: { tunic: 0xb9c7a6, trim: 0x4d5c3a },
};

const CITIZEN_LOOKS = [
  { skin: 0xd9ac82, hair: 0x3a2a1c, tunicShade: 1 },
  { skin: 0xc48f63, hair: 0x1f1610, tunicShade: 0.9 },
  { skin: 0xe8c39c, hair: 0x7a4a26, tunicShade: 1.08 },
];
export const WALKER_LOOKS = CITIZEN_LOOKS.length;

export const WALKER_FRAMES = 4;
export const GULL_FRAMES = 3;

const FOOTPRINT_INSET: Record<BuildingKind, number> = {
  house: 0.72,
  estate: 0.8,
  granary: 0.9,
  carrotFarm: 0.9,
  onionFarm: 0.9,
  huntingLodge: 0.86,
  fishery: 0.86,
  wheatFarm: 1,
  fountain: 1,
  statue: 1,
  taxOffice: 0.88,
  palace: 0.86,
  infirmary: 0.86,
  watchpost: 0.84,
  heroHall: 0.84,
  monument: 0.8,
  tower: 0.8,
  gymnasium: 0.88,
  dramaSchool: 0.88,
  theatre: 0.9,
  stadium: 0.92,
  hippodrome: 0.92,
  timberMill: 0.86,
  foundry: 0.86,
  armoury: 0.86,
  sculptureStudio: 0.86,
  horseRanch: 0.9,
  mint: 0.84,
  artisansGuild: 0.86,
  masonryShop: 0.86,
  vineyard: 0.9,
  winery: 0.84,
  cardingShed: 0.86,
  tradingPost: 0.82,
  sanctuaryZeus: 0.88,
  sanctuaryPoseidon: 0.88,
  sanctuaryAthena: 0.88,
  sanctuaryArtemis: 0.88,
  sanctuaryApollo: 0.88,
  sanctuaryAres: 0.88,
  sanctuaryAphrodite: 0.88,
  sanctuaryDionysus: 0.88,
  sanctuaryHera: 0.88,
  sanctuaryAtlas: 0.88,
  pyramidModest: 0.84,
  pyramid: 0.86,
  pyramidGreat: 0.88,
  sanctuaryDemeter: 0.88,
  sanctuaryHephaestus: 0.88,
  sanctuaryHermes: 0.88,
  sanctuaryHades: 0.88,
  agora: 0.94,
  growersLodge: 1,
  olivePress: 0.88,
  college: 0.9,
  podium: 0.8,
  maintenanceOffice: 0.86,
};

export class TextureCache {
  private readonly textures = new Map<string, Texture>();
  private readonly structures = new Map<string, StructureSprite>();
  private readonly decorSprites = new Map<string, DecorSprite>();

  walker(kind: WalkerKind, look: number, direction: number, frame: number): Texture {
    return this.cache(`walker:${kind}:${look}:${direction}:${frame}`, () => {
      const surface = createSurface(40, 56);
      drawWalker(surface, kind, look, direction, frame);
      return surface;
    });
  }

  gull(frame: number): Texture {
    return this.cache(`gull:${frame}`, () => {
      const surface = createSurface(24, 14);
      drawGull(surface, frame);
      return surface;
    });
  }

  puff(): Texture {
    return this.cache('puff', () => {
      const size = 48;
      const surface = createSurface(size, size);
      const gradient = surface.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.7)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      surface.ctx.fillStyle = gradient;
      surface.ctx.fillRect(0, 0, size, size);
      return surface;
    });
  }

  roadblock(): DecorSprite {
    return this.decorSprite('roadblock', drawRoadblock);
  }

  wall(): DecorSprite {
    return this.decorSprite('wall', drawWall);
  }

  decor(kind: DecorKind, variant: number): DecorSprite {
    return this.decorSprite(`${kind}:${variant}`, () => drawDecorSurface(kind, variant));
  }

  private decorSprite(key: string, draw: () => { surface: DrawSurface; baseY: number }): DecorSprite {
    const existing = this.decorSprites.get(key);
    if (existing) return existing;

    const { surface, baseY } = draw();
    const sprite: DecorSprite = {
      texture: toTexture(surface),
      anchorX: 0.5,
      anchorY: baseY / surface.height,
    };
    this.decorSprites.set(key, sprite);
    return sprite;
  }

  structure(request: StructureRequest): StructureSprite {
    const key = [
      request.kind,
      request.size,
      request.height,
      request.colour,
      request.roofColour,
      request.variant,
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
  const sun = SUN;
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
    const windows = request.size === 1 ? 2 : 3;
    for (let i = 0; i < windows; i++) {
      const u = (i + 1) / (windows + 1) - 0.07;
      ctx.fillStyle = `rgba(38, 26, 18, ${0.5 + light * 0.16})`;
      ctx.fillRect(u, 0.3, 0.13, 0.32);
      ctx.fillStyle = 'rgba(255, 228, 168, 0.14)';
      ctx.fillRect(u + 0.02, 0.33, 0.09, 0.11);
    }
  }

  const shading = ctx.createLinearGradient(0, 0, 0, 1);
  shading.addColorStop(0, 'rgba(255,255,255,0.09)');
  shading.addColorStop(1, 'rgba(0,0,0,0.26)');
  ctx.fillStyle = shading;
  ctx.fillRect(0, 0, 1, 1);
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
    const light = topLight(sun);
    const top = cy - request.height - halfHeight * 0.3;
    ctx.fillStyle = css(shade(0x7a6f60, light));
    ctx.fillRect(cx - 8, top - 11, 5, 12);
    ctx.fillStyle = css(shade(0x5d5348, light));
    ctx.fillRect(cx - 8.5, top - 12.5, 6, 2);
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

function drawGull(surface: DrawSurface, frame: number): void {
  const { ctx } = surface;
  const cx = 12;
  const cy = 8;
  const lift = [-4, 0, 3][frame % GULL_FRAMES];

  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#f6f3ea';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + lift);
  ctx.quadraticCurveTo(cx - 5, cy - 1 + lift * 0.4, cx, cy);
  ctx.quadraticCurveTo(cx + 5, cy - 1 + lift * 0.4, cx + 10, cy + lift);
  ctx.stroke();

  ctx.strokeStyle = '#4a4640';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + lift + 1);
  ctx.quadraticCurveTo(cx - 5, cy + lift * 0.4, cx, cy + 1);
  ctx.quadraticCurveTo(cx + 5, cy + lift * 0.4, cx + 10, cy + lift + 1);
  ctx.stroke();
}

function drawWalker(surface: DrawSurface, kind: WalkerKind, look: number, direction: number, frame: number): void {
  const { ctx, height } = surface;
  const palette = WALKER_PALETTES[kind];
  const citizen = CITIZEN_LOOKS[look % CITIZEN_LOOKS.length];
  const tunic = shade(palette.tunic, citizen.tunicShade);
  const cx = surface.width / 2;
  const feet = height - 8;
  const facingAway = direction === 2 || direction === 3;
  const facingLeft = direction === 1 || direction === 2;
  const swing = Math.sin((frame / WALKER_FRAMES) * Math.PI * 2);
  const bob = Math.abs(Math.cos((frame / WALKER_FRAMES) * Math.PI * 2)) * 1.5;

  ctx.filter = 'blur(2px)';
  ctx.fillStyle = 'rgba(20,16,10,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx, feet + 3, 9, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';

  ctx.translate(0, -bob);

  if (kind === 'cartPusher' && facingAway) drawCart(ctx, cx, feet, direction);

  ctx.strokeStyle = css(shade(citizen.skin, 0.8));
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 2, feet - 11);
  ctx.lineTo(cx - 2 - 4 * swing, feet - 1);
  ctx.moveTo(cx + 2, feet - 11);
  ctx.lineTo(cx + 2 + 4 * swing, feet - 1);
  ctx.stroke();

  ctx.fillStyle = css(0x5a3d22);
  ctx.fillRect(cx - 4 - 4 * swing, feet - 2, 4.5, 2);
  ctx.fillRect(cx + 4 * swing, feet - 2, 4.5, 2);

  const backArmX = facingLeft ? cx + 6 : cx - 6;
  ctx.strokeStyle = css(shade(citizen.skin, 0.85));
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(backArmX, feet - 25);
  ctx.lineTo(backArmX + 1.5 * swing, feet - 15);
  ctx.stroke();

  const body = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
  body.addColorStop(0, css(shade(tunic, 0.74)));
  body.addColorStop(0.5, css(tunic));
  body.addColorStop(1, css(shade(tunic, 0.88)));
  ctx.fillStyle = body;
  polygonPath(ctx, [cx - 8, feet - 9, cx - 5.5, feet - 27, cx + 5.5, feet - 27, cx + 8, feet - 9]);
  ctx.fill();

  ctx.strokeStyle = css(shade(tunic, 0.8), 0.7);
  ctx.lineWidth = 1;
  for (const fold of [-3, 0, 3]) {
    ctx.beginPath();
    ctx.moveTo(cx + fold, feet - 14);
    ctx.lineTo(cx + fold * 1.4, feet - 9);
    ctx.stroke();
  }

  ctx.fillStyle = css(palette.trim);
  ctx.fillRect(cx - 6.5, feet - 17, 13, 2.4);
  if (!facingAway) {
    ctx.fillStyle = css(palette.trim, 0.85);
    ctx.fillRect(cx - 1, feet - 27, 2, 10);
  }

  const frontArmX = facingLeft ? cx - 6 : cx + 6;
  ctx.strokeStyle = css(citizen.skin);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(frontArmX, feet - 25);
  ctx.lineTo(frontArmX - 1.5 * swing, feet - 15);
  ctx.stroke();

  ctx.fillStyle = css(shade(citizen.skin, 0.9));
  ctx.fillRect(cx - 1.5, feet - 31, 3, 5);

  ctx.fillStyle = css(citizen.skin);
  ctx.beginPath();
  ctx.arc(cx, feet - 34, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = css(citizen.hair);
  ctx.beginPath();
  ctx.arc(cx, feet - 35.5, 6.2, Math.PI, Math.PI * 2);
  ctx.fill();
  if (facingAway) {
    ctx.fillRect(cx - 6.2, feet - 35.5, 12.4, 4);
  } else {
    ctx.fillRect(cx - 6.2, feet - 35.5, 2.2, 4);
    ctx.fillRect(cx + 4, feet - 35.5, 2.2, 4);
  }

  if (!facingAway) {
    ctx.fillStyle = 'rgba(30,22,14,0.85)';
    ctx.fillRect(cx - 3.2, feet - 34, 1.8, 1.8);
    ctx.fillRect(cx + 1.4, feet - 34, 1.8, 1.8);
  }

  if (kind === 'cartPusher' && !facingAway) drawCart(ctx, cx, feet, direction);
  if (kind === 'waterCarrier') drawShoulderedAmphora(ctx, facingLeft ? cx - 7 : cx + 7, feet - 30);
  if (kind === 'peddler' || kind === 'deliveryman') drawHeadBasket(ctx, cx, feet - 41);
}

function drawShoulderedAmphora(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = css(0xb4562c);
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 1.8, y - 5, 3.6, 4);
  ctx.fillStyle = css(0xd97a3c, 0.6);
  ctx.beginPath();
  ctx.ellipse(x - 1.2, y + 2, 1.4, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeadBasket(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
  ctx.fillStyle = css(0xc9a55c);
  polygonPath(ctx, [cx - 7, y, cx + 7, y, cx + 5.5, y - 5, cx - 5.5, y - 5]);
  ctx.fill();
  ctx.strokeStyle = css(0x8f6f32, 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 6.5, y - 2.5);
  ctx.lineTo(cx + 6.5, y - 2.5);
  ctx.stroke();
  ctx.fillStyle = css(0xe0b040);
  for (const dx of [-3, 0, 3]) {
    ctx.beginPath();
    ctx.arc(cx + dx, y - 6, 2, 0, Math.PI * 2);
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

const DECOR_SUN = SUN;

function drawRoadblock(): { surface: DrawSurface; baseY: number } {
  const width = 84;
  const height = 46;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 8;
  const span = 26;
  const postTop = baseY - 24;

  groundShadow(ctx, cx, baseY, 26, 7);

  const timber = shade(0x8a6136, light);
  const timberLit = shade(0xa9784a, light * 1.1);
  const timberDark = shade(0x5f4326, light * 0.85);

  for (const bar of [postTop + 5, postTop + 14]) {
    ctx.fillStyle = css(timber);
    ctx.beginPath();
    ctx.moveTo(cx - span, bar + span * 0.5);
    ctx.lineTo(cx + span, bar - span * 0.5);
    ctx.lineTo(cx + span, bar - span * 0.5 + 5);
    ctx.lineTo(cx - span, bar + span * 0.5 + 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = css(timberLit, 0.7);
    ctx.fillRect(cx - span, bar + span * 0.5 - 1, 1, 1);
  }

  for (const side of [-1, 1]) {
    const px = cx + side * span;
    const py = baseY - side * span * 0.5;
    ctx.fillStyle = css(timberDark);
    ctx.fillRect(px - 3, py - 30, 6, 30);
    ctx.fillStyle = css(timberLit);
    ctx.fillRect(px - 3, py - 30, 2.5, 30);
  }

  return { surface, baseY };
}

function drawWall(): { surface: DrawSurface; baseY: number } {
  const halfW = TILE_WIDTH / 2;
  const halfH = TILE_HEIGHT / 2;
  const wallHeight = 26;
  const width = TILE_WIDTH + 12;
  const height = TILE_HEIGHT + wallHeight + 18;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 6;
  const capBottom = baseY - wallHeight;
  const capTop = capBottom - TILE_HEIGHT;

  const top = shade(0xdfd6b8, light * 1.04);
  const east = shade(0xc2b797, light);
  const south = shade(0x9d9376, light * 0.84);

  ctx.fillStyle = css(east);
  ctx.beginPath();
  ctx.moveTo(cx, capBottom);
  ctx.lineTo(cx + halfW, capBottom - halfH);
  ctx.lineTo(cx + halfW, capBottom - halfH + wallHeight);
  ctx.lineTo(cx, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = css(south);
  ctx.beginPath();
  ctx.moveTo(cx, capBottom);
  ctx.lineTo(cx - halfW, capBottom - halfH);
  ctx.lineTo(cx - halfW, capBottom - halfH + wallHeight);
  ctx.lineTo(cx, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = css(top);
  ctx.beginPath();
  ctx.moveTo(cx, capTop);
  ctx.lineTo(cx + halfW, capTop + halfH);
  ctx.lineTo(cx, capBottom);
  ctx.lineTo(cx - halfW, capTop + halfH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = css(shade(0x8f866c, light * 0.8), 0.4);
  ctx.lineWidth = 1;
  for (const course of [0.4, 0.75]) {
    const drop = wallHeight * course;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, capBottom - halfH + drop);
    ctx.lineTo(cx, capBottom + drop);
    ctx.lineTo(cx + halfW, capBottom - halfH + drop);
    ctx.stroke();
  }

  return { surface, baseY };
}

function drawDecorSurface(kind: DecorKind, variant: number): { surface: DrawSurface; baseY: number } {
  if (kind === 'cypress') return drawCypress(variant);
  if (kind === 'olive') return drawOlive(variant);
  if (kind === 'scrub') return drawScrub(variant);
  return drawBoulder(variant);
}

function groundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  radiusX: number,
  radiusY: number,
): void {
  ctx.save();
  ctx.filter = 'blur(2.5px)';
  ctx.fillStyle = 'rgba(24, 19, 12, 0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function castShadow(ctx: CanvasRenderingContext2D, cx: number, baseY: number, length: number, girth: number): void {
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = 'rgba(24, 19, 12, 0.22)';
  ctx.beginPath();
  ctx.ellipse(cx - length * 0.5, baseY + length * 0.12, length * 0.55, girth, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCypress(variant: number): { surface: DrawSurface; baseY: number } {
  const width = 72;
  const height = 112;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const random = createRandom(variant * 733 + 41);
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 6;
  const trunkHeight = 10 + random() * 3;
  const canopyTop = 9 + random() * 5;
  const canopyBottom = baseY - trunkHeight;
  const lean = (random() - 0.5) * 3;

  castShadow(ctx, cx, baseY, 34, 5);
  groundShadow(ctx, cx, baseY, 12, 4);

  ctx.fillStyle = css(shade(0x5a4630, light));
  ctx.fillRect(cx - 2, canopyBottom, 4, trunkHeight);

  const dark = shade(0x3d6144, light * 0.9);
  const base = shade(0x4a6d4b, light);
  const lit = shade(0x648360, light * 1.14);

  const segments = 10;
  for (let i = segments - 1; i >= 0; i--) {
    const t = i / (segments - 1);
    const y = canopyBottom - t * (canopyBottom - canopyTop);
    const spread = (1 - t * 0.85) * (14.5 - random() * 2);
    const shift = lean * t;
    ctx.fillStyle = css(i % 2 === 0 ? base : dark);
    ctx.beginPath();
    ctx.ellipse(cx + shift, y, spread, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = css(lit, 0.55);
  for (let i = segments - 1; i >= 1; i -= 2) {
    const t = i / (segments - 1);
    const y = canopyBottom - t * (canopyBottom - canopyTop);
    const spread = (1 - t * 0.85) * 14.5;
    ctx.beginPath();
    ctx.ellipse(cx + lean * t + spread * 0.3, y, spread * 0.45, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return { surface, baseY };
}

function drawOlive(variant: number): { surface: DrawSurface; baseY: number } {
  const width = 110;
  const height = 88;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const random = createRandom(variant * 919 + 7);
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 6;

  castShadow(ctx, cx, baseY, 30, 9);
  groundShadow(ctx, cx, baseY, 20, 6);

  const trunkTop = baseY - 27;
  ctx.strokeStyle = css(shade(0x584730, light * 0.9));
  ctx.lineWidth = 6.2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, baseY);
  ctx.quadraticCurveTo(cx + 8, baseY - 18, cx - 2, trunkTop);
  ctx.stroke();
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(cx - 2, trunkTop + 9);
  ctx.quadraticCurveTo(cx - 13, trunkTop - 2, cx - 17, trunkTop - 15);
  ctx.stroke();
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(cx - 1, trunkTop + 6);
  ctx.quadraticCurveTo(cx + 11, trunkTop - 4, cx + 16, trunkTop - 16);
  ctx.stroke();

  const dark = shade(0x7d8b5c, light * 0.92);
  const mid = shade(0x9fae78, light);
  const lit = shade(0xc2cc9c, light * 1.05);
  const canopyCx = cx;
  const canopyCy = trunkTop - 13;

  ctx.fillStyle = css(mid);
  ctx.beginPath();
  ctx.ellipse(canopyCx, canopyCy, 24, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + random();
    const radius = 13 + random() * 7;
    const px = canopyCx + Math.cos(angle) * radius * 1.15;
    const py = canopyCy + Math.sin(angle) * radius * 0.7;
    ctx.fillStyle = css(i % 3 === 0 ? dark : mid);
    ctx.beginPath();
    ctx.ellipse(px, py, 7 + random() * 3, 5.6 + random() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = css(lit, 0.55);
  for (let i = 0; i < 6; i++) {
    const px = canopyCx - 12 + random() * 20;
    const py = canopyCy - 14 + random() * 10;
    ctx.beginPath();
    ctx.ellipse(px, py, 6.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return { surface, baseY };
}

function drawScrub(variant: number): { surface: DrawSurface; baseY: number } {
  const width = 46;
  const height = 34;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const random = createRandom(variant * 331 + 3);
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 6;

  groundShadow(ctx, cx, baseY, 13, 4);

  const dark = shade(0x869149, light * 0.9);
  const mid = shade(0x97a259, light);
  const lit = shade(0xaab568, light * 1.08);

  const tufts = 8;
  for (let i = 0; i < tufts; i++) {
    const angle = (i / tufts) * Math.PI * 2 + random() * 0.4;
    const px = cx + Math.cos(angle) * 9;
    const py = baseY - 7 + Math.sin(angle) * 4;
    const radius = 7 + random() * 3.4;
    ctx.fillStyle = css(i % 2 === 0 ? mid : dark);
    ctx.beginPath();
    ctx.ellipse(px, py, radius, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = css(lit, 0.7);
  for (let i = 0; i < 3; i++) {
    const px = cx - 6 + random() * 12;
    const py = baseY - 13 + random() * 6;
    ctx.beginPath();
    ctx.ellipse(px, py, 5.6, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return { surface, baseY };
}

function drawBoulder(variant: number): { surface: DrawSurface; baseY: number } {
  const width = 96;
  const height = 74;
  const surface = createSurface(width, height);
  const { ctx } = surface;
  const random = createRandom(variant * 511 + 19);
  const light = topLight(DECOR_SUN);
  const cx = width / 2;
  const baseY = height - 8;

  castShadow(ctx, cx, baseY, 40, 7);
  groundShadow(ctx, cx, baseY + 1, 26, 7);

  const stones: Array<{ x: number; y: number; halfWidth: number; rise: number }> = [
    { x: cx - 15 + random() * 6, y: baseY - 9 - random() * 4, halfWidth: 9 + random() * 4, rise: 13 + random() * 6 },
    { x: cx + 10 + random() * 8, y: baseY - 7 - random() * 5, halfWidth: 11 + random() * 5, rise: 16 + random() * 8 },
    { x: cx - 4 + random() * 8, y: baseY - 1, halfWidth: 14 + random() * 5, rise: 22 + random() * 10 },
    { x: cx - 24 + random() * 6, y: baseY, halfWidth: 7 + random() * 4, rise: 9 + random() * 5 },
    { x: cx + 22 + random() * 8, y: baseY + 1, halfWidth: 8 + random() * 4, rise: 10 + random() * 6 },
  ];

  for (const stone of stones) {
    paintRock(ctx, random, stone.x, stone.y, stone.halfWidth, stone.rise, light * (0.92 + random() * 0.16));
  }

  ctx.fillStyle = css(shade(0x6f7a3c, light), 0.8);
  for (let i = 0; i < 7; i++) {
    const tx = cx + (random() - 0.5) * 62;
    const ty = baseY + 1 - random() * 5;
    ctx.beginPath();
    ctx.ellipse(tx, ty, 3.5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return { surface, baseY };
}

function paintRock(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  cx: number,
  baseY: number,
  halfWidth: number,
  rise: number,
  light: number,
): void {
  const lit = shade(0xfffbef, light);
  const mid = shade(0xe4dcc2, light);
  const dark = shade(0x9b8f74, light * 0.8);

  const corners = 7;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < corners; i++) {
    const angle = Math.PI + (i / (corners - 1)) * Math.PI;
    const wobble = 0.76 + random() * 0.3;
    points.push([cx + Math.cos(angle) * halfWidth * wobble, baseY + Math.sin(angle) * rise * wobble]);
  }

  const gradient = ctx.createLinearGradient(cx - halfWidth, baseY - rise, cx + halfWidth * 0.7, baseY);
  gradient.addColorStop(0, css(lit));
  gradient.addColorStop(0.55, css(mid));
  gradient.addColorStop(1, css(dark));

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, baseY + 1);
  for (const [px, py] of points) ctx.lineTo(px, py);
  ctx.lineTo(cx + halfWidth, baseY + 1);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = css(dark, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = css(dark, 0.4);
  ctx.beginPath();
  ctx.moveTo(cx + halfWidth * 0.25, baseY - rise * 0.5);
  ctx.lineTo(cx + halfWidth, baseY + 1);
  ctx.lineTo(cx + halfWidth * 0.2, baseY + 1);
  ctx.closePath();
  ctx.fill();
}
