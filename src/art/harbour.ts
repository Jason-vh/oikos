import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, roof } from './primitives';
import { bundle, bundlesOf } from './food';

const DOCK_SLOTS: [number, number][] = [[-1.15, -.65], [-.35, -.65]];

function stackedLumber(dock: T.Group, stores: Stores): void {
  bundlesOf(stores, DOCK_SLOTS.length).forEach((food, index) => {
    const [x, z] = DOCK_SLOTS[index];
    bundle(dock, food, x, .28, z, index);
  });
}

function quay(dock: T.Group, improved: boolean): void {
  const surface = improved ? colors.paving : colors.wood;
  const edge = improved ? colors.stone : colors.wood;
  box(dock, edge, 0, .1, 0, 3.55, .2, 2.15);
  box(dock, surface, 0, .21, 0, 3.4, .04, 2.0);
  for (const x of [-1.55, 1.55]) {
    for (const z of [-.85, .85]) post(dock, colors.wood, x, .32, z, .08, .45);
  }
}

function timberShed(dock: T.Group): void {
  box(dock, colors.wood, .9, .28, -.55, .8, .26, .45);
}

function warehouse(dock: T.Group): void {
  const shed = group(dock, -1.0, 0, -.5);
  box(shed, colors.stone, 0, .1, 0, 1.35, .2, 1.05);
  box(shed, colors.plaster, 0, .58, 0, 1.15, .78, .92, .05);
  box(shed, colors.cream, 0, 1.0, 0, 1.25, .1, 1.0);
  roof(shed, 1.3, 1.0, 1.07, .32, colors.roofDark);
  box(shed, colors.dark, 0, .42, .47, .42, .62, .05);
}

function crane(dock: T.Group): void {
  const rig = group(dock, .95, 0, .05);
  for (const side of [-1, 1]) {
    const leg = post(rig, colors.wood, side * .24, .68, 0, .05, 1.3);
    leg.rotation.z = -side * .26;
  }
  post(rig, colors.wood, 0, 1.24, 0, .05, .08);
  post(rig, colors.linen, 0, .92, .22, .015, .68);
  lump(rig, colors.stone, 0, .5, .38, .12, .1, .11);
}

function ship(scale: number, z: number): T.Group {
  const vessel = new T.Group();
  box(vessel, colors.wood, 0, .15, 0, .4, .22, .95);
  lump(vessel, colors.wood, 0, .15, .48, .17, .12, .14);
  post(vessel, colors.wood, 0, .58, -.12, .028, .78);
  box(vessel, colors.blue, .012, .84, -.02, .28, .4, .025);
  box(vessel, colors.linen, -.012, .84, -.2, .28, .4, .025);
  vessel.scale.setScalar(scale);
  vessel.position.set(0, 0, z);
  return vessel;
}

export function harbour(tier: 1 | 2, stage: 0 | 1 | 2 | 3, stores: Stores): T.Group {
  const dock = new T.Group();
  const improved = tier === 2;
  quay(dock, improved);
  stackedLumber(dock, stores);
  if (improved) {
    warehouse(dock);
    crane(dock);
  } else {
    timberShed(dock);
  }
  if (stage !== 2) {
    const docked = stage === 0;
    dock.add(ship(docked ? .85 : .45, docked ? .3 : .78));
  }
  return dock;
}
