import * as T from 'three';
import type { Stores } from '../sim/types';
import { GROUND_Y } from '../sim/island';
import { box, colors, group, lump, post } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';
import { WATERLINE } from './coast';

const QUAY_BACK = -1.8;
const QUAY_FRONT = -.6;
const JETTY_END = 1.8;
const QUAY_Y = .3;
const DECK_Y = .24;
const SEA_Y = WATERLINE - GROUND_Y;
const POST_TOP = DECK_Y + .04;
const POST_FOOT = SEA_Y - .22;

export const WHARF_CATCH_SLOTS = 2;

export function wharfCatch(stores: Stores): number {
  const fish = stores.fish ?? 0;
  if (fish <= 0) return 0;
  return Math.min(WHARF_CATCH_SLOTS, Math.ceil(fish / 100));
}

function quay(parent: T.Object3D): void {
  const depth = QUAY_FRONT - QUAY_BACK;
  const centre = (QUAY_FRONT + QUAY_BACK) / 2;
  box(parent, colors.stone, 0, QUAY_Y / 2, centre, 2.3, QUAY_Y, depth);
  box(parent, colors.paving, 0, QUAY_Y, centre, 2.14, .06, depth - .14);
}

function shelter(parent: T.Object3D): void {
  const shed = group(parent, -.62, QUAY_Y, -1.2);
  for (const x of [-.44, .44]) {
    for (const z of [-.4, .4]) post(shed, colors.wood, x, .38, z, .055, .76);
  }
  box(shed, colors.plaster, 0, .36, -.47, 1.04, .72, .1, .04);
  for (let stripe = 0; stripe < 5; stripe++) {
    const cloth = box(shed, stripe % 2 ? colors.linen : colors.blue, -.44 + stripe * .22, .8, .02, .22, .06, 1.08, .02);
    cloth.rotation.x = .1;
  }
  box(shed, colors.wood, -.2, .14, .12, .5, .28, .42, .04);
}

function netRack(parent: T.Object3D): void {
  const rack = group(parent, .72, QUAY_Y, -1.16);
  for (const z of [-.42, .42]) post(rack, colors.wood, 0, .46, z, .06, .92);
  const boom = post(rack, colors.wood, 0, .88, 0, .05, 1);
  boom.rotation.x = Math.PI / 2;
  for (let fold = 0; fold < 3; fold++) {
    const drape = box(rack, colors.linen, .02, .58, -.34 + fold * .34, .05, .56, .26, .02);
    drape.rotation.z = .16 - fold * .16;
  }
  for (const z of [-.3, .05, .34]) lump(rack, colors.blue, .06, .3, z, .06, .06, .06);
}

function jetty(parent: T.Object3D): void {
  const depth = JETTY_END - QUAY_FRONT;
  const centre = (JETTY_END + QUAY_FRONT) / 2;
  box(parent, colors.wood, 0, DECK_Y - .07, centre, 1.16, .12, depth);
  box(parent, colors.cream, 0, DECK_Y, centre, 1.04, .05, depth - .12);
  for (const z of [QUAY_FRONT + .3, JETTY_END - .25]) {
    for (const x of [-.44, .44]) post(parent, colors.wood, x, (POST_TOP + POST_FOOT) / 2, z, .09, POST_TOP - POST_FOOT);
  }
  for (const [x, z] of [[-.46, JETTY_END - .35], [.46, QUAY_FRONT + .4]]) post(parent, colors.wood, x, DECK_Y + .19, z, .08, .36);
}

function creel(parent: T.Object3D, x: number, z: number, loaded: boolean): void {
  const basket = group(parent, x, QUAY_Y, z);
  box(basket, colors.wood, 0, .16, 0, .42, .32, .38, .05);
  box(basket, colors.wood, 0, .33, 0, .46, .04, .42, .02);
  if (!loaded) return;
  for (let index = 0; index < 3; index++) {
    const fish = lump(basket, 0x8fa9b3, -.12 + index * .12, .4, index % 2 ? .05 : -.05, .05, .14, .04);
    fish.rotation.z = .25 - index * .15;
  }
}

function catchOnDeck(parent: T.Object3D, stores: Stores): void {
  const loaded = wharfCatch(stores);
  const slots: [number, number][] = [[-.62, -.05], [.62, -.05]];
  slots.forEach(([x, z], index) => creel(parent, x, z, index < loaded));
}

export function wharf(stores: Stores): T.Group {
  const dock = new T.Group();
  quay(dock);
  jetty(dock);
  shelter(dock);
  netRack(dock);
  catchOnDeck(dock, stores);
  return dock;
}

export function wharfPieces(stores: Stores): ModelAssembly {
  const assembly = modelAssembly(false);
  quay(assemblyPart(assembly, { name: 'quay', at: 0, lift: 0, dust: true }));
  jetty(assemblyPart(assembly, { name: 'jetty', at: .22, lift: .3, duration: .3, dust: true }));
  shelter(assemblyPart(assembly, { name: 'shelter', at: .5, lift: .34, duration: .3, dust: true }));
  netRack(assemblyPart(assembly, { name: 'net-rack', at: .74, lift: .24, duration: .26 }));
  catchOnDeck(assemblyPart(assembly, { name: 'creels', at: .96, lift: .16, duration: .22 }), stores);
  return assembly;
}
