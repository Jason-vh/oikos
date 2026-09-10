import * as T from 'three';
import type { AnimalKind } from '../sim/types';
import { bake, box, colors, group, lump } from './primitives';

const HIDE = 0x5c4433;
const HIDE_LIGHT = 0x8a6a4c;
const FUR = 0xb59a7a;
const FUR_LIGHT = 0xd9c4a8;
const SCALE = 0x7d9aa6;
const SCALE_LIGHT = 0xa9c2c8;

export function boar(): T.Group {
  const animal = new T.Group();
  const body = group(animal, 0, 0, 0);
  lump(body, HIDE, 0, .42, 0, .34, .3, .55);
  lump(body, HIDE_LIGHT, 0, .55, -.05, .22, .14, .4);
  lump(body, HIDE, 0, .4, .38, .2, .2, .22);
  box(body, colors.dark, 0, .33, .55, .1, .07, .06, .02);
  for (const side of [-1, 1]) {
    box(body, colors.cream, side * .07, .3, .5, .03, .09, .03, .01);
    lump(body, HIDE, side * .12, .52, .32, .06, .08, .04);
  }
  box(body, HIDE, 0, .5, -.3, .04, .04, .18, .01);
  bake(body);
  for (const [sx, sz] of [[-.12, .2], [.12, .2], [-.12, -.2], [.12, -.2]]) {
    const leg = group(animal, sx, .26, sz);
    box(leg, HIDE, 0, -.12, 0, .09, .24, .09, .02);
    bake(leg);
  }
  return animal;
}

export function rabbit(): T.Group {
  const animal = new T.Group();
  const body = group(animal, 0, 0, 0);
  lump(body, FUR, 0, .17, 0, .13, .13, .2);
  lump(body, FUR_LIGHT, 0, .12, -.03, .1, .08, .14);
  lump(body, FUR, 0, .27, .14, .09, .09, .1);
  for (const side of [-1, 1]) {
    const ear = box(body, FUR, side * .035, .4, .12, .035, .16, .05, .01);
    ear.rotation.x = -.25;
  }
  lump(body, FUR_LIGHT, 0, .17, -.2, .05, .05, .05);
  bake(body);
  for (const [sx, sz] of [[-.06, .05], [.06, .05], [-.07, -.08], [.07, -.08]]) {
    const leg = group(animal, sx, .08, sz);
    box(leg, FUR, 0, -.04, 0, .05, .08, .06, .01);
    bake(leg);
  }
  return animal;
}

export function fish(): T.Group {
  const animal = new T.Group();
  const body = group(animal, 0, 0, 0);
  lump(body, SCALE, 0, 0, 0, .07, .1, .26);
  lump(body, SCALE_LIGHT, 0, -.03, .02, .05, .06, .2);
  bake(body);
  const tail = group(animal, 0, 0, -.22);
  box(tail, SCALE, 0, 0, -.08, .03, .14, .14, .01);
  bake(tail);
  return animal;
}

export function gull(): T.Group {
  const animal = new T.Group();
  const body = group(animal, 0, 0, 0);
  lump(body, colors.linen, 0, 0, 0, .09, .09, .26);
  lump(body, colors.linen, 0, .04, .16, .07, .07, .08);
  box(body, colors.gold, 0, .03, .25, .03, .03, .08, .01);
  bake(body);
  for (const side of [-1, 1]) {
    const wing = group(animal, side * .06, .03, 0);
    box(wing, colors.linen, side * .22, 0, 0, .44, .03, .14, .01);
    box(wing, 0x9aa0a4, side * .4, 0, -.01, .12, .03, .1, .01);
    bake(wing);
  }
  return animal;
}

export function animalModel(kind: AnimalKind): T.Group {
  switch (kind) {
    case 'boar': return boar();
    case 'rabbit': return rabbit();
    case 'fish': return fish();
    case 'gull': return gull();
  }
}

export function animateAnimal(model: T.Object3D, kind: AnimalKind, phase: number, moving: boolean): void {
  if (kind === 'gull') {
    const [, left, right] = model.children;
    const flap = Math.sin(phase * 6) * .55;
    left.rotation.z = flap;
    right.rotation.z = -flap;
    return;
  }
  if (kind === 'fish') {
    const [body, tail] = model.children;
    tail.rotation.y = Math.sin(phase * 7) * .5;
    body.rotation.y = Math.sin(phase * 7 + 1) * .08;
    model.position.y += Math.sin(phase * 2) * .02;
    return;
  }
  const [body, ...legs] = model.children;
  const stride = moving ? (kind === 'rabbit' ? .9 : .5) : 0;
  legs.forEach((leg, index) => { leg.rotation.x = Math.sin(phase * (kind === 'rabbit' ? 11 : 8) + (index % 2) * Math.PI) * stride; });
  body.position.y = moving ? Math.abs(Math.sin(phase * (kind === 'rabbit' ? 11 : 8))) * (kind === 'rabbit' ? .09 : .03) : 0;
}

