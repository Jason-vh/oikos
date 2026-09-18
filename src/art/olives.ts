import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, pot, roof } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';

const GROVE_ROWS: [number, number][] = [[-1.4, -1.35], [.2, -1.5], [1.6, -1.1], [-1.55, .25], [.05, .1], [1.5, .55], [-1.2, 1.6], [.5, 1.55]];

function groveGround(parent: T.Object3D): void {
  box(parent, colors.earth, 0, .05, 0, 4.6, .1, 4.6, .02);
  for (const x of [-1.5, 0, 1.5]) box(parent, 0xb9ad82, x, .11, 0, 1.1, .04, 4.4, .02);
}

const TRUNK_HEIGHT = .62;

function oliveTree(parent: T.Object3D, x: number, z: number, stage: number): void {
  const tree = group(parent, x, .1, z, x * 3 + z);
  post(tree, colors.wood, 0, TRUNK_HEIGHT / 2, 0, .11, TRUNK_HEIGHT);
  post(tree, colors.wood, 0, TRUNK_HEIGHT * .9, 0, .16, .12);
  const crown = [.5, .56, .62, .66][stage];
  lump(tree, colors.oliveDark, -.16, TRUNK_HEIGHT + crown * .5, .07, crown, crown * .82, crown).rotation.set(.2, .6, .1);
  lump(tree, colors.olive, .18, TRUNK_HEIGHT + crown * .74, -.09, crown * .88, crown * .72, crown * .86).rotation.set(-.2, 1.2, -.2);
  if (stage < 2) return;
  lump(tree, colors.oliveLight, .02, TRUNK_HEIGHT + crown, .06, crown * .5, crown * .44, crown * .5).rotation.set(.3, 2, .08);
  if (stage < 3) return;
  for (const [dx, dz] of [[-.22, .14], [.24, -.08], [.02, .2]]) lump(tree, 0x4a4b3a, dx, TRUNK_HEIGHT + crown * .62, dz, .075, .075, .075);
}

function groveTrees(parent: T.Object3D, stage: number): void {
  for (const [x, z] of GROVE_ROWS) oliveTree(parent, x, z, stage);
}

function groveYard(parent: T.Object3D, stage: number): void {
  const yard = group(parent, 1.5, 0, 1.8);
  box(yard, colors.paving, 0, .12, 0, 1.4, .18, 1.1);
  box(yard, colors.stone, 0, .34, -.42, 1.3, .32, .22, .05);
  if (stage < 2) return;
  for (const [dx, dz] of [[-.36, .18], [.3, .3]]) {
    box(yard, colors.wood, dx, .3, dz, .44, .28, .4, .04);
    if (stage === 3) for (const drop of [-.1, .08]) lump(yard, colors.oliveDark, dx + drop, .48, dz, .08, .07, .08);
  }
}

export function oliveOrchard(stage = 3): T.Group {
  const grove = new T.Group();
  groveGround(grove);
  groveTrees(grove, stage);
  groveYard(grove, stage);
  return grove;
}

export function oliveOrchardPieces(stage: number): ModelAssembly {
  const assembly = modelAssembly(false);
  groveGround(assemblyPart(assembly, { name: 'ground', at: 0, lift: 0, dust: true }));
  groveYard(assemblyPart(assembly, { name: 'yard', at: .2, lift: .3, duration: .3, dust: true }), stage);
  groveTrees(assemblyPart(assembly, { name: 'saplings', at: .5, lift: .18, duration: .34 }), stage);
  return assembly;
}

function pressYard(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .1, 0, 2.3, .2, 3.5);
  box(parent, colors.paving, 0, .2, .9, 2.14, .05, 1.6);
}

function pressHouse(parent: T.Object3D): void {
  const mill = group(parent, 0, .2, -1.05);
  box(mill, colors.plaster, 0, .42, 0, 2.05, .84, 1.3, .07);
  box(mill, colors.cream, 0, .9, 0, 2.15, .12, 1.4);
  roof(mill, 2.2, 1.5, .96, .26, colors.roofDark);
  box(mill, colors.dark, 0, .36, .67, .8, .72, .05);
  for (const x of [-.72, .72]) box(mill, colors.blue, x, .56, .67, .3, .32, .05);
}

function pressStone(parent: T.Object3D): void {
  const wheel = group(parent, 0, .25, .6);
  post(wheel, colors.stone, 0, .14, 0, .78, .24);
  post(wheel, colors.cream, 0, .29, 0, .66, .08);
  const roller = post(wheel, colors.stone, .3, .52, 0, .34, .18);
  roller.rotation.z = Math.PI / 2;
  post(wheel, colors.wood, 0, .62, 0, .07, .9);
  const beam = post(wheel, colors.wood, .12, .86, 0, .055, 1.5);
  beam.rotation.set(0, .5, Math.PI / 2);
  box(wheel, colors.wood, -.5, .5, .3, .5, .12, .12, .03);
}

export function pressJars(stores: Stores): number {
  return Math.min(3, Math.ceil((stores.oil ?? 0) / 40));
}

function oilJars(parent: T.Object3D, stores: Stores): void {
  const jars = pressJars(stores);
  const slots: [number, number][] = [[-.75, 1.42], [-.05, 1.55], [.68, 1.42]];
  slots.forEach(([x, z], index) => {
    if (index >= jars) return;
    pot(parent, x, .22, z, .78, colors.oliveDark);
  });
}

export function olivePress(stores: Stores): T.Group {
  const mill = new T.Group();
  pressYard(mill);
  pressHouse(mill);
  pressStone(mill);
  oilJars(mill, stores);
  return mill;
}

export function olivePressPieces(stores: Stores): ModelAssembly {
  const assembly = modelAssembly();
  pressYard(assemblyPart(assembly, { name: 'yard', at: 0, lift: 0, dust: true }));
  pressHouse(assemblyPart(assembly, { name: 'mill-house', at: .24, lift: .36, duration: .34, dust: true }));
  pressStone(assemblyPart(assembly, { name: 'press-stone', at: .62, lift: .3, duration: .3, dust: true }));
  oilJars(assemblyPart(assembly, { name: 'jars', at: .9, lift: .16, duration: .24 }), stores);
  return assembly;
}
