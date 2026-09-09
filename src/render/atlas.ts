import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { TERRAIN_GRASS, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from '../sim/grid';
import { createRandom } from '../sim/mapgen';
import { TEXTURE_SCALE, createSurface, css, diamondPath, polygonPath, shade, speckle } from './canvas';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';

export type BlendDirection = 'east' | 'south' | 'west' | 'north';

export const TERRAIN_VARIANTS = 6;
export const ROAD_VARIANTS = 3;
export const ROAD_GRADES = 3;
export const WATER_FRAMES = 8;

const CELL_PAD = 6;
const CELL_WIDTH = TILE_WIDTH + 4;
const CELL_HEIGHT = TILE_HEIGHT + 4;
const CLIFF_WIDTH = 72;
const CLIFF_BAND_HEIGHT = 30;
const CLIFF_RIM_HEIGHT = 26;
export const CLIFF_VARIANTS = 3;
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

  road(grade: number, variant: number): Texture {
    return this.lookup(`road:${grade % ROAD_GRADES}:${variant % ROAD_VARIANTS}`);
  }

  water(frame: number): Texture {
    return this.lookup(`water:${frame % WATER_FRAMES}`);
  }

  shore(direction: BlendDirection): Texture {
    return this.lookup(`shore:${direction}`);
  }

  cliff(face: 'left' | 'right', variant: number): Texture {
    return this.lookup(`cliff:${face}:${variant % CLIFF_VARIANTS}`);
  }

  cliffRim(face: 'left' | 'right', variant: number): Texture {
    return this.lookup(`cliffRim:${face}:${variant % CLIFF_VARIANTS}`);
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

  for (let grade = 0; grade < ROAD_GRADES; grade++) {
    for (let variant = 0; variant < ROAD_VARIANTS; variant++) {
      tile(`road:${grade}:${variant}`, (ctx, x, y, w, h) => drawRoad(ctx, x, y, w, h, grade, variant));
    }
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
    const light = face === 'right' ? 1.06 : 0.74;
    for (let variant = 0; variant < CLIFF_VARIANTS; variant++) {
      cells.push({
        key: `cliff:${face}:${variant}`,
        width: CLIFF_WIDTH,
        height: CLIFF_BAND_HEIGHT,
        draw: (ctx, x, y, w, h) => drawCliffBand(ctx, x, y, w, h, light, variant),
        x: 0,
        y: 0,
      });
      cells.push({
        key: `cliffRim:${face}:${variant}`,
        width: CLIFF_WIDTH,
        height: CLIFF_RIM_HEIGHT,
        draw: (ctx, x, y, w, h) => drawCliffRim(ctx, x, y, w, h, light, variant),
        x: 0,
        y: 0,
      });
    }
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
  for (let i = 0; i < 7; i++) {
    const sx = x + random() * width;
    const sy = y + random() * height;
    const halfWidth = 3 + random() * 5;
    drawRock(ctx, random, sx, sy, halfWidth, halfWidth * (0.5 + random() * 0.4), 0.98 + random() * 0.08);
    if (random() < 0.4) tuft(ctx, random, sx + halfWidth * 0.6, sy, 1);
  }
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  grade: number,
  variant: number,
): void {
  const random = createRandom(4242 + variant * 977 + grade * 5153);
  const cx = x + width / 2;
  const cy = y + height / 2;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  if (grade === 0) drawTrack(ctx, random, x, y, width, height, cx, cy);
  if (grade === 1) drawCobbles(ctx, random, x, y, width, height, cx, cy);
  if (grade === 2) drawSlabs(ctx, random, x, y, width, height, cx, cy);

  const rut = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  rut.addColorStop(0, 'rgba(0,0,0,0.12)');
  rut.addColorStop(0.5, 'rgba(0,0,0,0)');
  rut.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = rut;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function isoCorner(cx: number, cy: number, u: number, v: number): [number, number] {
  return [cx + (u - v) * HALF_W, cy + (u + v - 1) * HALF_H];
}

function isoCell(
  cx: number,
  cy: number,
  u: number,
  v: number,
  step: number,
  inset: number,
): number[] {
  const near = inset * step;
  const far = step - near;
  return [
    ...isoCorner(cx, cy, u + near, v + near),
    ...isoCorner(cx, cy, u + far, v + near),
    ...isoCorner(cx, cy, u + far, v + far),
    ...isoCorner(cx, cy, u + near, v + far),
  ];
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
): void {
  ctx.fillStyle = css(0xc6ad81);
  ctx.fillRect(x, y, width, height);
  speckle(ctx, random, { x, y, width, height }, 220, [0xb59a6e, 0xd8c298, 0xa88f66], 2.2, 0.4);

  for (let stone = 0; stone < 26; stone++) {
    const [px, py] = isoCorner(cx, cy, random(), random());
    ctx.fillStyle = css(0xd6c39c, 0.6);
    ctx.beginPath();
    ctx.ellipse(px, py, 1.4 + random() * 1.8, 1 + random() * 1.2, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const offset of [-0.16, 0.16]) {
    ctx.strokeStyle = 'rgba(122, 100, 68, 0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(...(isoCorner(cx, cy, 0, 0.5 + offset) as [number, number]));
    ctx.lineTo(...(isoCorner(cx, cy, 1, 0.5 + offset) as [number, number]));
    ctx.stroke();
  }
}

function drawCobbles(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
): void {
  ctx.fillStyle = css(0x8b7c5e);
  ctx.fillRect(x, y, width, height);

  const rows = 6;
  const step = 1 / rows;
  for (let row = 0; row < rows; row++) {
    const shift = row % 2 === 0 ? 0 : step / 2;
    for (let column = -1; column <= rows; column++) {
      const u = column * step + shift + (random() - 0.5) * step * 0.16;
      const v = row * step + (random() - 0.5) * step * 0.16;
      const tone = 0.9 + random() * 0.22;

      polygonPath(ctx, isoCell(cx, cy, u, v, step, 0.14 + random() * 0.06));
      ctx.fillStyle = css(shade(0xcdb894, tone));
      ctx.fill();
    }
  }
  speckle(ctx, random, { x, y, width, height }, 90, [0xbda882, 0xdccbaa], 1.2, 0.3);
}

function drawSlabs(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
): void {
  ctx.fillStyle = css(0xb3a98c);
  ctx.fillRect(x, y, width, height);

  const rows = 2;
  const step = 1 / rows;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < rows; column++) {
      const tone = 0.96 + random() * 0.09;
      polygonPath(ctx, isoCell(cx, cy, column * step, row * step, step, 0.035));
      ctx.fillStyle = css(shade(0xe2dac2, tone));
      ctx.fill();

      for (let vein = 0; vein < 2; vein++) {
        const start = isoCorner(cx, cy, (column + random() * 0.8) * step, (row + random() * 0.2) * step);
        const end = isoCorner(cx, cy, (column + random() * 0.9) * step, (row + 0.6 + random() * 0.4) * step);
        ctx.strokeStyle = 'rgba(146, 136, 112, 0.28)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(start[0], start[1]);
        ctx.lineTo(end[0], end[1]);
        ctx.stroke();
      }
    }
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

function drawCliffBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  light: number,
  variant: number,
): void {
  const random = createRandom(variant * 331 + Math.round(light * 100) + 7);

  ctx.fillStyle = css(shade(0x8b7f66, light * 0.8));
  ctx.fillRect(x, y, width, height);

  for (const row of [0.92, 0.5]) {
    let stoneX = x - 12;
    while (stoneX < x + width + 10) {
      const big = random() < 0.45;
      const halfWidth = big ? 11 + random() * 7 : 5 + random() * 4;
      const rise = height * (big ? 0.62 + random() * 0.34 : 0.34 + random() * 0.26);
      const baseY = y + height * row + (random() - 0.5) * 8;
      drawRock(ctx, random, stoneX + halfWidth, baseY, halfWidth, rise, light * (0.92 + random() * 0.16));
      if (random() < 0.22) tuft(ctx, random, stoneX + halfWidth, baseY + 1, light);
      stoneX += halfWidth * (0.95 + random() * 0.5);
    }
  }

  const occlusion = ctx.createLinearGradient(0, y, 0, y + height);
  occlusion.addColorStop(0, 'rgba(66, 55, 36, 0.16)');
  occlusion.addColorStop(0.4, 'rgba(0,0,0,0)');
  occlusion.addColorStop(1, 'rgba(66, 55, 36, 0.14)');
  ctx.fillStyle = occlusion;
  ctx.fillRect(x, y, width, height);
}

function drawCliffRim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  light: number,
  variant: number,
): void {
  const random = createRandom(variant * 617 + Math.round(light * 100));
  const ground = y + height - 8;

  let stoneX = x - 6;
  while (stoneX < x + width + 4) {
    const big = random() < 0.45;
    const halfWidth = big ? 9 + random() * 6 : 4 + random() * 3;
    const rise = halfWidth * (0.6 + random() * 0.4);
    const centreX = stoneX + halfWidth;
    const baseY = ground + (random() - 0.5) * 5;

    drawRock(ctx, random, centreX, baseY, halfWidth, rise, light * (0.92 + random() * 0.16));
    if (random() < 0.35) tuft(ctx, random, centreX + halfWidth * 0.6, baseY + 2, light);
    stoneX += halfWidth * (1.0 + random() * 0.5);
  }
}

function drawRock(
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

  const corners = 6;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < corners; i++) {
    const angle = Math.PI + (i / (corners - 1)) * Math.PI;
    const wobble = 0.78 + random() * 0.26;
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

  ctx.strokeStyle = css(dark, 0.45);
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

function tuft(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  cx: number,
  baseY: number,
  light: number,
): void {
  ctx.strokeStyle = css(shade(0x7d8b4a, light), 0.8);
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 3; i++) {
    const lean = (random() - 0.5) * 5;
    ctx.beginPath();
    ctx.moveTo(cx + lean * 0.3, baseY);
    ctx.quadraticCurveTo(cx + lean, baseY - 4, cx + lean * 1.6, baseY - 7 - random() * 3);
    ctx.stroke();
  }
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
