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

export function granary(stores: Stores = {}): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .12, 0, 3.4, .24, 3.3);
  box(store, colors.paving, 0, .25, .2, 3.15, .04, 2.65);
  const shed = group(store, 0, 0, -1.1);
  box(shed, colors.plaster, 0, .95, 0, 3.2, 1.4, 1.1, .06);
  box(shed, colors.cream, 0, 1.68, 0, 3.35, .14, 1.25);
  roof(shed, 3.5, 1.4, 1.74, .55, colors.roofDark);
  box(shed, colors.wood, -.7, .82, .56, .7, 1.05, .08);
  box(shed, colors.wood, .7, .82, .56, .7, 1.05, .08);
  for (const px of [-1.35, 1.35]) box(store, colors.stone, px, .4, .55, .16, .32, 2.3);
  box(store, colors.stone, 0, .4, 1.62, 2.85, .32, .16);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      box(store, colors.earth, -.85 + col * .85, .285, -.15 + row * .72, .7, .03, .58, .01);
    }
  }
  bundlesOf(stores, 9).forEach((food, index) => {
    bundle(store, food, -.85 + (index % 3) * .85, .3, 1.3 - Math.floor(index / 3) * .72, index);
  });
  return store;
}
