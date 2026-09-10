import * as T from 'three';
import { bake, box, colors, lump, pot } from './primitives';

export function citizen(color: number, cargo: boolean): T.Group {
  const person = new T.Group();
  box(person, color, 0, .48, 0, .32, .49, .25, .065);
  box(person, colors.linen, 0, .26, 0, .36, .12, .29);
  lump(person, 0xc9966b, 0, .91, .01, .19, .2, .18);
  lump(person, colors.wood, 0, 1.02, -.025, .19, .1, .18);
  for (const side of [-1, 1]) {
    box(person, 0xc9966b, side * .21, .49, .02, .1, .37, .12);
    box(person, colors.wood, side * .095, .1, .04, .115, .2, .19);
  }
  if (cargo) pot(person, .32, .39, .13, 1.05);
  bake(person);
  return person;
}
