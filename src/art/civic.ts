import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, pot, roof } from './primitives';
import { bundle, bundlesOf } from './food';

const HIDE = 0x5c4433;

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

export function lodge(): T.Group {
  const hut = new T.Group();
  box(hut, colors.stone, 0, .1, 0, 2.3, .2, 2.3);
  box(hut, colors.wood, 0, .75, -.2, 1.7, 1.1, 1.5, .05);
  box(hut, colors.cream, 0, 1.35, -.2, 1.85, .12, 1.65);
  roof(hut, 2.05, 1.85, 1.41, .62, colors.roofDark);
  box(hut, colors.dark, 0, .62, .56, .45, .8, .06);
  for (const [px, pz] of [[-.95, .85], [.95, .85]]) post(hut, colors.wood, px, .55, pz, .05, .9);
  box(hut, colors.wood, 0, 1.0, .85, 1.95, .05, .05);
  for (let i = 0; i < 3; i++) lump(hut, 0x8e3f3a, -.55 + i * .55, .82, .85, .08, .16, .06);
  post(hut, colors.wood, -.85, .7, -.95, .03, 1.2);
  box(hut, colors.gold, -.85, 1.25, -.95, .03, .16, .03);
  lump(hut, HIDE, .8, .28, .75, .22, .12, .18);
  return hut;
}

export function woodcutter(): T.Group {
  const cabin = new T.Group();
  box(cabin, colors.stone, 0, .1, 0, 2.3, .2, 2.3);
  for (let row = 0; row < 5; row++) {
    const log = post(cabin, colors.wood, 0, .32 + row * .2, -.25, .09, 1.6);
    log.rotation.z = Math.PI / 2;
    const side = post(cabin, colors.wood, 0, .32 + row * .2, -.25, .09, 1.4);
    side.rotation.x = Math.PI / 2;
    side.position.x = row % 2 ? -.78 : .78;
  }
  box(cabin, colors.plaster, 0, .8, -.25, 1.5, .9, 1.3, .05);
  box(cabin, colors.cream, 0, 1.28, -.25, 1.75, .1, 1.55);
  roof(cabin, 1.95, 1.75, 1.33, .5, colors.roofDark);
  box(cabin, colors.dark, .35, .58, .42, .4, .7, .06);
  for (let i = 0; i < 4; i++) {
    const log = post(cabin, colors.wood, -.75 + (i % 2) * .16, .22 + Math.floor(i / 2) * .15, .8, .07, .55);
    log.rotation.x = Math.PI / 2;
  }
  post(cabin, colors.wood, .8, .22, .8, .17, .3);
  const axe = box(cabin, colors.wood, .8, .55, .8, .04, .5, .04);
  axe.rotation.z = .5;
  box(cabin, colors.stone, .68, .72, .8, .14, .1, .04);
  return cabin;
}

const YARD_SLOTS: [number, number][] = [[-1.15, -.95], [-.4, -.95], [.4, -.95], [1.15, -.95], [-1.15, .3], [-.4, .3], [.4, .3], [1.15, .3]];

export function stockpile(stores: Stores = {}): T.Group {
  const yard = new T.Group();
  box(yard, colors.stone, 0, .1, 0, 3.5, .2, 3.5);
  for (let i = 0; i < 9; i++) box(yard, i % 2 ? 0xc9ad84 : 0xbfa27a, 0, .23, -1.6 + i * .4, 3.35, .06, .36, .01);
  for (const px of [-1.55, -.5, .5, 1.55]) {
    post(yard, colors.wood, px, .8, -1.55, .07, 1.2);
    post(yard, colors.wood, px, .95, -.35, .07, 1.5);
  }
  box(yard, colors.wood, 0, 1.68, -.35, 3.35, .08, .08);
  box(yard, colors.wood, 0, 1.38, -1.55, 3.35, .08, .08);
  for (let i = 0; i < 7; i++) {
    const rafter = box(yard, colors.wood, -1.5 + i * .5, 1.53, -.95, .06, .06, 1.35);
    rafter.rotation.x = -.245;
  }
  const shade = box(yard, colors.roofDark, 0, 1.6, -.95, 3.5, .05, 1.45, .01);
  shade.rotation.x = -.245;
  for (let i = 0; i < 11; i++) {
    const batten = box(yard, colors.roofLight, -1.65 + i * .33, 1.635, -.95, .07, .05, 1.45, .01);
    batten.rotation.x = -.245;
  }
  for (const [px, pz] of [[-1.62, 1.62], [1.62, 1.62], [-1.62, .95], [1.62, .95]]) post(yard, colors.stone, px, .36, pz, .08, .3);
  for (let i = 0; i < 4; i++) box(yard, colors.wood, -1.2 + i * .8, .27, 1.62, .04, .08, .4);
  const crane = group(yard, 1.35, .26, 1.2);
  for (const side of [-1, 1]) {
    const leg = post(crane, colors.wood, side * .3, .8, 0, .05, 1.7);
    leg.rotation.z = -side * .32;
  }
  post(crane, colors.wood, 0, 1.6, 0, .05, .08);
  post(crane, colors.linen, 0, 1.15, .02, .015, .9);
  lump(crane, colors.stone, 0, .68, .02, .16, .12, .14);
  for (const [px, pz] of YARD_SLOTS) box(yard, colors.earth, px, .27, pz, .62, .02, .62, .01);
  bundlesOf(stores, YARD_SLOTS.length).forEach((food, index) => {
    const [px, pz] = YARD_SLOTS[index];
    bundle(yard, food, px, .28, pz, index);
  });
  return yard;
}
