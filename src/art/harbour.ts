import * as T from 'three';
import type { Stores } from '../sim/types';
import { GROUND_Y } from '../sim/island';
import { box, colors, group, lump, post, roof } from './primitives';
import { bundle, bundlesOf } from './food';
import { WATERLINE } from './coast';

const QUAY_BACK = -3.05;
const QUAY_FRONT = -.625;
const QUAY_WIDTH = 2.36;
const QUAY_FOOT = -.5;
const PIER_END = 3.0;
const QUAY_Y = .34;
const DECK_Y = .26;
const SEA_Y = WATERLINE - GROUND_Y;
const POST_TOP = DECK_Y + .04;
const POST_FOOT = SEA_Y - .24;

const DOCK_SLOTS: [number, number][] = [[-.74, -1.2], [-.74, -2.0]];

function stackedLumber(dock: T.Group, stores: Stores): void {
  bundlesOf(stores, DOCK_SLOTS.length).forEach((food, index) => {
    const [x, z] = DOCK_SLOTS[index];
    bundle(dock, food, x, QUAY_Y + .07, z, index);
  });
}

function quay(dock: T.Group, improved: boolean): void {
  const depth = QUAY_FRONT - QUAY_BACK;
  const centre = (QUAY_FRONT + QUAY_BACK) / 2;
  box(dock, improved ? colors.stone : colors.wood, 0, (QUAY_Y + QUAY_FOOT) / 2, centre, QUAY_WIDTH, QUAY_Y - QUAY_FOOT, depth);
  box(dock, improved ? colors.paving : colors.cream, 0, QUAY_Y, centre, QUAY_WIDTH - .16, .06, depth - .16);
  for (const z of [QUAY_FRONT - .35, QUAY_BACK + .45]) {
    for (const x of [-.95, .95]) post(dock, colors.wood, x, QUAY_Y + .13, z, .09, .26);
  }
}

function pier(dock: T.Group, improved: boolean): void {
  const depth = PIER_END - QUAY_FRONT;
  const centre = (PIER_END + QUAY_FRONT) / 2;
  box(dock, colors.wood, .18, DECK_Y - .07, centre, 1.02, .12, depth);
  box(dock, improved ? colors.paving : colors.cream, .18, DECK_Y, centre, .9, .05, depth - .12);
  for (const z of [QUAY_FRONT + .35, QUAY_FRONT + 1.5, PIER_END - .2]) {
    for (const x of [-.22, .58]) post(dock, colors.wood, x, (POST_TOP + POST_FOOT) / 2, z, .09, POST_TOP - POST_FOOT);
  }
  for (const z of [QUAY_FRONT + .45, PIER_END - .3]) post(dock, colors.wood, -.24, DECK_Y + .17, z, .09, .32);
}

function timberShed(dock: T.Group): void {
  const shed = group(dock, .58, 0, -2.05);
  box(shed, colors.wood, 0, QUAY_Y + .38, 0, .96, .7, 1.3, .05);
  box(shed, colors.cream, 0, QUAY_Y + .74, 0, 1.04, .08, 1.38);
  roof(shed, 1.06, 1.38, QUAY_Y + .78, .3, colors.roofDark);
  box(shed, colors.dark, 0, QUAY_Y + .32, .67, .38, .52, .04);
}

function warehouse(dock: T.Group): void {
  const shed = group(dock, .5, 0, -2.05);
  box(shed, colors.stone, 0, QUAY_Y + .1, 0, 1.3, .2, 1.5);
  box(shed, colors.plaster, 0, QUAY_Y + .62, 0, 1.12, .84, 1.32, .05);
  box(shed, colors.cream, 0, QUAY_Y + 1.07, 0, 1.2, .1, 1.4);
  roof(shed, 1.22, 1.4, QUAY_Y + 1.14, .36, colors.roofDark);
  box(shed, colors.dark, 0, QUAY_Y + .48, .68, .42, .64, .05);
  box(shed, colors.blue, 0, QUAY_Y + .96, .69, .5, .12, .04);
}

function crane(dock: T.Group): void {
  const rig = group(dock, -.7, 0, -.95);
  for (const side of [-1, 1]) {
    const leg = post(rig, colors.wood, 0, QUAY_Y + .68, side * .24, .06, 1.36);
    leg.rotation.x = side * .26;
  }
  post(rig, colors.wood, 0, QUAY_Y + 1.3, 0, .06, .1);
  post(rig, colors.linen, 0, QUAY_Y + .96, .26, .02, .72);
  lump(rig, colors.stone, 0, QUAY_Y + .52, .42, .13, .11, .12);
}

function ship(scale: number, z: number): T.Group {
  const vessel = new T.Group();
  box(vessel, colors.wood, 0, .15, 0, .44, .24, 1.05);
  lump(vessel, colors.wood, 0, .16, .54, .18, .13, .15);
  post(vessel, colors.wood, 0, .64, -.12, .03, .86);
  box(vessel, colors.blue, .014, .92, -.02, .3, .44, .028);
  box(vessel, colors.linen, -.014, .92, -.2, .3, .44, .028);
  vessel.scale.setScalar(scale);
  vessel.position.set(-.8, SEA_Y, z);
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
    dock.add(ship(docked ? .85 : .55, docked ? 1.6 : 2.6));
  }
  return dock;
}
