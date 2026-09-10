import * as T from 'three';
import { box, colors, group, lump, post, roof } from './primitives';

export function tree(parent: T.Object3D, x: number, y: number, z: number, scale = 1, cypress = false): void {
  const plant = group(parent, x, y, z, x * 5 + z);
  plant.scale.setScalar(scale);
  post(plant, colors.wood, 0, .7, 0, .13, 1.4);
  if (cypress) {
    lump(plant, colors.oliveDark, 0, 1.75, 0, .53, 1.45, .53);
    lump(plant, colors.olive, .04, 2.6, 0, .34, .9, .35);
    return;
  }
  const branch = post(plant, colors.wood, .25, 1.3, 0, .09, .9);
  branch.rotation.z = -.55;
  lump(plant, colors.oliveDark, -.4, 1.65, .04, .83, .65, .72);
  lump(plant, colors.olive, .38, 1.9, .12, .91, .72, .83);
  lump(plant, colors.oliveLight, -.05, 2.17, -.27, .75, .61, .76);
}

export function wheatFarm(): T.Group {
  const plot = new T.Group();
  const shed = group(plot, -1.35, 0, -1.55);
  box(shed, colors.stone, 0, .08, 0, 1.55, .16, 1.3);
  box(shed, colors.plaster, 0, .5, 0, 1.25, .74, 1.05, .06);
  roof(shed, 1.4, 1.2, .87, .32, colors.roofDark);
  box(shed, colors.wood, 0, .42, .53, .55, .68, .08);
  post(shed, colors.wood, -.55, .48, .62, .035, .96);
  post(shed, colors.wood, .55, .48, .62, .035, .96);
  box(shed, colors.dark, 0, .9, .62, 1.15, .05, .05);
  for (let row = 0; row < 5; row++) {
    const z = -.85 + row * .68;
    for (let col = 0; col < 6; col++) {
      const x = -1.95 + col * .7;
      const tuft = lump(plot, (row + col) % 3 === 0 ? colors.gold : colors.oliveLight, x, .32, z, .32, .3, .32);
      tuft.rotation.y = (row * 3 + col) * .7;
    }
  }
  box(plot, colors.earth, 0, .06, 1.1, 4.4, .12, .45);
  for (const [px, pz] of [[-2.0, 1.1], [2.0, 1.1]]) post(plot, colors.wood, px, .2, pz, .03, .4);
  return plot;
}
