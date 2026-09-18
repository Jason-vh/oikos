import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, pot, roof } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';

const TRUNK_HEIGHT = .62;

function oliveTree(parent: T.Object3D, x: number, z: number, stage: number, scale = 1): void {
  const tree = group(parent, x, .1, z, x * 3 + z);
  tree.scale.setScalar(scale);
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

export function oliveSapling(stage: number, seed = 0): T.Group {
  const plant = new T.Group();
  oliveTree(plant, 0, 0, stage, .52 + stage * .13);
  plant.rotation.y = (seed % 4) * Math.PI / 2;
  return plant;
}

function groveGround(parent: T.Object3D): void {
  box(parent, colors.earth, 0, .05, 0, 3.5, .1, 3.5, .02);
  box(parent, colors.paving, 0, .11, .5, 2.3, .04, 2, .02);
}

function groveHut(parent: T.Object3D): void {
  const hut = group(parent, -.95, 0, -1.05);
  box(hut, colors.stone, 0, .08, 0, 1.5, .16, 1.25);
  box(hut, colors.plaster, 0, .5, 0, 1.2, .74, 1, .06);
  roof(hut, 1.35, 1.15, .87, .3, colors.roofDark);
  box(hut, colors.dark, 0, .4, .52, .46, .64, .05);
  box(hut, colors.blue, .42, .56, .52, .3, .3, .05);
}

function groveYard(parent: T.Object3D, stage: number): void {
  const yard = group(parent, .95, 0, -.85);
  box(yard, colors.paving, 0, .14, 0, 1.5, .2, 1.3);
  box(yard, colors.stone, 0, .38, -.5, 1.4, .34, .24, .05);
  if (stage < 1) return;
  for (const [dx, dz] of [[-.36, .22], [.34, .34]]) {
    box(yard, colors.wood, dx, .34, dz, .46, .3, .42, .04);
    if (stage >= 2) for (const drop of [-.1, .08]) lump(yard, colors.oliveDark, dx + drop, .53, dz, .08, .07, .08);
  }
  if (stage < 3) return;
  for (const [dx, dz] of [[-.5, -.1], [.5, -.05]]) pot(yard, dx, .24, dz, .7, colors.oliveDark);
}

function groveTrees(parent: T.Object3D, stage: number): void {
  for (const [x, z] of [[-1.1, 1.1], [.55, 1.15]] as [number, number][]) oliveTree(parent, x, z, stage, .78);
}

export function oliveOrchard(stage = 3): T.Group {
  const grove = new T.Group();
  groveGround(grove);
  groveHut(grove);
  groveYard(grove, stage);
  groveTrees(grove, stage);
  return grove;
}

export function oliveOrchardPieces(stage: number): ModelAssembly {
  const assembly = modelAssembly(false);
  groveGround(assemblyPart(assembly, { name: 'ground', at: 0, lift: 0, dust: true }));
  groveHut(assemblyPart(assembly, { name: 'hut', at: .24, lift: .34, duration: .32, dust: true }));
  groveYard(assemblyPart(assembly, { name: 'yard', at: .54, lift: .3, duration: .3, dust: true }), stage);
  groveTrees(assemblyPart(assembly, { name: 'saplings', at: .78, lift: .18, duration: .3 }), stage);
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
