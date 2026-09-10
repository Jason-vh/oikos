import * as T from 'three';
import { box, colors, lump, post, pot, roof } from './primitives';

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

export function granary(stage = 0): T.Group {
  const store = new T.Group();
  box(store, colors.stone, 0, .12, 0, 3.15, .24, 3.0);
  box(store, colors.plaster, 0, 1.02, 0, 2.75, 1.6, 2.55, .07);
  box(store, colors.cream, 0, 1.85, 0, 2.9, .18, 2.7);
  roof(store, 3.15, 3.05, 1.94, .62, colors.roofDark);
  box(store, colors.wood, -.55, .78, 1.29, .95, 1.4, .1);
  box(store, colors.wood, .55, .78, 1.29, .95, 1.4, .1);
  box(store, colors.dark, 0, .78, 1.31, .1, 1.4, .06);
  box(store, colors.gold, -.2, .78, 1.35, .06, .06, .04);
  box(store, colors.gold, .2, .78, 1.35, .06, .06, .04);
  box(store, colors.paving, 0, .1, 1.5, 3.3, .2, .5);
  pot(store, -1.25, .18, -1.05, .9);
  const baskets = [[1.22, 0, 1.55], [.8, 0, 1.55], [1.22, 0, 1.15], [-1.22, 0, 1.55], [-.8, 0, 1.55], [-1.22, 0, 1.15], [1.0, .42, 1.55], [-1.0, .42, 1.55], [1.22, .42, 1.15]];
  for (const [px, py, pz] of baskets.slice(0, stage * 3)) {
    post(store, 0xd9c48f, px, .21 + py, pz, .24, .42);
    post(store, colors.wood, px, .4 + py, pz, .25, .04);
    lump(store, colors.gold, px, .46 + py, pz, .2, .09, .2);
  }
  return store;
}
