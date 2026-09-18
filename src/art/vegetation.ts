import * as T from 'three';
import { box, colors, group, lump, post, roof } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';

const FLARE_RADIUS = .175;
const FLARE_HEIGHT = .3;

function rootedTrunk(plant: T.Object3D): void {
  post(plant, colors.wood, 0, FLARE_HEIGHT / 2, 0, FLARE_RADIUS, FLARE_HEIGHT);
  post(plant, colors.wood, 0, .84, 0, .115, 1.24);
}

export function tree(parent: T.Object3D, x: number, y: number, z: number, scale = 1, cypress = false): void {
  const plant = group(parent, x, y, z, x * 5 + z);
  plant.scale.setScalar(scale);
  rootedTrunk(plant);
  if (cypress) {
    lump(plant, colors.oliveDark, 0, 1.6, 0, .53, 1.32, .53).rotation.set(0, .4, .05);
    lump(plant, colors.olive, .06, 2.46, -.03, .39, .86, .4).rotation.set(0, 1.3, -.06);
    lump(plant, colors.oliveLight, -.03, 3.08, .04, .25, .49, .26).rotation.set(0, .7, .08);
    return;
  }
  const bough = post(plant, colors.wood, .24, 1.42, .02, .075, .82);
  bough.rotation.set(.1, 0, -.62);
  const limb = post(plant, colors.wood, -.2, 1.66, -.05, .058, .56);
  limb.rotation.set(-.14, 0, .68);
  lump(plant, colors.oliveDark, -.4, 1.83, .04, .83, .65, .72).rotation.set(.3, .5, .18);
  lump(plant, colors.olive, .38, 2.08, .12, .91, .72, .83).rotation.set(-.2, 1.1, -.34);
  lump(plant, colors.oliveLight, -.05, 2.35, -.27, .75, .61, .76).rotation.set(.44, 2, .1);
}

export type Litter = 'bare' | 'chips' | 'logged';

export function litterFor(roll: number, log = true): Litter {
  if (roll > .78) return log ? 'logged' : 'chips';
  if (roll > .42) return 'chips';
  return 'bare';
}

export function stump(parent: T.Object3D, x: number, y: number, z: number, scale = 1, lie = 0, litter: Litter = 'bare'): void {
  const remains = group(parent, x, y, z, lie);
  remains.scale.setScalar(scale);
  post(remains, colors.wood, 0, FLARE_HEIGHT / 2, 0, FLARE_RADIUS, FLARE_HEIGHT);
  post(remains, colors.stone, 0, FLARE_HEIGHT + .02, 0, .15, .05).rotation.z = .12;
  if (litter === 'bare') return;
  lump(remains, colors.stone, -.29, .04, -.23, .09, .05, .1).rotation.y = .8;
  if (litter !== 'logged') return;
  const log = post(remains, colors.wood, .46, .1, .21, .095, .62);
  log.rotation.set(0, .55, Math.PI / 2);
}

interface FarmStyle {
  shed: 'left' | 'right';
  furrows: 'across' | 'along';
}

const FARM_STYLES: FarmStyle[] = [
  { shed: 'left', furrows: 'across' },
  { shed: 'right', furrows: 'across' },
  { shed: 'left', furrows: 'along' },
];

export const FARM_VARIANTS = FARM_STYLES.length;

function farmStyle(variant: number): FarmStyle {
  return FARM_STYLES[variant % FARM_VARIANTS];
}

function sideOf(style: FarmStyle): number {
  return style.shed === 'left' ? 1 : -1;
}

const SOIL = 0xd9c98a;
const EARS = 0xe6c463;
const CROP_HEIGHTS = [0, .12, .22, .26];
const CROP_COLORS = [colors.oliveLight, colors.oliveLight, 0xc9bd6a, colors.gold];

function farmShed(parent: T.Object3D, side: number): void {
  const shed = group(parent, side * -1.35, 0, -1.55);
  box(shed, colors.stone, 0, .08, 0, 1.55, .16, 1.3);
  box(shed, colors.plaster, 0, .5, 0, 1.25, .74, 1.05, .06);
  roof(shed, 1.4, 1.2, .87, .32, colors.roofDark);
  box(shed, colors.wood, 0, .42, .53, .55, .68, .08);
  post(shed, colors.wood, -.55, .48, .62, .035, .96);
  post(shed, colors.wood, .55, .48, .62, .035, .96);
  box(shed, colors.dark, 0, .9, .62, 1.15, .05, .05);
}

function farmGround(parent: T.Object3D, side: number): void {
  box(parent, colors.earth, side * .35, .05, .3, 4.1, .1, 3.9, .02);
}

function furrowAcross(parent: T.Object3D, stage: number, side: number, ridge: number, near: boolean): void {
  const height = CROP_HEIGHTS[stage];
  const width = near ? 2.35 : 4;
  const x = side * (near ? 1.15 : .35);
  box(parent, SOIL, x, .15, ridge, width, .12, .22, .02);
  if (stage === 0) return;
  box(parent, CROP_COLORS[stage], x, .21 + height / 2, ridge, width - .08, height, .18, .03);
  if (stage === 3) box(parent, EARS, x, .5, ridge, width - .12, .09, .12, .02);
}

function furrowAlong(parent: T.Object3D, stage: number, side: number, ridge: number, near: boolean): void {
  const height = CROP_HEIGHTS[stage];
  const depth = near ? 2.3 : 3.7;
  const x = side * ridge;
  const z = near ? .95 : .25;
  box(parent, SOIL, x, .15, z, .22, .12, depth, .02);
  if (stage === 0) return;
  box(parent, CROP_COLORS[stage], x, .21 + height / 2, z, .18, height, depth - .08, .03);
  if (stage === 3) box(parent, EARS, x, .5, z, .12, .09, depth - .12, .02);
}

function farmRows(parent: T.Object3D, stage: number, style: FarmStyle): void {
  const side = sideOf(style);
  for (let row = 0; row < 7; row++) {
    const ridge = -1.35 + row * .55;
    const near = row < 3;
    if (style.furrows === 'across') furrowAcross(parent, stage, side, ridge, near);
    else furrowAlong(parent, stage, side, ridge, near);
  }
}

function farmFence(parent: T.Object3D, side: number): void {
  box(parent, colors.stone, side * .35, .12, 2.3, 4.1, .1, .12);
  for (const px of [-1.6, -.35, .9, 2.15]) post(parent, colors.wood, side * px, .27, 2.3, .035, .48);
  box(parent, colors.wood, side * .35, .44, 2.3, 4.05, .05, .05);
}

export function wheatFarm(stage = 3, variant = 0): T.Group {
  const style = farmStyle(variant);
  const side = sideOf(style);
  const plot = new T.Group();
  farmShed(plot, side);
  farmGround(plot, side);
  farmRows(plot, stage, style);
  farmFence(plot, side);
  return plot;
}

export function wheatFarmPieces(stage: number, variant = 0): ModelAssembly {
  const style = farmStyle(variant);
  const side = sideOf(style);
  const assembly = modelAssembly(false);
  farmGround(assemblyPart(assembly, { name: 'ground', at: 0, lift: 0, dust: true }), side);
  farmFence(assemblyPart(assembly, { name: 'fence', at: .16, lift: .2, duration: .26 }), side);
  farmShed(assemblyPart(assembly, { name: 'shed', at: .34, lift: .34, duration: .32, dust: true }), side);
  farmRows(assemblyPart(assembly, { name: 'furrows', at: .6, lift: .12, duration: .3 }), stage, style);
  return assembly;
}
