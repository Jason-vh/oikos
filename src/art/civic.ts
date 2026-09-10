import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, pot, roof } from './primitives';
import { bundle, bundlesOf } from './food';

export function fountain(): T.Group {
  const basin = new T.Group();
  post(basin, colors.stone, 0, .14, 0, 1.05, .28);
  post(basin, colors.cream, 0, .36, 0, .9, .28);
  post(basin, 0x77b9b0, 0, .51, 0, .73, .04);
  post(basin, colors.plaster, 0, .96, 0, .19, .95);
  post(basin, colors.cream, 0, 1.42, 0, .48, .13);
  post(basin, 0x99d1c6, 0, 1.5, 0, .38, .04);
  lump(basin, colors.gold, 0, 1.72, 0, .16, .25, .16);
  return basin;
}

export function maintenance(): T.Group {
  const shed = new T.Group();
  box(shed, colors.stone, 0, .09, 0, 1.9, .18, 1.7);
  box(shed, colors.plaster, 0, .68, 0, 1.5, .9, 1.35, .06);
  box(shed, colors.cream, 0, 1.16, 0, 1.62, .14, 1.47);
  roof(shed, 1.75, 1.6, 1.23, .38, colors.roofDark);
  box(shed, colors.wood, 0, .5, .68, 1.3, .8, .1);
  box(shed, colors.wood, -.5, .48, .84, .5, .14, .32);
  post(shed, colors.wood, .55, .78, .82, .03, .9);
  post(shed, colors.wood, .78, .78, .82, .03, .9);
  box(shed, colors.dark, .665, 1.14, .82, .35, .045, .045);
  for (let i = 0; i < 3; i++) lump(shed, i % 2 ? colors.blue : colors.roof, .55 + i * .11, .98, .82, .06, .1, .04);
  pot(shed, -.75, .18, -.55, .55);
  pot(shed, .75, .18, -.55, .5, colors.wood);
  return shed;
}

const GRANARY_SLOTS: [number, number][] = [[-1.05, 1.05], [0, 1.05], [1.05, 1.05], [1.05, 0], [1.05, -1.05], [0, -1.05], [-1.05, -1.05], [-1.05, 0]];

export function granary(stores: Stores = {}): T.Group {
  const store = new T.Group();
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
  for (const [px, pz] of GRANARY_SLOTS) box(store, colors.earth, px, .285, pz, .82, .03, .82, .01);
  bundlesOf(stores, GRANARY_SLOTS.length).forEach((food, index) => {
    const [px, pz] = GRANARY_SLOTS[index];
    bundle(store, food, px, .3, pz, index);
  });
  return store;
}
