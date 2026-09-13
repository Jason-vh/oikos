import * as T from 'three';
import type { Stores } from '../sim/types';
import { box, colors, group, lump, post, roof } from './primitives';
import { bundle, bundlesOf } from './food';

const QUAY_BACK = -3.05;
const QUAY_FRONT = -.62;
const PIER_END = 3.02;
const DECK_Y = .2;
const WATERLINE = -.06;

const DOCK_SLOTS: [number, number][] = [[-.72, -1.15], [-.72, -1.95]];

function stackedLumber(dock: T.Group, stores: Stores): void {
  bundlesOf(stores, DOCK_SLOTS.length).forEach((food, index) => {
    const [x, z] = DOCK_SLOTS[index];
    bundle(dock, food, x, DECK_Y + .07, z, index);
  });
}

function quay(dock: T.Group, improved: boolean): void {
  const surface = improved ? colors.paving : colors.wood;
  const edge = improved ? colors.stone : colors.wood;
  const depth = QUAY_FRONT - QUAY_BACK;
  const centre = (QUAY_FRONT + QUAY_BACK) / 2;
  box(dock, edge, 0, .09, centre, 2.34, .18, depth);
  box(dock, surface, 0, DECK_Y, centre, 2.2, .05, depth - .14);
}

function pier(dock: T.Group, improved: boolean): void {
  const depth = PIER_END - QUAY_FRONT;
  const centre = (PIER_END + QUAY_FRONT) / 2;
  box(dock, colors.wood, 0, DECK_Y - .06, centre, 1.28, .1, depth);
  box(dock, improved ? colors.paving : colors.wood, 0, DECK_Y, centre, 1.16, .05, depth - .1);
  for (let index = 0; index < 4; index++) {
    const z = QUAY_FRONT + .5 + index * (depth - .8) / 3;
    for (const x of [-.52, .52]) post(dock, colors.wood, x, (DECK_Y + WATERLINE) / 2 - .08, z, .07, DECK_Y - WATERLINE + .18);
  }
  for (const z of [QUAY_FRONT + .55, PIER_END - .35]) {
    for (const x of [-.5, .5]) post(dock, colors.wood, x, DECK_Y + .14, z, .07, .28);
  }
}

function timberShed(dock: T.Group): void {
  const shed = group(dock, .62, 0, -1.6);
  box(shed, colors.wood, 0, DECK_Y + .16, 0, .82, .3, 1.1);
  box(shed, colors.roofDark, 0, DECK_Y + .36, 0, .9, .1, 1.18);
}

function warehouse(dock: T.Group): void {
  const shed = group(dock, .48, 0, -2.15);
  box(shed, colors.stone, 0, DECK_Y + .08, 0, 1.24, .16, 1.42);
  box(shed, colors.plaster, 0, DECK_Y + .58, 0, 1.06, .84, 1.24, .05);
  box(shed, colors.cream, 0, DECK_Y + 1.03, 0, 1.16, .1, 1.34);
  roof(shed, 1.2, 1.34, DECK_Y + 1.1, .34, colors.roofDark);
  box(shed, colors.dark, 0, DECK_Y + .44, .64, .4, .64, .05);
}

function crane(dock: T.Group): void {
  const rig = group(dock, -.66, 0, -1.0);
  for (const side of [-1, 1]) {
    const leg = post(rig, colors.wood, 0, DECK_Y + .66, side * .22, .05, 1.3);
    leg.rotation.x = side * .26;
  }
  post(rig, colors.wood, 0, DECK_Y + 1.24, 0, .05, .08);
  post(rig, colors.linen, 0, DECK_Y + .92, .24, .015, .68);
  lump(rig, colors.stone, 0, DECK_Y + .5, .4, .12, .1, .11);
}

function ship(scale: number, z: number): T.Group {
  const vessel = new T.Group();
  box(vessel, colors.wood, 0, .15, 0, .4, .22, .95);
  lump(vessel, colors.wood, 0, .15, .48, .17, .12, .14);
  post(vessel, colors.wood, 0, .58, -.12, .028, .78);
  box(vessel, colors.blue, .012, .84, -.02, .28, .4, .025);
  box(vessel, colors.linen, -.012, .84, -.2, .28, .4, .025);
  vessel.scale.setScalar(scale);
  vessel.position.set(-.78, WATERLINE, z);
  return vessel;
}

export function harbour(tier: 1 | 2, stage: 0 | 1 | 2 | 3, stores: Stores): T.Group {
  const dock = new T.Group();
  const improved = tier === 2;
  quay(dock, improved);
  pier(dock, improved);
  stackedLumber(dock, stores);
  if (improved) {
    warehouse(dock);
    crane(dock);
  } else {
    timberShed(dock);
  }
  if (stage !== 2) {
    const docked = stage === 0;
    dock.add(ship(docked ? .8 : .45, docked ? 1.5 : 2.6));
  }
  return dock;
}
