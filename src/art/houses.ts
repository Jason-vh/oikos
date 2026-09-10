import * as T from 'three';
import { bake, box, colors, group, lump, pot, post, roof } from './primitives';
import { assemblyPart, type ModelAssembly } from './assembly';

function windowFrame(parent: T.Object3D, x: number, y: number, z: number): void {
  box(parent, colors.cream, x, y, z, .69, .79, .13);
  box(parent, colors.dark, x, y, z + .08, .43, .56, .06);
  for (const side of [-1, 1]) box(parent, colors.blue, x + side * .27, y, z + .14, .2, .6, .09);
  box(parent, colors.stone, x, y - .4, z + .13, .82, .13, .23);
}

export function dwellingPieces(): ModelAssembly {
  const assembly: ModelAssembly = { model: new T.Group(), parts: [] };
  const width = 1.7, depth = 1.65, height = 1.35;
  const foundation = assemblyPart(assembly, 'foundation', 0, 0);
  box(foundation, colors.stone, 0, .09, 0, 2.15, .18, 2.1);
  const back = assemblyPart(assembly, 'back-wall', .08);
  box(back, colors.plaster, 0, height / 2 + .18, -(depth - .2) / 2, width, height, .2, .06);
  const left = assemblyPart(assembly, 'left-wall', .19);
  box(left, colors.plaster, -(width - .2) / 2, height / 2 + .18, 0, .2, height, depth - .4, .06);
  const right = assemblyPart(assembly, 'right-wall', .3);
  box(right, colors.plaster, (width - .2) / 2, height / 2 + .18, 0, .2, height, depth - .4, .06);
  const front = assemblyPart(assembly, 'front-wall', .41);
  box(front, colors.plaster, 0, height / 2 + .18, (depth - .2) / 2, width, height, .2, .06);
  const cornice = assemblyPart(assembly, 'cornice', .58, .2);
  box(cornice, colors.cream, 0, height + .13, 0, width + .12, .16, depth + .12);
  const covering = assemblyPart(assembly, 'roof', .72, .4, .34);
  roof(covering, width + .45, depth + .5, height + .19, .55);
  const door = assemblyPart(assembly, 'door', .93, .12, .22);
  box(door, colors.cream, -.32, .62, depth / 2 + .01, .62, 1.06, .12);
  box(door, colors.wood, -.32, .59, depth / 2 + .09, .44, .96, .07);
  const window = assemblyPart(assembly, 'shutters', 1.02, .12, .22);
  windowFrame(window, .5, .95, depth / 2 + .01);
  const pottery = assemblyPart(assembly, 'pot', 1.13, .16, .22);
  pot(pottery, .78, .18, depth / 2 + .3, .62);
  return assembly;
}

export function dwelling(tier: 1 | 2 | 3): T.Group {
  if (tier === 1) return dwellingPieces().model;
  const home = new T.Group();
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
