import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, mesh, post, roof } from './primitives';
import { bundle, bundlesOf } from './food';

export type GranaryVariant = 'tower' | 'drum' | 'silos' | 'stoa' | 'terrace' | 'pithoi' | 'pithoi-low' | 'pithoi-open' | 'pithoi-sunk' | 'pithoi-colonnade' | 'pithoi-lodge';
export const GRANARY_VARIANTS: GranaryVariant[] = ['tower', 'drum', 'silos', 'stoa', 'terrace', 'pithoi', 'pithoi-low', 'pithoi-open', 'pithoi-sunk', 'pithoi-colonnade', 'pithoi-lodge'];
export const SLOTS = 8;

function place(parent: T.Object3D, stores: Stores, slots: [number, number, number][], scale = 1): void {
  bundlesOf(stores, slots.length).forEach((food, index) => {
    const [x, y, z] = slots[index];
    const pile = group(parent, x, y, z);
    pile.scale.setScalar(scale);
    bundle(pile, food, 0, 0, 0, index);
  });
}

function pad(parent: T.Object3D, slots: [number, number, number][], size = .78): void {
  for (const [x, y, z] of slots) box(parent, colors.earth, x, y - .015, z, size, .03, size, .01);
}

function cypress(parent: T.Object3D, x: number, y: number, z: number, scale = .8): void {
  const tree = group(parent, x, y, z);
  tree.scale.setScalar(scale);
  post(tree, colors.wood, 0, .5, 0, .09, 1);
  lump(tree, colors.oliveDark, 0, 1.35, 0, .42, 1.2, .42);
  lump(tree, colors.olive, .03, 2.1, 0, .27, .75, .28);
}

function ring(parent: T.Object3D, color: number, x: number, y: number, z: number, radius: number, height: number, segments = 16): T.Mesh {
  const geometry = new T.CylinderGeometry(radius, radius, height, segments);
  return mesh(parent, geometry, color, x, y, z);
}

export function towerGranary(stores: Stores): T.Group {
  const store = new T.Group();
  const slots: [number, number, number][] = [[-1.05, .3, 1.05], [0, .3, 1.05], [1.05, .3, 1.05], [1.05, .3, 0], [1.05, .3, -1.05], [0, .3, -1.05], [-1.05, .3, -1.05], [-1.05, .3, 0]];
  box(store, colors.stone, 0, .12, 0, 3.5, .24, 3.5);
  box(store, colors.paving, 0, .25, 0, 3.3, .04, 3.3);
  for (const [px, pz] of [[-1.7, 0], [1.7, 0]]) box(store, colors.stone, px, .4, pz, .14, .32, 3.5);
  for (const [px, pz] of [[0, -1.7], [0, 1.7]]) box(store, colors.stone, px, .4, pz, 3.5, .32, .14);
  const tower = group(store, 0, .27, 0);
  box(tower, colors.stone, 0, .12, 0, 1.3, .24, 1.3);
  box(tower, colors.plaster, 0, .95, 0, 1.1, 1.5, 1.1, .06);
  box(tower, colors.cream, 0, 1.75, 0, 1.28, .14, 1.28);
  roof(tower, 1.55, 1.55, 1.81, .5, colors.roofDark);
  for (const [px, pz, angle] of [[0, .56, 0], [.56, 0, Math.PI / 2], [0, -.56, Math.PI], [-.56, 0, -Math.PI / 2]]) {
    const face = group(tower, px, 0, pz, angle);
    box(face, colors.wood, 0, .62, 0, .5, .78, .07);
    box(face, colors.dark, 0, 1.35, 0, .26, .26, .07);
  }
  pad(store, slots);
  place(store, stores, slots);
  return store;
}

export function drumGranary(stores: Stores): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .12, 0, 3.6, .24, 3.6);
  box(store, colors.paving, 0, .25, 0, 3.4, .04, 3.4);
  for (const [px, pz] of [[-1.5, 1.5], [-.5, 1.5], [.5, 1.5], [1.5, 1.5], [1.5, .5], [1.5, -.5]]) {
    post(store, colors.stone, px, .35, pz, .13, .16);
    post(store, colors.cream, px, .9, pz, .09, .95);
    box(store, colors.cream, px, 1.42, pz, .28, .1, .28);
  }
  box(store, colors.cream, 0, 1.53, 1.5, 3.5, .12, .5);
  box(store, colors.cream, 1.5, 1.53, .3, .5, .12, 2.9);
  box(store, colors.roofDark, 0, 1.64, 1.5, 3.55, .1, .6);
  box(store, colors.roofDark, 1.5, 1.64, .3, .6, .1, 2.95);
  ring(store, colors.stone, -.3, 1.0, -.3, 1.45, 1.5, 20);
  ring(store, colors.cream, -.3, 1.79, -.3, 1.5, .1, 20);
  ring(store, colors.paving, -.3, 1.86, -.3, 1.38, .06, 20);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    box(store, colors.plaster, -.3 + Math.cos(angle) * 1.45, 1.0, -.3 + Math.sin(angle) * 1.45, .16, 1.4, .16, .03).rotation.y = -angle;
  }
  const stair = group(store, 1.05, .27, -.9, -Math.PI / 4);
  for (let step = 0; step < 7; step++) box(stair, colors.cream, 0, step * .22 + .1, -step * .26, .8, .2, .3);
  const slots: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2 + Math.PI / 8;
    slots.push([-.3 + Math.cos(angle) * .85, 1.9, -.3 + Math.sin(angle) * .85]);
  }
  place(store, stores, slots, .75);
  cypress(store, -1.45, .27, -1.45, .7);
  return store;
}

export function silosGranary(stores: Stores): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .12, 0, 3.6, .24, 3.6);
  box(store, colors.paving, 0, .25, 0, 3.4, .04, 3.4);
  for (const [px, pz] of [[-1.2, -1.0], [0, -1.15], [1.2, -1.0], [-1.25, .35], [1.25, .35]]) {
    const silo = group(store, px, .27, pz);
    ring(silo, 0xd8c4a0, 0, .45, 0, .48, .9, 12);
    const dome = new T.SphereGeometry(.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    mesh(silo, dome, 0xe2cfae, 0, .9, 0);
    box(silo, colors.wood, 0, .35, .47, .28, .34, .06);
    lump(silo, colors.roofDark, 0, 1.42, 0, .1, .12, .1);
  }
  const slots: [number, number, number][] = [[-1.25, .3, 1.3], [-.42, .3, 1.3], [.42, .3, 1.3], [1.25, .3, 1.3], [-.6, .3, .45], [.6, .3, .45], [-.6, .3, -.35], [.6, .3, -.35]];
  pad(store, slots, .72);
  place(store, stores, slots, .9);
  for (let x = -1.6; x <= 1.6; x += .8) post(store, colors.wood, x, .5, 1.72, .04, .5);
  box(store, colors.wood, 0, .7, 1.72, 3.4, .04, .04);
  return store;
}

export function stoaGranary(stores: Stores): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .12, 0, 3.6, .24, 3.6);
  box(store, colors.cream, 0, .3, 0, 3.4, .12, 3.4);
  box(store, colors.paving, 0, .38, 0, 3.2, .04, 3.2);
  for (const px of [-1.5, -.5, .5, 1.5]) {
    for (const pz of [-1.5, 1.5]) {
      post(store, colors.stone, px, .45, pz, .15, .1);
      post(store, colors.cream, px, 1.45, pz, .1, 1.95);
      box(store, colors.cream, px, 2.45, pz, .32, .12, .32);
    }
  }
  box(store, colors.plaster, 0, 1.45, -1.55, 3.4, 2.0, .16, .04);
  box(store, colors.cream, 0, 2.58, 0, 3.6, .14, 3.5);
  roof(store, 3.8, 3.7, 2.65, .6, colors.roof);
  const slots: [number, number, number][] = [[-1.2, .4, .95], [-.4, .4, .95], [.4, .4, .95], [1.2, .4, .95], [-1.2, .4, -.35], [-.4, .4, -.35], [.4, .4, -.35], [1.2, .4, -.35]];
  pad(store, slots, .7);
  place(store, stores, slots, .85);
  return store;
}

export function terraceGranary(stores: Stores): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .14, 0, 3.6, .28, 3.6);
  box(store, colors.grass, 0, .29, 0, 3.4, .04, 3.4);
  box(store, colors.stone, -.3, .46, -.3, 2.8, .36, 2.8);
  box(store, colors.paving, -.3, .65, -.3, 2.65, .04, 2.65);
  box(store, colors.stone, -.55, .8, -.55, 1.7, .34, 1.7);
  box(store, colors.paving, -.55, .98, -.55, 1.55, .04, 1.55);
  const shrine = group(store, -.55, 1.0, -.55);
  box(shrine, colors.plaster, 0, .5, 0, .9, 1.0, .9, .05);
  box(shrine, colors.cream, 0, 1.05, 0, 1.05, .1, 1.05);
  roof(shrine, 1.25, 1.25, 1.1, .4, colors.roofDark);
  box(shrine, colors.wood, 0, .42, .46, .36, .6, .05);
  for (let step = 0; step < 3; step++) box(store, colors.cream, 1.25, .35 + step * .1, 1.25 - step * .28, .9, .12, .3);
  const slots: [number, number, number][] = [[.45, 1.0, -1.15], [-1.15, 1.0, .45], [.9, .67, -1.4], [.9, .67, -.55], [.9, .67, .3], [-1.4, .67, .9], [-.55, .67, .9], [.3, .67, .9]];
  pad(store, slots, .62);
  place(store, stores, slots, .72);
  cypress(store, 1.4, .27, -1.4, .75);
  cypress(store, -1.4, .27, 1.4, .6);
  return store;
}

const PITHOI_SLOTS: [number, number, number][] = [[-1.05, .3, -.85], [0, .3, -.85], [1.05, .3, -.85], [-1.05, .3, .15], [0, .3, .15], [1.05, .3, .15], [-1.05, .3, 1.15], [1.05, .3, 1.15]];

function pithoiBase(store: T.Group): void {
  box(store, colors.stone, 0, .12, 0, 3.5, .24, 3.5);
  box(store, colors.paving, 0, .25, 0, 3.35, .04, 3.35);
}

function jars(store: T.Group, stores: Stores, slots: [number, number, number][] = PITHOI_SLOTS, sunk = false): void {
  for (const [x, y, z] of slots) {
    if (sunk) {
      ring(store, colors.roof, x, y + .06, z, .36, .16, 12);
      ring(store, colors.roofDark, x, y + .15, z, .3, .04, 12);
    } else {
      ring(store, colors.stone, x, y + .02, z, .4, .1, 12);
      ring(store, colors.roof, x, y + .1, z, .34, .12, 12);
    }
  }
  place(store, stores, slots.map(([x, y, z]) => [x, y + (sunk ? .17 : 0), z]), .82);
}

function courtWalls(store: T.Group, height: number, sides: ('n' | 'e' | 'w' | 's')[] = ['n', 'e', 'w']): void {
  const geometry: Record<string, [number, number, number, number]> = { n: [0, -1.62, 3.5, .22], s: [0, 1.62, 3.5, .22], w: [-1.64, 0, .22, 3.5], e: [1.64, 0, .22, 3.5] };
  for (const side of sides) {
    const [px, pz, w, d] = geometry[side];
    box(store, colors.plaster, px, .25 + height / 2, pz, w, height, d, .04);
    box(store, colors.cream, px, .3 + height, pz, w + .08, .1, d + .08);
  }
}

function gatehouse(store: T.Group, z = 1.55): void {
  const gate = group(store, 0, .27, z);
  for (const px of [-.75, .75]) box(gate, colors.plaster, px, .55, 0, .4, 1.1, .5, .04);
  box(gate, colors.cream, 0, 1.15, 0, 2.0, .12, .6);
  roof(gate, 2.2, .8, 1.2, .35, colors.roofDark);
}

export function pithoiGranary(stores: Stores): T.Group {
  const store = new T.Group();
  pithoiBase(store);
  courtWalls(store, .9);
  gatehouse(store);
  jars(store, stores);
  return store;
}

export function pithoiLowGranary(stores: Stores): T.Group {
  const store = new T.Group();
  pithoiBase(store);
  courtWalls(store, .42, ['n', 'e', 'w']);
  for (const px of [-1.64, 1.64]) {
    box(store, colors.plaster, px, .46, 1.0, .22, .42, 1.0, .04);
    box(store, colors.cream, px, .72, 1.0, .3, .1, 1.08);
    box(store, colors.plaster, px === -1.64 ? -1.15 : 1.15, .46, 1.5, .8, .42, .22, .04);
    box(store, colors.cream, px === -1.64 ? -1.15 : 1.15, .72, 1.5, .88, .1, .3);
  }
  for (const px of [-.7, .7]) {
    post(store, colors.stone, px, .33, 1.5, .16, .12);
    post(store, colors.cream, px, .95, 1.5, .11, 1.15);
    box(store, colors.cream, px, 1.56, 1.5, .34, .1, .34);
  }
  box(store, colors.cream, 0, 1.66, 1.5, 1.9, .1, .5);
  const lintel = group(store, 0, 0, 1.5);
  roof(lintel, 2.05, .5, 1.71, .28, colors.roofDark);
  pits(store, stores);
  return store;
}

function pits(store: T.Group, stores: Stores, slots: [number, number, number][] = PITHOI_SLOTS): void {
  const filled = bundlesOf(stores, slots.length).length;
  slots.forEach(([x, y, z], index) => {
    ring(store, colors.stone, x, y - .01, z, .42, .06, 12);
    if (index >= filled) ring(store, colors.dark, x, y + .005, z, .34, .05, 12);
  });
  place(store, stores, slots, .82);
}

export function pithoiOpenGranary(stores: Stores): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .14, 0, 3.6, .28, 3.6);
  box(store, colors.paving, 0, .29, 0, 3.4, .04, 3.4);
  for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    post(store, colors.wood, px, .62, pz, .06, .7);
    lump(store, colors.cream, px, 1.0, pz, .09, .09, .09);
  }
  for (const [ax, az, bx, bz] of [[-1.6, -1.6, 1.6, -1.6], [-1.6, -1.6, -1.6, 1.6], [1.6, -1.6, 1.6, 1.6]]) {
    const rope = box(store, colors.linen, (ax + bx) / 2, .9, (az + bz) / 2, ax === bx ? .03 : 3.2, .03, az === bz ? .03 : 3.2, .01);
    rope.position.y = .88;
  }
  jars(store, stores, PITHOI_SLOTS.map(([x, y, z]) => [x, y + .04, z]));
  return store;
}

export function pithoiSunkGranary(stores: Stores): T.Group {
  const store = new T.Group();
  pithoiBase(store);
  courtWalls(store, .5, ['n', 'e', 'w']);
  box(store, colors.earth, 0, .32, .1, 3.15, .12, 2.65, .03);
  jars(store, stores, PITHOI_SLOTS.map(([x, y, z]) => [x, y + .08, z]), true);
  for (let step = 0; step < 2; step++) box(store, colors.cream, 0, .3 + step * .06, 1.55 - step * .12, .9, .08, .22);
  return store;
}

export function pithoiColonnadeGranary(stores: Stores): T.Group {
  const store = new T.Group();
  pithoiBase(store);
  courtWalls(store, .42, ['e', 'w', 's']);
  for (const px of [-1.5, -.5, .5, 1.5]) {
    post(store, colors.stone, px, .33, -1.5, .13, .12);
    post(store, colors.cream, px, 1.0, -1.5, .09, 1.25);
    box(store, colors.cream, px, 1.66, -1.5, .3, .1, .3);
  }
  box(store, colors.cream, 0, 1.77, -1.2, 3.6, .12, 1.0);
  const shade = group(store, 0, 0, -1.2);
  roof(shade, 3.75, 1.15, 1.83, .32, colors.roofDark);
  box(store, colors.paving, 0, .3, 1.65, .9, .1, .3);
  jars(store, stores);
  return store;
}

export function pithoiLodgeGranary(stores: Stores): T.Group {
  const store = new T.Group();
  pithoiBase(store);
  courtWalls(store, .42, ['n', 'e', 'w', 's']);
  const lodge = group(store, 1.15, .27, -1.05);
  box(lodge, colors.plaster, 0, .55, 0, 1.15, 1.1, 1.15, .05);
  box(lodge, colors.cream, 0, 1.14, 0, 1.3, .1, 1.3);
  roof(lodge, 1.5, 1.5, 1.2, .42, colors.roofDark);
  box(lodge, colors.wood, -.2, .42, .59, .36, .64, .05);
  box(lodge, colors.blue, .3, .6, .59, .22, .28, .05);
  cypress(store, -1.35, .27, 1.3, .65);
  const slots: [number, number, number][] = [[-1.05, .3, -1.0], [0, .3, -1.0], [-1.05, .3, 0], [0, .3, 0], [1.05, .3, 0], [-.35, .3, 1.05], [.55, .3, 1.05], [1.3, .3, 1.05]];
  jars(store, stores, slots);
  return store;
}

export function granaryVariant(variant: GranaryVariant, stores: Stores): T.Group {
  switch (variant) {
    case 'tower': return towerGranary(stores);
    case 'drum': return drumGranary(stores);
    case 'silos': return silosGranary(stores);
    case 'stoa': return stoaGranary(stores);
    case 'terrace': return terraceGranary(stores);
    case 'pithoi': return pithoiGranary(stores);
    case 'pithoi-low': return pithoiLowGranary(stores);
    case 'pithoi-open': return pithoiOpenGranary(stores);
    case 'pithoi-sunk': return pithoiSunkGranary(stores);
    case 'pithoi-colonnade': return pithoiColonnadeGranary(stores);
    case 'pithoi-lodge': return pithoiLodgeGranary(stores);
  }
}
