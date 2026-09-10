import * as T from 'three';
import { box, colors, group, lump, mesh, post, roof } from './primitives';

export function temple(parent: T.Object3D, x: number, y: number, z: number): void {
  const shrine = group(parent, x, y, z);
  for (let step = 0; step < 3; step++) {
    box(shrine, colors.cream, 0, step * .22 + .11, 0, 7.7 - step * .45, .22, 8.3 - step * .45);
  }
  box(shrine, colors.plaster, 0, 2.1, -.5, 3.25, 2.9, 4.55);
  box(shrine, colors.dark, 0, 1.88, 1.81, 1.4, 2.35, .1);
  for (const cx of [-2.85, -1.71, -.57, .57, 1.71, 2.85]) {
    for (const cz of [-3.05, 3.05]) {
      post(shrine, colors.stone, cx, .8, cz, .36, .25);
      post(shrine, colors.cream, cx, 2.19, cz, .24, 2.65);
      post(shrine, colors.plaster, cx, 3.49, cz, .33, .2);
      box(shrine, colors.cream, cx, 3.66, cz, .72, .2, .72);
    }
  }
  for (const cx of [-2.85, 2.85]) {
    for (const cz of [-1.52, 0, 1.52]) {
      post(shrine, colors.stone, cx, .8, cz, .36, .25);
      post(shrine, colors.cream, cx, 2.19, cz, .24, 2.65);
      box(shrine, colors.cream, cx, 3.61, cz, .72, .3, .72);
    }
  }
  box(shrine, colors.cream, 0, 3.92, 0, 6.75, .37, 7.2);
  box(shrine, colors.blue, 0, 4.1, 3.63, 6.6, .21, .12);
  for (let cx = -2.9; cx < 3; cx += .58) box(shrine, colors.gold, cx, 4.1, 3.71, .12, .18, .07);
  roof(shrine, 7.25, 7.8, 4.23, 1.55);
  const pediment = new T.Shape();
  pediment.moveTo(-3.12, 0);
  pediment.lineTo(3.12, 0);
  pediment.lineTo(0, 1.28);
  pediment.closePath();
  mesh(shrine, new T.ShapeGeometry(pediment), colors.cream, 0, 4.28, 3.915);
  const medallion = post(shrine, colors.gold, 0, 4.74, 3.95, .29, .08);
  medallion.rotation.x = Math.PI / 2;
  for (const cx of [-3.45, 0, 3.45]) {
    const top = cx === 0 ? 6 : 4.52;
    lump(shrine, colors.gold, cx, top, 0, .15, .31, .15);
  }
}

export function stall(parent: T.Object3D, x: number, y: number, z: number, color: number, stock = 3): void {
  const shop = group(parent, x, y, z);
  box(shop, colors.wood, 0, .49, 0, 1.9, .85, 1.05);
  box(shop, colors.plaster, 0, .94, 0, 2.05, .12, 1.13);
  for (const px of [-.95, .95]) {
    for (const pz of [-.48, .6]) post(shop, colors.wood, px, 1.05, pz, .05, 2.1);
  }
  for (let stripe = 0; stripe < 7; stripe++) {
    const cloth = box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 2.04, .03, .31, .07, 1.5, .025);
    cloth.rotation.x = .12;
    box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 1.88, .78, .31, .2, .06);
  }
  for (let i = 0; i < 3; i++) {
    box(shop, colors.wood, -.6 + i * .6, 1.07, 0, .5, .16, .7);
    if (i >= stock) continue;
    for (let j = 0; j < 3; j++) lump(shop, i === 1 ? colors.olive : colors.gold, -.65 + i * .6 + j % 2 * .15, 1.23, -.18 + j * .15, .12, .12, .12);
  }
}
