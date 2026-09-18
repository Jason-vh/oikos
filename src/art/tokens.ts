import * as T from 'three';
import { bake, box, colors, group, lump, pot, post } from './primitives';
import { bundle } from './food';
import type { Errand, Resource } from '../sim/types';

function jar(parent: T.Object3D): void {
  pot(parent, 0, 0, 0, .58, colors.blueLight);
}

function basket(parent: T.Object3D): void {
  box(parent, colors.wood, 0, .12, 0, .34, .22, .32, .05);
  box(parent, colors.wood, 0, .24, 0, .38, .04, .36, .02);
  for (const [dx, dz] of [[-.07, -.04], [.08, -.02], [0, .06]]) {
    post(parent, colors.linen, dx, .21, dz, .05, .2);
    lump(parent, colors.gold, dx, .34, dz, .09, .08, .09);
  }
}

function toolbox(parent: T.Object3D): void {
  box(parent, colors.wood, 0, .11, 0, .4, .22, .28, .04);
  box(parent, colors.stone, 0, .23, 0, .42, .04, .3, .02);
  const handle = post(parent, colors.linen, -.04, .34, .06, .035, .38);
  handle.rotation.z = .42;
  box(parent, colors.dark, .12, .5, .06, .16, .1, .1, .02);
}

function pallet(parent: T.Object3D, resource: Resource): void {
  box(parent, colors.wood, 0, .05, 0, .46, .1, .42, .03);
  const load = group(parent, 0, .1, 0);
  load.scale.setScalar(.62);
  bundle(load, resource, 0, 0, 0, 1);
}

export function errandToken(errand: Errand, resource: Resource | null = null): T.Group {
  const token = new T.Group();
  if (errand === 'goods' && resource) pallet(token, resource);
  else if (errand === 'water') jar(token);
  else if (errand === 'food') basket(token);
  else toolbox(token);
  bake(token);
  return token;
}
