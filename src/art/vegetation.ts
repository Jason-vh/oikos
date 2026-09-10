import * as T from 'three';
import { box, colors, group, lump, post, roof } from './primitives';
import { assemblyPart, modelAssembly, type ModelAssembly } from './assembly';

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

function farmShed(parent: T.Object3D): void {
  const shed = group(parent, -1.35, 0, -1.55);
  box(shed, colors.stone, 0, .08, 0, 1.55, .16, 1.3);
  box(shed, colors.plaster, 0, .5, 0, 1.25, .74, 1.05, .06);
  roof(shed, 1.4, 1.2, .87, .32, colors.roofDark);
  box(shed, colors.wood, 0, .42, .53, .55, .68, .08);
  post(shed, colors.wood, -.55, .48, .62, .035, .96);
  post(shed, colors.wood, .55, .48, .62, .035, .96);
  box(shed, colors.dark, 0, .9, .62, 1.15, .05, .05);
}

function farmGround(parent: T.Object3D): void {
  box(parent, colors.earth, .35, .05, .3, 4.1, .1, 3.9, .02);
}

function farmRows(parent: T.Object3D, stage: number): void {
  const height = [0, .12, .22, .26][stage];
  const crop = [colors.oliveLight, colors.oliveLight, 0xc9bd6a, colors.gold][stage];
  for (let row = 0; row < 7; row++) {
    const z = -1.35 + row * .55;
    const width = row < 3 ? 2.35 : 4;
    const x = row < 3 ? 1.15 : .35;
    box(parent, 0xd9c98a, x, .15, z, width, .12, .22, .02);
    if (stage === 0) continue;
    box(parent, crop, x, .21 + height / 2, z, width - .08, height, .18, .03);
    if (stage === 3) box(parent, 0xe6c463, x, .5, z, width - .12, .09, .12, .02);
  }
}

function farmFence(parent: T.Object3D): void {
  box(parent, colors.stone, .35, .12, 2.3, 4.1, .1, .12);
  for (const px of [-1.6, -.35, .9, 2.15]) post(parent, colors.wood, px, .27, 2.3, .035, .48);
  box(parent, colors.wood, .35, .44, 2.3, 4.05, .05, .05);
}

export function wheatFarm(stage = 3): T.Group {
  const plot = new T.Group();
  farmShed(plot);
  farmGround(plot);
  farmRows(plot, stage);
  farmFence(plot);
  return plot;
}

export function wheatFarmPieces(stage: number): ModelAssembly {
  const assembly = modelAssembly(false);
  farmGround(assemblyPart(assembly, { name: 'ground', at: 0, lift: 0, dust: true }));
  farmFence(assemblyPart(assembly, { name: 'fence', at: .16, lift: .2, duration: .26 }));
  farmShed(assemblyPart(assembly, { name: 'shed', at: .34, lift: .34, duration: .32, dust: true }));
  farmRows(assemblyPart(assembly, { name: 'furrows', at: .6, lift: .12, duration: .3 }), stage);
  return assembly;
}
