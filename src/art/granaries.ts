import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, mesh, post, roof } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';
import { bundle, bundlesOf } from './food';

function place(parent: T.Object3D, stores: Stores, slots: [number, number, number][], scale = 1): void {
  bundlesOf(stores, slots.length).forEach((food, index) => {
    const [x, y, z] = slots[index];
    const pile = group(parent, x, y, z);
    pile.scale.setScalar(scale);
    bundle(pile, food, 0, 0, 0, index);
  });
}

function ring(parent: T.Object3D, color: number, x: number, y: number, z: number, radius: number, height: number, segments = 16): T.Mesh {
  const geometry = new T.CylinderGeometry(radius, radius, height, segments);
  return mesh(parent, geometry, color, x, y, z);
}

const SLOTS: [number, number, number][] = [[-1.05, .3, -.85], [0, .3, -.85], [1.05, .3, -.85], [-1.05, .3, .15], [0, .3, .15], [1.05, .3, .15], [-1.05, .3, 1.15], [1.05, .3, 1.15]];

function base(store: T.Object3D): void {
  box(store, colors.stone, 0, .12, 0, 3.5, .24, 3.5);
  box(store, colors.paving, 0, .25, 0, 3.35, .04, 3.35);
}

const COURT_HEIGHT = .42;

function courtWalls(store: T.Object3D, height: number, sides: ('n' | 'e' | 'w' | 's')[] = ['n', 'e', 'w']): void {
  const geometry: Record<string, [number, number, number, number]> = { n: [0, -1.62, 3.5, .22], s: [0, 1.62, 3.5, .22], w: [-1.64, 0, .22, 3.5], e: [1.64, 0, .22, 3.5] };
  for (const side of sides) {
    const [px, pz, w, d] = geometry[side];
    box(store, colors.plaster, px, .25 + height / 2, pz, w, height, d, .04);
  }
}

function courtCoping(store: T.Object3D, height: number, sides: ('n' | 'e' | 'w' | 's')[] = ['n', 'e', 'w']): void {
  const geometry: Record<string, [number, number, number, number]> = { n: [0, -1.62, 3.5, .22], s: [0, 1.62, 3.5, .22], w: [-1.64, 0, .22, 3.5], e: [1.64, 0, .22, 3.5] };
  for (const side of sides) {
    const [px, pz, w, d] = geometry[side];
    box(store, colors.cream, px, .3 + height, pz, w + .08, .1, d + .08);
  }
}

function gateWalls(store: T.Object3D): void {
  for (const px of [-1.64, 1.64]) {
    box(store, colors.plaster, px, .46, 1.0, .22, .42, 1.0, .04);
    box(store, colors.plaster, px === -1.64 ? -1.15 : 1.15, .46, 1.5, .8, .42, .22, .04);
  }
}

function gateCoping(store: T.Object3D): void {
  for (const px of [-1.64, 1.64]) {
    box(store, colors.cream, px, .72, 1.0, .3, .1, 1.08);
    box(store, colors.cream, px === -1.64 ? -1.15 : 1.15, .72, 1.5, .88, .1, .3);
  }
}

function gateColumns(store: T.Object3D): void {
  for (const px of [-.7, .7]) {
    post(store, colors.stone, px, .33, 1.5, .16, .12);
    post(store, colors.cream, px, .95, 1.5, .11, 1.15);
    box(store, colors.cream, px, 1.56, 1.5, .34, .1, .34);
  }
}

function gateLintel(store: T.Object3D): void {
  box(store, colors.cream, 0, 1.66, 1.5, 1.9, .1, .5);
  const lintel = group(store, 0, 0, 1.5);
  roof(lintel, 2.05, .5, 1.71, .28, colors.roofDark);
}

export function granary(stores: Stores = {}): T.Group {
  const store = new T.Group();
  base(store);
  courtWalls(store, COURT_HEIGHT);
  courtCoping(store, COURT_HEIGHT);
  gateWalls(store);
  gateCoping(store);
  gateColumns(store);
  gateLintel(store);
  pits(store, stores);
  return store;
}

export function granaryPieces(stores: Stores): ModelAssembly {
  const assembly = modelAssembly();
  base(assemblyPart(assembly, { name: 'floor', at: 0, lift: 0, dust: true }));
  courtWalls(assemblyPart(assembly, { name: 'court-walls', at: .12, dust: true }), COURT_HEIGHT);
  gateWalls(assemblyPart(assembly, { name: 'gate-walls', at: .3, dust: true }));
  courtCoping(assemblyPart(assembly, { name: 'coping', at: .46, lift: .2 }), COURT_HEIGHT);
  gateCoping(assemblyPart(assembly, { name: 'gate-coping', at: .56, lift: .2 }));
  gateColumns(assemblyPart(assembly, { name: 'columns', at: .7, lift: .4, dust: true }));
  gateLintel(assemblyPart(assembly, { name: 'lintel', at: .9, lift: .34, duration: .32, dust: true }));
  pits(assemblyPart(assembly, { name: 'pits', at: 1.12, lift: .12, duration: .22 }), stores);
  return assembly;
}

function pits(store: T.Object3D, stores: Stores, slots: [number, number, number][] = SLOTS): void {
  const filled = bundlesOf(stores, slots.length).length;
  slots.forEach(([x, y, z], index) => {
    ring(store, colors.stone, x, y - .01, z, .42, .06, 12);
    if (index >= filled) ring(store, colors.dark, x, y + .005, z, .34, .05, 12);
  });
  place(store, stores, slots, .82);
}

