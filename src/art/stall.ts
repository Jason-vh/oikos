import * as T from 'three';
import type { Stores } from '../sim/types';
import { bundle, bundlesOf } from './food';
import { box, colors, group, post } from './primitives';

export function stallCounter(parent: T.Object3D): void {
  box(parent, colors.wood, 0, .49, 0, 1.9, .85, 1.05);
  box(parent, colors.plaster, 0, .94, 0, 2.05, .12, 1.13);
}

export function stallPosts(parent: T.Object3D): void {
  for (const px of [-.95, .95]) {
    for (const pz of [-.48, .6]) post(parent, colors.wood, px, 1.05, pz, .05, 2.1);
  }
}

export function stallAwning(parent: T.Object3D, color: number): void {
  for (let stripe = 0; stripe < 7; stripe++) {
    const cloth = box(parent, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 2.04, .03, .31, .07, 1.5, .025);
    cloth.rotation.x = .12;
    box(parent, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 1.88, .78, .31, .2, .06);
  }
}

export function stallGoods(parent: T.Object3D, stores: Stores): void {
  const bundles = bundlesOf(stores, 3);
  for (let i = 0; i < 3; i++) {
    box(parent, colors.wood, -.6 + i * .6, 1.07, 0, .5, .16, .7);
    const food = bundles[i];
    if (!food) continue;
    const crate = group(parent, -.6 + i * .6, 1.15, 0);
    crate.scale.setScalar(.95);
    bundle(crate, food, 0, 0, 0, i);
  }
}

export function stall(parent: T.Object3D, x: number, y: number, z: number, color: number, stores: Stores = { wheat: 300 }): void {
  const shop = group(parent, x, y, z);
  stallCounter(shop);
  stallPosts(shop);
  stallAwning(shop, color);
  stallGoods(shop, stores);
}
