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
  stack: 'front' | 'back';
}

const FARM_STYLES: FarmStyle[] = [
  { shed: 'left', stack: 'front' },
  { shed: 'right', stack: 'front' },
  { shed: 'left', stack: 'back' },
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

function farmYard(parent: T.Object3D): void {
  box(parent, colors.earth, 0, .05, 0, 3.5, .1, 3.5, .02);
  box(parent, colors.paving, 0, .11, .55, 2.1, .04, 1.9, .02);
}

function farmShed(parent: T.Object3D, side: number): void {
  const shed = group(parent, side * -.95, 0, -1.05);
  box(shed, colors.stone, 0, .08, 0, 1.5, .16, 1.25);
  box(shed, colors.plaster, 0, .5, 0, 1.2, .74, 1, .06);
  roof(shed, 1.35, 1.15, .87, .3, colors.roofDark);
  box(shed, colors.wood, 0, .42, .5, .52, .68, .08);
  post(shed, colors.wood, -.52, .48, .58, .035, .96);
  post(shed, colors.wood, .52, .48, .58, .035, .96);
  box(shed, colors.dark, 0, .88, .58, 1.1, .05, .05);
}

function threshingFloor(parent: T.Object3D, side: number): void {
  const floor = group(parent, side * .95, 0, -.95);
  post(floor, colors.stone, 0, .12, 0, .78, .1);
  post(floor, colors.cream, 0, .19, 0, .6, .05);
  const flail = post(floor, colors.wood, .3, .42, .18, .04, .74);
  flail.rotation.set(.2, 0, .5);
}

function haystack(parent: T.Object3D, style: FarmStyle, stage: number): void {
  const side = sideOf(style);
  const stack = group(parent, side * -1.02, .1, style.stack === 'front' ? 1.05 : .2);
  post(stack, 0xd9c48f, 0, .26, 0, .42, .52);
  lump(stack, colors.gold, 0, .58, 0, .46, .26, .46);
  if (stage < 2) return;
  for (const [dx, dz] of [[side * .58, .18], [side * .46, -.42]]) {
    box(stack, colors.linen, dx, .2, dz, .34, .4, .3, .06);
    if (stage === 3) lump(stack, colors.gold, dx, .42, dz, .16, .09, .15);
  }
}

function farmCart(parent: T.Object3D, side: number, stage: number): void {
  const cart = group(parent, side * .85, .1, .95, side * .3);
  box(cart, colors.wood, 0, .34, 0, 1.1, .28, .66, .05);
  for (const px of [-.34, .34]) {
    const wheel = post(cart, colors.wood, px, .2, -.02, .2, .09);
    wheel.rotation.z = Math.PI / 2;
  }
  post(cart, colors.wood, 0, .3, .46, .04, .56).rotation.x = Math.PI / 2.4;
  if (stage >= 1) lump(cart, colors.gold, 0, .56, 0, .42, .14, .26);
}

function farmFence(parent: T.Object3D, side: number): void {
  box(parent, colors.stone, 0, .12, 1.72, 3.5, .1, .12);
  for (const px of [-1.5, -.5, .5, 1.5]) post(parent, colors.wood, side * px, .27, 1.72, .035, .48);
  box(parent, colors.wood, 0, .44, 1.72, 3.45, .05, .05);
}

export function wheatFarm(stage = 3, variant = 0): T.Group {
  const style = farmStyle(variant);
  const side = sideOf(style);
  const yard = new T.Group();
  farmYard(yard);
  farmShed(yard, side);
  threshingFloor(yard, side);
  haystack(yard, style, stage);
  farmCart(yard, side, stage);
  farmFence(yard, side);
  return yard;
}

export function wheatFarmPieces(stage: number, variant = 0): ModelAssembly {
  const style = farmStyle(variant);
  const side = sideOf(style);
  const assembly = modelAssembly(false);
  farmYard(assemblyPart(assembly, { name: 'yard', at: 0, lift: 0, dust: true }));
  farmFence(assemblyPart(assembly, { name: 'fence', at: .16, lift: .2, duration: .26 }), side);
  farmShed(assemblyPart(assembly, { name: 'shed', at: .34, lift: .34, duration: .32, dust: true }), side);
  threshingFloor(assemblyPart(assembly, { name: 'threshing floor', at: .58, lift: .18, duration: .24, dust: true }), side);
  haystack(assemblyPart(assembly, { name: 'stack', at: .74, lift: .22, duration: .26 }), style, stage);
  farmCart(assemblyPart(assembly, { name: 'cart', at: .88, lift: .2, duration: .22 }), side, stage);
  return assembly;
}

export function wheatRows(stage: number, seed = 0): T.Group {
  const field = new T.Group();
  box(field, colors.earth, 0, .03, 0, 1.18, .06, 1.18, .02);
  const height = CROP_HEIGHTS[stage];
  for (let row = 0; row < 3; row++) {
    const ridge = -.36 + row * .36;
    box(field, SOIL, 0, .08, ridge, 1.06, .06, .18, .02);
    if (stage === 0) continue;
    box(field, CROP_COLORS[stage], 0, .11 + height / 2, ridge, .98, height, .15, .03);
    if (stage === 3) box(field, EARS, 0, .26, ridge, .92, .07, .1, .02);
  }
  field.rotation.y = seed % 2 === 0 ? 0 : Math.PI / 2;
  return field;
}
