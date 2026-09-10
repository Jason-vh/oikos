import * as T from 'three';
import { bake, box, colors, group, lump, pot } from './primitives';

export type Load = 'none' | 'jar' | 'bundle';

export interface Figure {
  root: T.Group;
  legs: [T.Group, T.Group];
  arms: [T.Group, T.Group];
}

export function figure(color: number, load: Load = 'none'): Figure {
  const root = new T.Group();
  const body = new T.Group();
  root.add(body);
  box(body, color, 0, .48, 0, .32, .49, .25, .065);
  box(body, colors.linen, 0, .26, 0, .36, .12, .29);
  lump(body, 0xc9966b, 0, .91, .01, .19, .2, .18);
  lump(body, colors.wood, 0, 1.02, -.025, .19, .1, .18);
  if (load === 'bundle') {
    box(body, colors.linen, 0, .78, -.24, .34, .3, .22, .08);
    box(body, colors.roof, 0, .78, -.24, .06, .34, .26, .02);
  }
  bake(body);
  const legs: T.Group[] = [];
  const arms: T.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = group(root, side * .095, .2, .04);
    box(leg, colors.wood, 0, -.1, 0, .115, .2, .19);
    bake(leg);
    legs.push(leg);
    const arm = group(root, side * .21, .67, .02);
    box(arm, 0xc9966b, 0, -.18, 0, .1, .37, .12);
    if (load === 'jar' && side === 1) pot(arm, .11, -.3, .11, 1.05);
    bake(arm);
    arms.push(arm);
  }
  return { root, legs: [legs[0], legs[1]], arms: [arms[0], arms[1]] };
}

export function citizen(color: number, cargo: boolean): T.Group {
  return figure(color, cargo ? 'jar' : 'none').root;
}

export function animateFigure(model: T.Object3D, phase: number, stride: number): void {
  const [body, leftLeg, leftArm, rightLeg, rightArm] = model.children;
  const swing = Math.sin(phase) * stride;
  leftLeg.rotation.x = swing;
  rightLeg.rotation.x = -swing;
  leftArm.rotation.x = -swing * .7;
  rightArm.rotation.x = swing * .7;
  body.position.y = Math.abs(Math.cos(phase)) * .035 * (stride / .6);
}
