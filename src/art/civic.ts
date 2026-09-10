import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, pot, roof } from './primitives';
import { assemblyPart, modelAssembly, shellWalls, type ModelAssembly } from './assembly';
import { bundle, bundlesOf } from './food';

const HIDE = 0x5c4433;

function fountainKerb(parent: T.Object3D): void {
  post(parent, colors.stone, 0, .14, 0, 1.05, .28);
}

function fountainBasin(parent: T.Object3D): void {
  post(parent, colors.cream, 0, .36, 0, .9, .28);
}

function fountainColumn(parent: T.Object3D): void {
  post(parent, colors.plaster, 0, .96, 0, .19, .95);
}

function fountainCapital(parent: T.Object3D): void {
  post(parent, colors.cream, 0, 1.42, 0, .48, .13);
  lump(parent, colors.gold, 0, 1.72, 0, .16, .25, .16);
}

function fountainWater(parent: T.Object3D): void {
  post(parent, 0x77b9b0, 0, .51, 0, .73, .04);
  post(parent, 0x99d1c6, 0, 1.5, 0, .38, .04);
}

export function fountain(): T.Group {
  const basin = new T.Group();
  fountainKerb(basin);
  fountainBasin(basin);
  fountainWater(basin);
  fountainColumn(basin);
  fountainCapital(basin);
  return basin;
}

export function fountainPieces(): ModelAssembly {
  const assembly = modelAssembly();
  fountainKerb(assemblyPart(assembly, { name: 'kerb', at: 0, lift: 0, dust: true }));
  fountainBasin(assemblyPart(assembly, { name: 'basin', at: .14, dust: true }));
  fountainColumn(assemblyPart(assembly, { name: 'column', at: .34, lift: .35, dust: true }));
  fountainCapital(assemblyPart(assembly, { name: 'capital', at: .54, lift: .3 }));
  fountainWater(assemblyPart(assembly, { name: 'water', at: .78, lift: .1, duration: .3 }));
  return assembly;
}

const SHED_WIDTH = 1.5;
const SHED_DEPTH = 1.35;
const SHED_HEIGHT = .9;

function maintenancePlinth(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .09, 0, 1.9, .18, 1.7);
}

function maintenanceBody(parent: T.Object3D): void {
  box(parent, colors.plaster, 0, .68, 0, SHED_WIDTH, SHED_HEIGHT, SHED_DEPTH, .06);
}

function maintenanceCornice(parent: T.Object3D): void {
  box(parent, colors.cream, 0, 1.16, 0, 1.62, .14, 1.47);
}

function maintenanceRoof(parent: T.Object3D): void {
  roof(parent, 1.75, 1.6, 1.23, .38, colors.roofDark);
}

function maintenanceBench(parent: T.Object3D): void {
  box(parent, colors.wood, 0, .5, .68, 1.3, .8, .1);
  box(parent, colors.wood, -.5, .48, .84, .5, .14, .32);
}

function maintenanceTools(parent: T.Object3D): void {
  post(parent, colors.wood, .55, .78, .82, .03, .9);
  post(parent, colors.wood, .78, .78, .82, .03, .9);
  box(parent, colors.dark, .665, 1.14, .82, .35, .045, .045);
  for (let i = 0; i < 3; i++) lump(parent, i % 2 ? colors.blue : colors.roof, .55 + i * .11, .98, .82, .06, .1, .04);
  pot(parent, -.75, .18, -.55, .55);
  pot(parent, .75, .18, -.55, .5, colors.wood);
}

export function maintenance(): T.Group {
  const shed = new T.Group();
  maintenancePlinth(shed);
  maintenanceBody(shed);
  maintenanceCornice(shed);
  maintenanceRoof(shed);
  maintenanceBench(shed);
  maintenanceTools(shed);
  return shed;
}

export function maintenancePieces(): ModelAssembly {
  const assembly = modelAssembly();
  maintenancePlinth(assemblyPart(assembly, { name: 'foundation', at: 0, lift: 0, dust: true }));
  shellWalls(SHED_WIDTH, SHED_DEPTH, .18).forEach((wall, index) => {
    const part = assemblyPart(assembly, { name: wall.name, at: .08 + index * .11, dust: true });
    box(part, colors.plaster, wall.x, .68, wall.z, wall.width, SHED_HEIGHT, wall.depth, .06);
  });
  maintenanceCornice(assemblyPart(assembly, { name: 'cornice', at: .58, lift: .2 }));
  maintenanceRoof(assemblyPart(assembly, { name: 'roof', at: .72, lift: .4, duration: .34, dust: true }));
  maintenanceBench(assemblyPart(assembly, { name: 'bench', at: .95, lift: .14, duration: .22 }));
  maintenanceTools(assemblyPart(assembly, { name: 'tools', at: 1.08, lift: .14, duration: .22 }));
  return assembly;
}


const LODGE_WIDTH = 1.7;
const LODGE_DEPTH = 1.5;
const LODGE_HEIGHT = 1.1;
const LODGE_Z = -.2;

function lodgePlinth(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .1, 0, 2.3, .2, 2.3);
}

function lodgeBody(parent: T.Object3D): void {
  box(parent, colors.wood, 0, .75, LODGE_Z, LODGE_WIDTH, LODGE_HEIGHT, LODGE_DEPTH, .05);
}

function lodgeCornice(parent: T.Object3D): void {
  box(parent, colors.cream, 0, 1.35, LODGE_Z, 1.85, .12, 1.65);
}

function lodgeRoof(parent: T.Object3D): void {
  roof(parent, 2.05, 1.85, 1.41, .62, colors.roofDark);
}

function lodgePorch(parent: T.Object3D): void {
  box(parent, colors.dark, 0, .62, .56, .45, .8, .06);
  for (const [px, pz] of [[-.95, .85], [.95, .85]]) post(parent, colors.wood, px, .55, pz, .05, .9);
  box(parent, colors.wood, 0, 1.0, .85, 1.95, .05, .05);
}

function lodgeQuarry(parent: T.Object3D): void {
  for (let i = 0; i < 3; i++) lump(parent, 0x8e3f3a, -.55 + i * .55, .82, .85, .08, .16, .06);
  post(parent, colors.wood, -.85, .7, -.95, .03, 1.2);
  box(parent, colors.gold, -.85, 1.25, -.95, .03, .16, .03);
  lump(parent, HIDE, .8, .28, .75, .22, .12, .18);
}

export function lodge(): T.Group {
  const hut = new T.Group();
  lodgePlinth(hut);
  lodgeBody(hut);
  lodgeCornice(hut);
  lodgeRoof(hut);
  lodgePorch(hut);
  lodgeQuarry(hut);
  return hut;
}

export function lodgePieces(): ModelAssembly {
  const assembly = modelAssembly();
  lodgePlinth(assemblyPart(assembly, { name: 'foundation', at: 0, lift: 0, dust: true }));
  shellWalls(LODGE_WIDTH, LODGE_DEPTH, .2).forEach((wall, index) => {
    const part = assemblyPart(assembly, { name: wall.name, at: .08 + index * .11, dust: true });
    box(part, colors.wood, wall.x, .75, wall.z + LODGE_Z, wall.width, LODGE_HEIGHT, wall.depth, .05);
  });
  lodgeCornice(assemblyPart(assembly, { name: 'cornice', at: .58, lift: .2 }));
  lodgeRoof(assemblyPart(assembly, { name: 'roof', at: .72, lift: .4, duration: .34, dust: true }));
  lodgePorch(assemblyPart(assembly, { name: 'porch', at: .95, lift: .18, duration: .24 }));
  lodgeQuarry(assemblyPart(assembly, { name: 'racks', at: 1.1, lift: .14, duration: .22 }));
  return assembly;
}

const CABIN_WIDTH = 1.5;
const CABIN_DEPTH = 1.3;
const CABIN_HEIGHT = .9;
const CABIN_Z = -.25;

function cabinPlinth(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .1, 0, 2.3, .2, 2.3);
}

function cabinLogs(parent: T.Object3D): void {
  for (let row = 0; row < 5; row++) {
    const log = post(parent, colors.wood, 0, .32 + row * .2, CABIN_Z, .09, 1.6);
    log.rotation.z = Math.PI / 2;
    const side = post(parent, colors.wood, 0, .32 + row * .2, CABIN_Z, .09, 1.4);
    side.rotation.x = Math.PI / 2;
    side.position.x = row % 2 ? -.78 : .78;
  }
}

function cabinBody(parent: T.Object3D): void {
  box(parent, colors.plaster, 0, .8, CABIN_Z, CABIN_WIDTH, CABIN_HEIGHT, CABIN_DEPTH, .05);
}

function cabinCornice(parent: T.Object3D): void {
  box(parent, colors.cream, 0, 1.28, CABIN_Z, 1.75, .1, 1.55);
}

function cabinRoof(parent: T.Object3D): void {
  roof(parent, 1.95, 1.75, 1.33, .5, colors.roofDark);
}

function cabinDoor(parent: T.Object3D): void {
  box(parent, colors.dark, .35, .58, .42, .4, .7, .06);
}

function cabinYard(parent: T.Object3D): void {
  for (let i = 0; i < 4; i++) {
    const log = post(parent, colors.wood, -.75 + (i % 2) * .16, .22 + Math.floor(i / 2) * .15, .8, .07, .55);
    log.rotation.x = Math.PI / 2;
  }
  post(parent, colors.wood, .8, .22, .8, .17, .3);
  const axe = box(parent, colors.wood, .8, .55, .8, .04, .5, .04);
  axe.rotation.z = .5;
  box(parent, colors.stone, .68, .72, .8, .14, .1, .04);
}

export function woodcutter(): T.Group {
  const cabin = new T.Group();
  cabinPlinth(cabin);
  cabinLogs(cabin);
  cabinBody(cabin);
  cabinCornice(cabin);
  cabinRoof(cabin);
  cabinDoor(cabin);
  cabinYard(cabin);
  return cabin;
}

export function woodcutterPieces(): ModelAssembly {
  const assembly = modelAssembly();
  cabinPlinth(assemblyPart(assembly, { name: 'foundation', at: 0, lift: 0, dust: true }));
  shellWalls(CABIN_WIDTH, CABIN_DEPTH, .18).forEach((wall, index) => {
    const part = assemblyPart(assembly, { name: wall.name, at: .08 + index * .1, dust: true });
    box(part, colors.plaster, wall.x, .8, wall.z + CABIN_Z, wall.width, CABIN_HEIGHT, wall.depth, .05);
  });
  cabinLogs(assemblyPart(assembly, { name: 'log-walls', at: .52, lift: .24, duration: .3, dust: true }));
  cabinCornice(assemblyPart(assembly, { name: 'cornice', at: .72, lift: .2 }));
  cabinRoof(assemblyPart(assembly, { name: 'roof', at: .86, lift: .4, duration: .34, dust: true }));
  cabinDoor(assemblyPart(assembly, { name: 'door', at: 1.06, lift: .12, duration: .22 }));
  cabinYard(assemblyPart(assembly, { name: 'woodpile', at: 1.18, lift: .14, duration: .22 }));
  return assembly;
}

const YARD_SLOTS: [number, number][] = [[-1.15, -.95], [-.4, -.95], [.4, -.95], [1.15, -.95], [-1.15, .3], [-.4, .3], [.4, .3], [1.15, .3]];

function yardFloor(parent: T.Object3D): void {
  box(parent, colors.stone, 0, .1, 0, 3.5, .2, 3.5);
  for (let i = 0; i < 9; i++) box(parent, i % 2 ? 0xc9ad84 : 0xbfa27a, 0, .23, -1.6 + i * .4, 3.35, .06, .36, .01);
}

function yardPosts(parent: T.Object3D): void {
  for (const px of [-1.55, -.5, .5, 1.55]) {
    post(parent, colors.wood, px, .8, -1.55, .07, 1.2);
    post(parent, colors.wood, px, .95, -.35, .07, 1.5);
  }
}

function yardBeams(parent: T.Object3D): void {
  box(parent, colors.wood, 0, 1.68, -.35, 3.35, .08, .08);
  box(parent, colors.wood, 0, 1.38, -1.55, 3.35, .08, .08);
  for (let i = 0; i < 7; i++) {
    const rafter = box(parent, colors.wood, -1.5 + i * .5, 1.53, -.95, .06, .06, 1.35);
    rafter.rotation.x = -.245;
  }
}

function yardShade(parent: T.Object3D): void {
  const shade = box(parent, colors.roofDark, 0, 1.6, -.95, 3.4, .05, 1.45, .01);
  shade.rotation.x = -.245;
  for (let i = 0; i < 11; i++) {
    const batten = box(parent, colors.roofLight, -1.6 + i * .32, 1.635, -.95, .07, .05, 1.45, .01);
    batten.rotation.x = -.245;
  }
}

function yardKerb(parent: T.Object3D): void {
  for (const [px, pz] of [[-1.62, 1.62], [1.62, 1.62], [-1.62, .95], [1.62, .95]]) post(parent, colors.stone, px, .36, pz, .08, .3);
  for (let i = 0; i < 4; i++) box(parent, colors.wood, -1.2 + i * .8, .27, 1.62, .04, .08, .4);
}

function yardCrane(parent: T.Object3D): void {
  const crane = group(parent, 1.25, .26, 1.2);
  for (const side of [-1, 1]) {
    const leg = post(crane, colors.wood, side * .3, .8, 0, .05, 1.7);
    leg.rotation.z = -side * .32;
  }
  post(crane, colors.wood, 0, 1.6, 0, .05, .08);
  post(crane, colors.linen, 0, 1.15, .02, .015, .9);
  lump(crane, colors.stone, 0, .68, .02, .16, .12, .14);
}

function yardBays(parent: T.Object3D, stores: Stores): void {
  for (const [px, pz] of YARD_SLOTS) box(parent, colors.earth, px, .27, pz, .62, .02, .62, .01);
  bundlesOf(stores, YARD_SLOTS.length).forEach((food, index) => {
    const [px, pz] = YARD_SLOTS[index];
    bundle(parent, food, px, .28, pz, index);
  });
}

export function stockpile(stores: Stores = {}): T.Group {
  const yard = new T.Group();
  yardFloor(yard);
  yardPosts(yard);
  yardBeams(yard);
  yardShade(yard);
  yardKerb(yard);
  yardCrane(yard);
  yardBays(yard, stores);
  return yard;
}

export function stockpilePieces(stores: Stores): ModelAssembly {
  const assembly = modelAssembly(false);
  yardFloor(assemblyPart(assembly, { name: 'floor', at: 0, lift: 0, dust: true }));
  yardKerb(assemblyPart(assembly, { name: 'kerb', at: .16, lift: .16, duration: .24 }));
  yardPosts(assemblyPart(assembly, { name: 'posts', at: .3, lift: .4, dust: true }));
  yardBeams(assemblyPart(assembly, { name: 'beams', at: .5, lift: .34, dust: true }));
  yardShade(assemblyPart(assembly, { name: 'shade', at: .68, lift: .3, duration: .32 }));
  yardCrane(assemblyPart(assembly, { name: 'crane', at: .9, lift: .3, duration: .26 }));
  yardBays(assemblyPart(assembly, { name: 'bays', at: 1.04, lift: .14, duration: .22 }), stores);
  return assembly;
}
