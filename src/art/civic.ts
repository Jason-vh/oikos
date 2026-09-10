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

export { towerGranary as granary } from './granaries';
