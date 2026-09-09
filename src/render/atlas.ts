import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { TERRAIN_GRASS, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from '../sim/grid';
import { createRandom } from '../sim/mapgen';
import { TEXTURE_SCALE, createSurface, css, diamondPath, polygonPath, shade } from './canvas';
import { GRAIN_CELL, type Ramp, type Tuft, fbm, fillGrain, scatterTufts } from './grain';
import { TILE_HEIGHT, TILE_WIDTH } from './iso';

export type BlendDirection = 'east' | 'south' | 'west' | 'north';

export const TERRAIN_VARIANTS = 12;
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
  ramp: Ramp;
  tufts: Tuft[];
}

const SCRUB_RAMP: Ramp = {
  colours: [0xb39a42, 0xbfa44a, 0xcab054, 0xd2b85b, 0xdac266, 0xe2cc74],
  scale: 5,
  jitter: 0.35,
};

const SCRUB_TUFTS: Tuft = { colours: [0x8a8434, 0x9a9440, 0x7d7a2e], density: 0.05, height: 2 };

const TERRAIN_PALETTES: Record<number, TerrainPalette> = {
  [TERRAIN_GRASS]: { ramp: SCRUB_RAMP, tufts: [SCRUB_TUFTS] },
  [TERRAIN_MEADOW]: {
    ramp: {
      colours: [0x2a340c, 0x3a4412, 0x4b541a, 0x5d641f, 0x6c7626, 0x7e8a2e, 0x97a33a],
      scale: 4.5,
      jitter: 0.45,
    },
    tufts: [
      { colours: [0x93a038, 0xa3b044, 0x2a330c, 0x1f2708], density: 0.12, height: 3 },
      { colours: [0xb08ac0, 0xc9a6d6], density: 0.012, height: 1 },
    ],
  },
  [TERRAIN_ROCK]: { ramp: SCRUB_RAMP, tufts: [] },
  [TERRAIN_SAND]: {
    ramp: {
      colours: [0xc9b97e, 0xd6c88c, 0xe1d49a, 0xe9dda6, 0xf0e6b6, 0xf6eec6],
      scale: 3.6,
      jitter: 0.45,
    },
    tufts: [],
  },
};

const WATER_RAMP: Ramp = { colours: [0x155660, 0x185c68, 0x1b616d, 0x1e6672, 0x216b76], scale: 6, jitter: 0.25 };
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
  const seed = kind * 1000 + variant * 31;
  const cx = x + width / 2;
  const cy = y + height / 2;

  ctx.save();
  diamondPath(ctx, cx, cy, HALF_W, HALF_H);
  ctx.clip();

  fillGrain(ctx, x, y, width, height, palette.ramp, seed);
  const sparseness = 0.35 + random() * 0.65;
  for (const tuft of palette.tufts) {
    scatterTufts(ctx, x, y, width, height, { ...tuft, density: tuft.density * sparseness }, seed);
  }
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
  drawFlagstones(ctx, random, x, y, width, height, cx, cy, 0xc8b06a, 0xdfcd97, 0.7);
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
  drawFlagstones(ctx, random, x, y, width, height, cx, cy, 0xd6c48a, 0xf0e4c0, 0.85);
}

function drawFlagstones(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
  mortar: number,
  stone: number,
  cover: number,
): void {
  fillGrain(ctx, x, y, width, height, { colours: [shade(mortar, 0.9), mortar, shade(mortar, 1.08)], scale: 4, jitter: 0.4 }, 4242);

  const cells = 7;
  const step = 1 / cells;
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      if (random() > cover) continue;
      const u = column * step + (random() - 0.5) * step * 0.4;
      const v = row * step + (random() - 0.5) * step * 0.4;
      const tone = 0.9 + random() * 0.2;
      polygonPath(ctx, isoCell(cx, cy, u, v, step * (0.9 + random() * 0.5), 0.12));
      ctx.fillStyle = css(shade(stone, tone));
      ctx.fill();
    }
  }
  const fringe = ctx.createLinearGradient(0, cy - HALF_H, 0, cy + HALF_H);
  fringe.addColorStop(0, css(0xc9ab4c, 0.35));
  fringe.addColorStop(0.5, css(0xc9ab4c, 0));
  fringe.addColorStop(1, css(0xc9ab4c, 0.35));
  ctx.fillStyle = fringe;
  ctx.fillRect(x, y, width, height);
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
  ctx.fillStyle = css(0xc9bd96);
  ctx.fillRect(x, y, width, height);

  const rows = 2;
  const step = 1 / rows;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < rows; column++) {
      const tone = 0.96 + random() * 0.07;
      polygonPath(ctx, isoCell(cx, cy, column * step, row * step, step, 0.035));
      ctx.fillStyle = css(shade(0xf1e8c8, tone));
      ctx.fill();

      for (let vein = 0; vein < 2; vein++) {
        const start = isoCorner(cx, cy, (column + random() * 0.8) * step, (row + random() * 0.2) * step);
        const end = isoCorner(cx, cy, (column + random() * 0.9) * step, (row + 0.6 + random() * 0.4) * step);
        ctx.strokeStyle = 'rgba(170, 156, 120, 0.3)';
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

  fillGrain(ctx, x, y, width, height, WATER_RAMP, 500 + frame);

  ctx.lineWidth = 2;
  for (let band = 0; band < 4; band++) {
    ctx.strokeStyle = `rgba(48, 120, 130, ${0.12 + 0.1 * Math.sin(phase + band * 1.7)})`;
    ctx.beginPath();
    for (let px = 0; px <= width; px += 4) {
      const py = y + 8 + band * 13 + Math.sin(phase + px * 0.11 + band * 2) * 2.5;
      if (px === 0) ctx.moveTo(x + px, Math.round(py / 2) * 2);
      else ctx.lineTo(x + px, Math.round(py / 2) * 2);
    }
    ctx.stroke();
  }
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

  const shallows = ctx.createLinearGradient(edgeMid.x, edgeMid.y, cx + ex * 0.2, cy + ey * 0.2);
  shallows.addColorStop(0, 'rgba(225, 212, 154, 0.9)');
  shallows.addColorStop(0.4, 'rgba(190, 195, 150, 0.45)');
  shallows.addColorStop(1, 'rgba(120, 165, 150, 0)');
  ctx.fillStyle = shallows;
  ctx.fillRect(x, y, width, height);

  ctx.lineWidth = 1.4;
  for (let line = 0; line < 2; line++) {
    const inset = 3 + line * 4.5;
    ctx.strokeStyle = `rgba(232, 226, 190, ${line === 0 ? 0.35 : 0.18})`;
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
  const normalLength = Math.hypot(ex, ey);
  const seed = 900 + DIRECTIONS.indexOf(direction);

  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  for (let py = y; py < y + height; py += GRAIN_CELL) {
    for (let px = x; px < x + width; px += GRAIN_CELL) {
      const along = ((px + 1 - cx) * ex + (py + 1 - cy) * ey) / (normalLength * normalLength);
      const depth = 1 - along;
      const ragged = fbm(px / 9, py / 4.5, seed) * 1.1 - 0.2;
      if (depth * 0.85 < ragged) ctx.fillRect(px, py, GRAIN_CELL, GRAIN_CELL);
    }
  }
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
  const lit = shade(0xf2e8cc, light);
  const mid = shade(0xcfc4a4, light);
  const dark = shade(0x807560, light * 0.8);

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
