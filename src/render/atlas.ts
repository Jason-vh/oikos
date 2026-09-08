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
const CLIFF_HEIGHT = 44;
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
    base: 0xadb768,
    highlight: 0xc2c988,
    speckles: [0x93a557, 0xc6d189, 0xb2bd6b, 0x9fae5e],
  },
  [TERRAIN_MEADOW]: {
    base: 0xdcd28c,
    highlight: 0xeae09f,
    speckles: [0xcdc27c, 0xf0e8b0, 0xd5cb84, 0xe3d996],
  },
  [TERRAIN_ROCK]: {
    base: 0xd2ccbc,
    highlight: 0xe6e1d3,
    speckles: [0xc3bbaa, 0xefebe0, 0xb9b0a0, 0xdcd6c8],
  },
  [TERRAIN_SAND]: {
    base: 0xefe5bd,
    highlight: 0xf8f1d6,
    speckles: [0xe4d8ac, 0xfbf6e4, 0xdccfa0],
  },
};

const WILDFLOWER_COLOURS = [0xd9584a, 0xf0d472, 0xfbf9f0, 0xc4a9dc];
const PEBBLE_COLOUR = 0xc0b6a2;

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

  shore(direction: BlendDirection): Texture {
    return this.lookup(`shore:${direction}`);
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

  for (const direction of DIRECTIONS) {
    tile(`shore:${direction}`, (ctx, x, y, w, h) => drawShore(ctx, x, y, w, h, direction));
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
  const tone = 0.98 + random() * 0.04;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  gradient.addColorStop(0, css(shade(palette.base, tone * 1.01)));
  gradient.addColorStop(1, css(shade(palette.base, tone * 0.99)));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  speckle(ctx, random, { x, y, width, height }, 320, palette.speckles, 2.4, 0.42);

  if (kind === TERRAIN_GRASS || kind === TERRAIN_MEADOW) {
    drawBlades(ctx, random, palette, x, y, width, height);
    drawPebbles(ctx, random, x, y, width, height, 3 + (variant % 3));
    drawWildflowers(ctx, random, x, y, width, height, variant % 4);
  }
  if (kind === TERRAIN_MEADOW) drawFurrows(ctx, cx, cy);
  if (kind === TERRAIN_ROCK) drawStones(ctx, random, x, y, width, height);
  if (kind === TERRAIN_SAND) drawPebbles(ctx, random, x, y, width, height, 4);

  ctx.restore();
}

function drawPebbles(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const px = x + random() * width;
    const py = y + random() * height;
    const size = 1 + random() * 1.8;
    ctx.fillStyle = css(PEBBLE_COLOUR, 0.5);
    ctx.beginPath();
    ctx.ellipse(px, py, size, size * 0.7, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWildflowers(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const fx = x + random() * width;
    const fy = y + random() * height;
    ctx.fillStyle = css(WILDFLOWER_COLOURS[Math.floor(random() * WILDFLOWER_COLOURS.length)], 0.75);
    ctx.beginPath();
    ctx.arc(fx, fy, 1, 0, Math.PI * 2);
    ctx.fill();
  }
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
  ctx.strokeStyle = 'rgba(150, 130, 60, 0.3)';
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
    ctx.fillStyle = css(0xe0d9c6, 0.7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,100,80,0.45)';
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

  ctx.fillStyle = css(0xdccba6);
  ctx.fillRect(x, y, width, height);
  speckle(ctx, random, { x, y, width, height }, 140, [0xcfbc98, 0xe8dcc0, 0xc2ae8a], 2, 0.32);

  drawFlagstones(ctx, random, x, y, width, height);

  const north = { x: cx, y: cy - HALF_H };
  const east = { x: cx + HALF_W, y: cy };
  const south = { x: cx, y: cy + HALF_H };
  const west = { x: cx - HALF_W, y: cy };
  drawEdgingStones(ctx, random, north, east);
  drawEdgingStones(ctx, random, south, west);

  const rut = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  rut.addColorStop(0, 'rgba(0,0,0,0.14)');
  rut.addColorStop(0.5, 'rgba(0,0,0,0)');
  rut.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = rut;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawFlagstones(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const cols = 4;
  const rows = 4;
  const cellW = width / cols;
  const cellH = height / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const jitter = 0.28;
      const sx = x + (col + 0.5 + (random() - 0.5) * jitter) * cellW;
      const sy = y + (row + 0.5 + (random() - 0.5) * jitter) * cellH;
      const sw = cellW * (0.62 + random() * 0.24);
      const sh = cellH * (0.62 + random() * 0.24);
      const rot = (random() - 0.5) * 0.3;
      const tone = 0.92 + random() * 0.16;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      polygonPath(ctx, [
        -sw / 2, -sh / 2,
        sw / 2, -sh / 2 + sh * 0.08,
        sw / 2 - sw * 0.06, sh / 2,
        -sw / 2 + sw * 0.05, sh / 2 - sh * 0.05,
      ]);
      ctx.fillStyle = css(shade(0xdccba6, tone), 0.45);
      ctx.fill();
      ctx.strokeStyle = 'rgba(94, 78, 54, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawEdgingStones(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const nx = -dy / length;
  const ny = dx / length;
  const steps = 9;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const inward = 3 + random() * 2;
    const px = from.x + dx * t + nx * inward;
    const py = from.y + dy * t + ny * inward;
    const size = 1.6 + random() * 1.4;
    ctx.fillStyle = css(0xa89876, 0.55);
    ctx.beginPath();
    ctx.ellipse(px, py, size, size * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
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

  ctx.lineWidth = 1.6;
  for (let band = 0; band < 7; band++) {
    ctx.strokeStyle = `rgba(214, 245, 240, ${0.1 + 0.08 * Math.sin(phase + band * 1.7)})`;
    ctx.beginPath();
    for (let px = 0; px <= width; px += 6) {
      const py =
        y + 6 + band * 8 + Math.sin(phase + px * 0.09 + band) * 2.4 + Math.sin(phase * 1.3) * 1.5;
      if (px === 0) ctx.moveTo(x + px, py);
      else ctx.lineTo(x + px, py);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 14; i++) {
    const t = phase + i * 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.14 * Math.abs(Math.sin(t))})`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(t) * HALF_W * 0.55, cy + Math.sin(t * 1.3) * HALF_H * 0.5, 4, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(cx, cy);
  ctx.scale(1, HALF_H / HALF_W);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, HALF_W);
  fade.addColorStop(0.5, 'rgba(0,0,0,1)');
  fade.addColorStop(0.9, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(-HALF_W, -HALF_W, HALF_W * 2, HALF_W * 2);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();
  ctx.fillStyle = css(0x2f8fa8);
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

const EDGE_NORMALS: Record<BlendDirection, [number, number]> = {
  east: [HALF_W / 2, HALF_H / 2],
  south: [-HALF_W / 2, HALF_H / 2],
  west: [-HALF_W / 2, -HALF_H / 2],
  north: [HALF_W / 2, -HALF_H / 2],
};

function drawShore(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  direction: BlendDirection,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const [ex, ey] = EDGE_NORMALS[direction];
  const random = createRandom(direction.length * 17 + direction.charCodeAt(0));
  const edgeMid = { x: cx + ex, y: cy + ey };
  const normalLength = Math.hypot(ex, ey);
  const inward = { x: -ex / normalLength, y: -ey / normalLength };
  const alongLength = Math.hypot(ey * 2, ex / 2);
  const along = { x: (-ey * 2) / alongLength, y: ex / 2 / alongLength };
  const halfEdge = Math.hypot(HALF_W, HALF_H) / 2;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  const shallows = ctx.createLinearGradient(edgeMid.x, edgeMid.y, cx + ex * 0.35, cy + ey * 0.35);
  shallows.addColorStop(0, 'rgba(160, 222, 214, 0.7)');
  shallows.addColorStop(0.45, 'rgba(120, 198, 196, 0.3)');
  shallows.addColorStop(1, 'rgba(90, 170, 175, 0)');
  ctx.fillStyle = shallows;
  ctx.fillRect(x, y, width, height);

  ctx.lineWidth = 1.4;
  for (let line = 0; line < 2; line++) {
    const inset = 3 + line * 4.5;
    ctx.strokeStyle = `rgba(238, 251, 248, ${line === 0 ? 0.6 : 0.3})`;
    ctx.beginPath();
    for (let step = -halfEdge; step <= halfEdge; step += 3) {
      const wobble = Math.sin(step * 0.3 + line * 1.9) * 1.3 + (random() - 0.5) * 0.8;
      const px = edgeMid.x + along.x * step + inward.x * (inset + wobble);
      const py = edgeMid.y + along.y * step + inward.y * (inset + wobble);
      if (step === -halfEdge) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
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
  const [ex, ey] = EDGE_NORMALS[direction];
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
  const shadowed = light < 1;
  const base = shade(shadowed ? 0xdcd2b6 : 0xe8dfc6, light);

  ctx.fillStyle = css(base);
  ctx.fillRect(x, y, width, height);

  for (let i = 0; i < 9; i++) {
    const stratum = y + random() * height;
    const bandTone = 0.8 + random() * 0.36;
    ctx.fillStyle = css(shade(base, bandTone), 0.7);
    ctx.fillRect(x, stratum, width, 2 + random() * 4);
  }

  for (let i = 0; i < 5; i++) {
    const crackY = y + random() * height;
    ctx.strokeStyle = shadowed ? 'rgba(120, 104, 76, 0.35)' : 'rgba(140, 122, 90, 0.28)';
    ctx.lineWidth = 0.8 + random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, crackY);
    for (let px = 0; px <= width; px += 8) {
      ctx.lineTo(x + px, crackY + Math.sin(px * 0.3 + i) * 1.4);
    }
    ctx.stroke();
  }

  speckle(ctx, random, { x, y, width, height }, 70, [shade(base, 0.82), shade(base, 1.12)], 1.5, 0.4);

  const warmth = shadowed ? 'rgba(110, 92, 64, 0.1)' : 'rgba(255, 240, 205, 0.06)';
  ctx.fillStyle = warmth;
  ctx.fillRect(x, y, width, height);

  const occlusion = ctx.createLinearGradient(0, y, 0, y + height);
  occlusion.addColorStop(0, 'rgba(0,0,0,0.01)');
  occlusion.addColorStop(0.6, shadowed ? 'rgba(80,66,44,0.12)' : 'rgba(0,0,0,0.07)');
  occlusion.addColorStop(1, shadowed ? 'rgba(70,58,38,0.22)' : 'rgba(0,0,0,0.16)');
  ctx.fillStyle = occlusion;
  ctx.fillRect(x, y, width, height);

  const lip = ctx.createLinearGradient(0, y, 0, y + 4);
  lip.addColorStop(0, 'rgba(96, 92, 48, 0.9)');
  lip.addColorStop(1, 'rgba(96, 92, 48, 0)');
  ctx.fillStyle = lip;
  ctx.fillRect(x, y, width, 4);

  ctx.fillStyle = 'rgba(40, 30, 20, 0.35)';
  ctx.fillRect(x, y + height - 1, width, 1);
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
