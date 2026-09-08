import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { TERRAIN_GRASS, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from '../sim/grid';
import { createRandom } from '../sim/mapgen';
import { TEXTURE_SCALE, createSurface, css, diamondPath, polygonPath, shade, speckle } from './canvas';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';

export type BlendDirection = 'east' | 'south' | 'west' | 'north';

export const TERRAIN_VARIANTS = 6;
export const ROAD_VARIANTS = 3;
export const WATER_FRAMES = 8;

const CELL_PAD = 6;
const CELL_WIDTH = TILE_WIDTH + 4;
const CELL_HEIGHT = TILE_HEIGHT + 4;
const CLIFF_WIDTH = 72;
const CLIFF_HEIGHT = 110;
const ATLAS_MAX_WIDTH = 2048;

const HALF_W = TILE_WIDTH / 2 + 0.75;
const HALF_H = TILE_HEIGHT / 2 + 0.4;

const BLENDABLE = [TERRAIN_GRASS, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND];
const DIRECTIONS: BlendDirection[] = ['east', 'south', 'west', 'north'];

export const TERRAIN_PRIORITY: Record<number, number> = {
  [TERRAIN_GRASS]: 1,
  [TERRAIN_MEADOW]: 2,
  [TERRAIN_ROCK]: 3,
  [TERRAIN_SAND]: 4,
  [TERRAIN_WATER]: 5,
};

interface TerrainPalette {
  base: number;
  highlight: number;
  speckles: number[];
}

const TERRAIN_PALETTES: Record<number, TerrainPalette> = {
  [TERRAIN_GRASS]: {
    base: 0x6c9b4a,
    highlight: 0x86b45c,
    speckles: [0x5c8a3e, 0x7fae54, 0x9cc169, 0x4f7a36],
  },
  [TERRAIN_MEADOW]: {
    base: 0x8fbb55,
    highlight: 0xa8cf68,
    speckles: [0xb6d477, 0x789f45, 0xd8dd7a, 0xc7d06a],
  },
  [TERRAIN_ROCK]: {
    base: 0x8d8779,
    highlight: 0xa39c8c,
    speckles: [0x6f6a5e, 0xb0a897, 0x7d7768, 0x9a9384],
  },
  [TERRAIN_SAND]: {
    base: 0xd8c898,
    highlight: 0xe6d8ae,
    speckles: [0xc4b283, 0xece0bb, 0xb9a677],
  },
};

interface Cell {
  key: string;
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => void;
  x: number;
  y: number;
}

export class TileAtlas {
  private readonly textures = new Map<string, Texture>();

  constructor() {
    const cells = layout(defineCells());
    const canvas = document.createElement('canvas');
    const width = Math.min(
      ATLAS_MAX_WIDTH,
      cells.reduce((max, cell) => Math.max(max, cell.x + cell.width + CELL_PAD), 0),
    );
    const height = cells.reduce((max, cell) => Math.max(max, cell.y + cell.height + CELL_PAD), 0);

    canvas.width = width * TEXTURE_SCALE;
    canvas.height = height * TEXTURE_SCALE;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    for (const cell of cells) {
      const surface = createSurface(cell.width, cell.height);
      cell.draw(surface.ctx, 0, 0, cell.width, cell.height);
      ctx.drawImage(surface.canvas, cell.x * TEXTURE_SCALE, cell.y * TEXTURE_SCALE);
    }

    const source = new CanvasSource({ resource: canvas, resolution: TEXTURE_SCALE, antialias: true });
    for (const cell of cells) {
      this.textures.set(
        cell.key,
        new Texture({ source, frame: new Rectangle(cell.x, cell.y, cell.width, cell.height) }),
      );
    }
  }

  terrain(kind: number, variant: number): Texture {
    return this.lookup(`terrain:${kind}:${variant % TERRAIN_VARIANTS}`);
  }

  blend(kind: number, direction: BlendDirection): Texture {
    return this.lookup(`blend:${kind}:${direction}`);
  }

  road(variant: number): Texture {
    return this.lookup(`road:${variant % ROAD_VARIANTS}`);
  }

  water(frame: number): Texture {
    return this.lookup(`water:${frame % WATER_FRAMES}`);
  }

  cliff(face: 'left' | 'right'): Texture {
    return this.lookup(`cliff:${face}`);
  }

  marker(): Texture {
    return this.lookup('marker');
  }

  overlay(): Texture {
    return this.lookup('overlay');
  }

  private lookup(key: string): Texture {
    const texture = this.textures.get(key);
    if (!texture) throw new Error(`Missing atlas cell: ${key}`);
    return texture;
  }
}

function defineCells(): Cell[] {
  const cells: Cell[] = [];
  const tile = (key: string, draw: Cell['draw']) =>
    cells.push({ key, width: CELL_WIDTH, height: CELL_HEIGHT, draw, x: 0, y: 0 });

  for (const kind of BLENDABLE) {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant++) {
      tile(`terrain:${kind}:${variant}`, (ctx, x, y, w, h) => drawTerrain(ctx, x, y, w, h, kind, variant));
    }
    for (const direction of DIRECTIONS) {
      tile(`blend:${kind}:${direction}`, (ctx, x, y, w, h) => {
        drawTerrain(ctx, x, y, w, h, kind, 0);
        maskEdge(ctx, x, y, w, h, direction);
      });
    }
  }

  for (let variant = 0; variant < ROAD_VARIANTS; variant++) {
    tile(`road:${variant}`, (ctx, x, y, w, h) => drawRoad(ctx, x, y, w, h, variant));
  }

  for (let frame = 0; frame < WATER_FRAMES; frame++) {
    tile(`water:${frame}`, (ctx, x, y, w, h) => drawWater(ctx, x, y, w, h, frame));
  }

  tile('marker', (ctx, x, y, w, h) => drawMarker(ctx, x, y, w, h));
  tile('overlay', (ctx, x, y, w, h) => {
    diamondPath(ctx, x + w / 2, y + h / 2, HALF_W, HALF_H);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fill();
  });

  for (const face of ['left', 'right'] as const) {
    cells.push({
      key: `cliff:${face}`,
      width: CLIFF_WIDTH,
      height: CLIFF_HEIGHT,
      draw: (ctx, x, y, w, h) => drawCliff(ctx, x, y, w, h, face === 'right' ? 1.06 : 0.74),
      x: 0,
      y: 0,
    });
  }

  return cells;
}

function layout(cells: Cell[]): Cell[] {
  let cursorX = CELL_PAD;
  let cursorY = CELL_PAD;
  let rowHeight = 0;

  for (const cell of cells) {
    if (cursorX + cell.width + CELL_PAD > ATLAS_MAX_WIDTH) {
      cursorX = CELL_PAD;
      cursorY += rowHeight + CELL_PAD;
      rowHeight = 0;
    }
    cell.x = cursorX;
    cell.y = cursorY;
    cursorX += cell.width + CELL_PAD;
    rowHeight = Math.max(rowHeight, cell.height);
  }

  return cells;
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  kind: number,
  variant: number,
): void {
  const palette = TERRAIN_PALETTES[kind] ?? TERRAIN_PALETTES[TERRAIN_GRASS];
  const random = createRandom(kind * 7919 + variant * 104729 + 17);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const tone = 0.97 + random() * 0.07;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  gradient.addColorStop(0, css(shade(palette.base, tone * 1.03)));
  gradient.addColorStop(1, css(shade(palette.base, tone * 0.97)));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  speckle(ctx, random, { x, y, width, height }, 320, palette.speckles, 2.4, 0.42);

  if (kind === TERRAIN_GRASS || kind === TERRAIN_MEADOW) {
    drawBlades(ctx, random, palette, x, y, width, height);
  }
  if (kind === TERRAIN_MEADOW) drawFurrows(ctx, cx, cy);
  if (kind === TERRAIN_ROCK) drawStones(ctx, random, x, y, width, height);

  ctx.restore();
}

function drawBlades(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  palette: TerrainPalette,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    const bx = x + random() * width;
    const by = y + random() * height;
    const length = 2 + random() * 4;
    ctx.strokeStyle = css(palette.speckles[Math.floor(random() * palette.speckles.length)], 0.55);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (random() - 0.5) * 2, by - length);
    ctx.stroke();
  }
}

function drawFurrows(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.strokeStyle = 'rgba(116, 148, 58, 0.3)';
  ctx.lineWidth = 1.5;
  for (let i = -4; i <= 4; i++) {
    const offset = i * 7;
    ctx.beginPath();
    ctx.moveTo(cx - HALF_W + offset, cy + offset * (HALF_H / HALF_W));
    ctx.lineTo(cx + offset, cy - HALF_H + offset * (HALF_H / HALF_W));
    ctx.stroke();
  }
}

function drawStones(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let i = 0; i < 10; i++) {
    const sx = x + random() * width;
    const sy = y + random() * height;
    const size = 3 + random() * 7;
    polygonPath(ctx, [
      sx, sy - size,
      sx + size, sy - size * 0.2,
      sx + size * 0.6, sy + size * 0.7,
      sx - size * 0.7, sy + size * 0.4,
      sx - size, sy - size * 0.4,
    ]);
    ctx.fillStyle = css(0x9a9285, 0.75);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,56,48,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  variant: number,
): void {
  const random = createRandom(4242 + variant * 977);
  const cx = x + width / 2;
  const cy = y + height / 2;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  ctx.fillStyle = css(0xa89a7c);
  ctx.fillRect(x, y, width, height);
  speckle(ctx, random, { x, y, width, height }, 200, [0x8d7f63, 0xc0b291, 0x776a52], 2.4, 0.6);

  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = css(0x6f6450, 0.32);
    ctx.beginPath();
    ctx.ellipse(
      x + random() * width,
      y + random() * height,
      2 + random() * 3,
      1 + random() * 1.6,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const rut = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  rut.addColorStop(0, 'rgba(0,0,0,0.16)');
  rut.addColorStop(0.5, 'rgba(0,0,0,0)');
  rut.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = rut;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  frame: number,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const phase = (frame / WATER_FRAMES) * Math.PI * 2;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  gradient.addColorStop(0, css(0x2f6f9e));
  gradient.addColorStop(0.55, css(0x3f89b8));
  gradient.addColorStop(1, css(0x2a5f8c));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  ctx.lineWidth = 1.6;
  for (let band = 0; band < 7; band++) {
    ctx.strokeStyle = `rgba(198, 231, 248, ${0.09 + 0.07 * Math.sin(phase + band * 1.7)})`;
    ctx.beginPath();
    for (let px = 0; px <= width; px += 6) {
      const py =
        y + 6 + band * 8 + Math.sin(phase + px * 0.09 + band) * 2.4 + Math.sin(phase * 1.3) * 1.5;
      if (px === 0) ctx.moveTo(x + px, py);
      else ctx.lineTo(x + px, py);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 10; i++) {
    const t = phase + i * 2.1;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.1 * Math.abs(Math.sin(t))})`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(t) * HALF_W * 0.55, cy + Math.sin(t * 1.3) * HALF_H * 0.5, 4, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function maskEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  direction: BlendDirection,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const edges: Record<BlendDirection, [number, number]> = {
    east: [HALF_W / 2, HALF_H / 2],
    south: [-HALF_W / 2, HALF_H / 2],
    west: [-HALF_W / 2, -HALF_H / 2],
    north: [HALF_W / 2, -HALF_H / 2],
  };

  const [ex, ey] = edges[direction];
  const gradient = ctx.createLinearGradient(cx + ex * 1.6, cy + ey * 1.6, cx - ex * 1.4, cy - ey * 1.4);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(0.9, 'rgba(0,0,0,0)');

  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

function drawCliff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  light: number,
): void {
  const random = createRandom(Math.round(light * 1000) + 31);
  const base = shade(0x9a8b73, light);

  ctx.fillStyle = css(base);
  ctx.fillRect(x, y, width, height);

  for (let i = 0; i < 24; i++) {
    const stratum = y + random() * height;
    ctx.fillStyle = css(shade(base, 0.84 + random() * 0.28), 0.5);
    ctx.fillRect(x, stratum, width, 1 + random() * 5);
  }

  speckle(ctx, random, { x, y, width, height }, 200, [shade(base, 0.7), shade(base, 1.2)], 2.4, 0.45);

  for (let i = 0; i < 14; i++) {
    const fx = x + random() * width;
    const fy = y + random() * height;
    ctx.strokeStyle = 'rgba(40,34,26,0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + (random() - 0.5) * 20, fy + random() * 26);
    ctx.stroke();
  }

  const occlusion = ctx.createLinearGradient(0, y, 0, y + height);
  occlusion.addColorStop(0, 'rgba(0,0,0,0.04)');
  occlusion.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  occlusion.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = occlusion;
  ctx.fillRect(x, y, width, height);
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;

  diamondPath(ctx, cx, cy, HALF_W - 2, HALF_H - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}
