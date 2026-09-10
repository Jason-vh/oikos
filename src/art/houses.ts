import * as T from 'three';
import { bake, box, colors, group, lump, pot, post, roof } from './primitives';
import { assemblyPart, modelAssembly, shellWalls, type ModelAssembly } from './assembly';

function windowFrame(parent: T.Object3D, x: number, y: number, z: number): void {
  box(parent, colors.cream, x, y, z, .69, .79, .13);
  box(parent, colors.dark, x, y, z + .08, .43, .56, .06);
  for (const side of [-1, 1]) box(parent, colors.blue, x + side * .27, y, z + .14, .2, .6, .09);
  box(parent, colors.stone, x, y - .4, z + .13, .82, .13, .23);
}

const DWELLING_WIDTH = 1.7;
const DWELLING_DEPTH = 1.65;
const DWELLING_HEIGHT = 1.35;
const WALL_THICKNESS = .2;
const SHELL_DELAYS = [.08, .19, .3, .41];

function dwellingPlinth(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .09, 0, 2.15, .18, 2.1);
}

function dwellingWalls(parent: T.Object3D): void {
  box(parent, colors.plaster, 0, DWELLING_HEIGHT / 2 + .18, 0, DWELLING_WIDTH, DWELLING_HEIGHT, DWELLING_DEPTH, .06);
}

function dwellingWall(parent: T.Object3D, x: number, z: number, width: number, depth: number): void {
  box(parent, colors.plaster, x, DWELLING_HEIGHT / 2 + .18, z, width, DWELLING_HEIGHT, depth, .06);
}

function dwellingCornice(parent: T.Object3D): void {
  box(parent, colors.cream, 0, DWELLING_HEIGHT + .13, 0, DWELLING_WIDTH + .12, .16, DWELLING_DEPTH + .12);
}

function dwellingRoof(parent: T.Object3D): void {
  roof(parent, DWELLING_WIDTH + .45, DWELLING_DEPTH + .5, DWELLING_HEIGHT + .19, .55);
}

function dwellingDoor(parent: T.Object3D): void {
  box(parent, colors.cream, -.32, .62, DWELLING_DEPTH / 2 + .01, .62, 1.06, .12);
  box(parent, colors.wood, -.32, .59, DWELLING_DEPTH / 2 + .09, .44, .96, .07);
}

function dwellingShutters(parent: T.Object3D): void {
  windowFrame(parent, .5, .95, DWELLING_DEPTH / 2 + .01);
}

function dwellingPot(parent: T.Object3D): void {
  pot(parent, .78, .18, DWELLING_DEPTH / 2 + .3, .62);
}

export function dwellingPieces(): ModelAssembly {
  const assembly = modelAssembly();
  dwellingPlinth(assemblyPart(assembly, { name: 'foundation', at: 0, lift: 0, dust: true }));
  shellWalls(DWELLING_WIDTH, DWELLING_DEPTH, WALL_THICKNESS).forEach((wall, index) => {
    const part = assemblyPart(assembly, { name: wall.name, at: SHELL_DELAYS[index], dust: true });
    dwellingWall(part, wall.x, wall.z, wall.width, wall.depth);
  });
  dwellingCornice(assemblyPart(assembly, { name: 'cornice', at: .58, lift: .2 }));
  dwellingRoof(assemblyPart(assembly, { name: 'roof', at: .72, lift: .4, duration: .34, dust: true }));
  dwellingDoor(assemblyPart(assembly, { name: 'door', at: .93, lift: .12, duration: .22 }));
  dwellingShutters(assemblyPart(assembly, { name: 'shutters', at: 1.02, lift: .12, duration: .22 }));
  dwellingPot(assemblyPart(assembly, { name: 'pot', at: 1.13, lift: .16, duration: .22 }));
  return assembly;
}

export function dwelling(tier: 1 | 2 | 3): T.Group {
  const home = new T.Group();
  if (tier === 1) {
    dwellingPlinth(home);
    dwellingWalls(home);
    dwellingCornice(home);
    dwellingRoof(home);
    dwellingDoor(home);
    dwellingShutters(home);
    dwellingPot(home);
    return home;
  }
  if (tier === 2) {
    const width = 2.15, depth = 2.05, height = 1.7;
    box(home, colors.stone, 0, .11, 0, 2.6, .22, 2.5);
    box(home, colors.plaster, 0, height / 2 + .2, 0, width, height, depth, .06);
    box(home, colors.cream, 0, height + .15, 0, width + .13, .18, depth + .13);
    roof(home, width + .5, depth + .55, height + .21, .68);
    box(home, colors.cream, -.4, .72, depth / 2 + .01, .78, 1.3, .13);
    box(home, colors.wood, -.4, .68, depth / 2 + .1, .56, 1.18, .07);
    box(home, colors.gold, -.2, .68, depth / 2 + .15, .05, .05, .035);
    windowFrame(home, .62, 1.12, depth / 2 + .01);
    for (const [sx, sz, angle] of [[width / 2 + .01, -.15, Math.PI / 2], [-width / 2 - .01, .15, -Math.PI / 2]]) {
      const side = group(home, sx, 0, sz, angle);
      windowFrame(side, 0, 1.05, 0);
    }
    for (let stripe = 0; stripe < 4; stripe++) {
      const cloth = box(home, stripe % 2 ? colors.linen : colors.blue, -.55 + stripe * .28, height + .55, depth / 2 + .3, .28, .05, .58, .02);
      cloth.rotation.x = .15;
    }
    for (const px of [-.68, .5]) box(home, colors.wood, px, height / 2 + .3, depth / 2 + .56, .08, height + .55, .08);
    pot(home, .95, .18, depth / 2 + .35, .7);
    return home;
  }
  const width = 2.35, depth = 2.2, height = 2.85;
  box(home, colors.stone, 0, .12, 0, 2.85, .24, 2.7);
  box(home, 0xe2cfa7, 0, height / 2 + .22, 0, width, height, depth, .07);
  box(home, colors.cream, 0, height + .16, 0, width + .14, .2, depth + .14);
  roof(home, width + .5, depth + .55, height + .23, .78);
  windowFrame(home, .68, 1.1, depth / 2 + .01);
  windowFrame(home, -.6, 2.35, depth / 2 + .01);
  windowFrame(home, .68, 2.35, depth / 2 + .01);
  box(home, colors.blue, 0, 1.72, depth / 2 + .11, width + .04, .1, .16);
  box(home, colors.cream, -.36, .58, depth / 2 + .01, .74, 1.1, .12);
  box(home, colors.wood, -.36, .54, depth / 2 + .09, .52, .98, .07);
  for (const [sx, sz, angle] of [[width / 2 + .01, -.15, Math.PI / 2], [-width / 2 - .01, .15, -Math.PI / 2]]) {
    const side = group(home, sx, 0, sz, angle);
    windowFrame(side, 0, 1.1, 0);
    windowFrame(side, 0, 2.35, 0);
  }
  const yardDepth = .55;
  const yardZ = -(depth / 2 + yardDepth / 2);
  box(home, colors.paving, 0, .09, yardZ, width - .1, .18, yardDepth);
  box(home, colors.plaster, -(width - .1) / 2, .34, yardZ, .1, .5, yardDepth);
  box(home, colors.plaster, (width - .1) / 2, .34, yardZ, .1, .5, yardDepth);
  box(home, colors.plaster, 0, .34, yardZ - yardDepth / 2 - .05, width - .1, .5, .1);
  pot(home, width / 2 - .3, .18, yardZ + yardDepth / 2 - .1, .55);
  pot(home, 1.02, .2, depth / 2 + .32, .75);
  return home;
}

function basket(parent: T.Object3D, x: number, z: number, full: boolean): void {
  box(parent, colors.wood, x, .12, z, .32, .2, .3, .05);
  box(parent, colors.wood, x, .23, z, .36, .04, .34, .02);
  if (!full) return;
  for (const [dx, dz] of [[-.07, -.04], [.08, -.02], [0, .06]]) {
    post(parent, colors.linen, x + dx, .2, z + dz, .05, .2);
    lump(parent, colors.gold, x + dx, .33, z + dz, .09, .08, .09);
  }
}

const SUPPLIES_LAYOUT: Record<1 | 2 | 3, { depth: number; basketX: number; jarX: number; frontGap: number }> = {
  1: { depth: 1.65, basketX: .05, jarX: .38, frontGap: .28 },
  2: { depth: 2.05, basketX: .15, jarX: .5, frontGap: .32 },
  3: { depth: 2.2, basketX: .15, jarX: .5, frontGap: .28 },
};

export function houseSupplies(tier: 1 | 2 | 3, hasFood: boolean, hasWater: boolean): T.Group {
  const supplies = new T.Group();
  const { depth, basketX, jarX, frontGap } = SUPPLIES_LAYOUT[tier];
  const z = depth / 2 + frontGap;
  basket(supplies, basketX, z, hasFood);
  pot(supplies, jarX, 0, z, hasWater ? .5 : .32, hasWater ? colors.blueLight : colors.stone);
  bake(supplies);
  return supplies;
}
