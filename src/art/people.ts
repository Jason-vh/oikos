import * as T from 'three';
import { bake, box, colors, group, lump, post, pot } from './primitives';

export type Load = 'none' | 'jar' | 'bundle';

export interface Figure {
  root: T.Group;
  legs: [T.Group, T.Group];
  arms: [T.Group, T.Group];
}

export function figure(color: number, load: Load = 'none'): Figure {
  const root = new T.Group();
  const body = new T.Group();
  body.rotation.order = 'YXZ';
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
    arm.rotation.order = 'YXZ';
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

const TOOL_NAME = 'tool';
const GRIP = new T.Vector3(0, -.34, 0);
const SHOULDER = { x: .21, y: .67, z: .02 };
const HAND_SPAN = .13;
const TUCK = .9;
const holding = new T.Vector3();
const offhand = new T.Vector3();
const along = new T.Vector3();

function setShoulder(arm: T.Object3D, side: number, twist: number): void {
  const x = side * SHOULDER.x;
  arm.position.set(x * Math.cos(twist) + SHOULDER.z * Math.sin(twist), SHOULDER.y, SHOULDER.z * Math.cos(twist) - x * Math.sin(twist));
}

function aimArm(arm: T.Object3D, target: T.Vector3): void {
  offhand.copy(target).sub(arm.position);
  const span = Math.max(1e-4, offhand.length());
  arm.rotation.set(Math.acos(Math.min(1, Math.max(-1, -offhand.y / span))), Math.atan2(-offhand.x, -offhand.z), 0);
}

function holdTool(model: T.Object3D, pitch: number, twist = 0, bothHands = false): void {
  const tool = model.children[5];
  if (tool?.name !== TOOL_NAME) return;
  const backHand = model.children[2];
  tool.rotation.set(pitch, twist, 0);
  holding.copy(GRIP).applyEuler(backHand.rotation).add(backHand.position);
  tool.position.copy(holding);
  if (!bothHands) return;
  along.set(0, HAND_SPAN, 0).applyEuler(tool.rotation).add(holding);
  aimArm(model.children[4], along);
}

function toolAt(): T.Group {
  const tool = new T.Group();
  tool.name = TOOL_NAME;
  tool.rotation.order = 'YXZ';
  return tool;
}

export function axe(): T.Group {
  const tool = toolAt();
  post(tool, colors.wood, 0, .36, 0, .027, .92);
  post(tool, colors.wood, 0, -.13, 0, .036, .1);
  const head = group(tool, 0, .79, 0);
  box(head, colors.stone, -.045, 0, 0, .09, .15, .075, .015);
  box(head, colors.stone, .145, -.01, 0, .25, .2, .05, .015);
  bake(tool);
  return tool;
}

export function spear(): T.Group {
  const tool = toolAt();
  post(tool, colors.wood, 0, .28, 0, .023, 1.44);
  post(tool, colors.wood, 0, .9, 0, .032, .09);
  box(tool, colors.stone, 0, 1.08, 0, .05, .26, .045, .02);
  bake(tool);
  return tool;
}

const TORSO_TWIST = .15;
const WALK_PITCH = .09;

export function animateFigure(model: T.Object3D, phase: number, stride: number, bounce = 1): void {
  const [body, leftLeg, leftArm, rightLeg, rightArm] = model.children;
  const swing = Math.sin(phase) * stride;
  const twist = -swing * TORSO_TWIST;
  setShoulder(leftArm, -1, 0);
  setShoulder(rightArm, 1, 0);
  leftLeg.rotation.set(swing, 0, 0);
  rightLeg.rotation.set(-swing, 0, 0);
  leftArm.rotation.set(-swing * .7, 0, 0);
  rightArm.rotation.set(swing * .7, 0, 0);
  body.rotation.set(stride * WALK_PITCH, twist, 0);
  body.position.set(0, Math.abs(Math.cos(phase)) * .035 * bounce * (stride / .6), 0);
  holdTool(model, .16 - swing * .22);
}

interface WorkPose { arms: number; blade: number; swing: number; pitch: number; lean: number; lift: number; brace: number; }

export const CHOP_SET = .94;
export const CHOP_HEAD = new T.Vector3(.145, .79, 0);

const READY: WorkPose = { arms: -1.18, blade: 1.78, swing: .68, pitch: .12, lean: .05, lift: 0, brace: 0 };
const RAISED: WorkPose = { arms: -1.24, blade: .88, swing: -1.95, pitch: -.12, lean: -.16, lift: .05, brace: -.07 };
const STRUCK: WorkPose = { arms: -1.16, blade: 1.9, swing: .75, pitch: .2, lean: .12, lift: -.03, brace: .13 };
const RECOIL: WorkPose = { arms: -1.22, blade: 1.72, swing: .56, pitch: .16, lean: .07, lift: -.01, brace: .05 };

const GUARD: WorkPose = { arms: -.98, blade: 1.34, swing: -.2, pitch: .06, lean: .03, lift: 0, brace: .04 };
const COILED: WorkPose = { arms: -.6, blade: 1.02, swing: -.64, pitch: -.13, lean: -.08, lift: .03, brace: -.08 };
const DRIVEN: WorkPose = { arms: -1.62, blade: 1.68, swing: .04, pitch: .34, lean: .06, lift: -.05, brace: .2 };
const HELD: WorkPose = { arms: -1.42, blade: 1.6, swing: .02, pitch: .24, lean: .05, lift: -.02, brace: .13 };

type Ease = (t: number) => number;

const linear: Ease = (t) => t;
const smooth: Ease = (t) => t * t * (3 - 2 * t);
const easeIn: Ease = (t) => t * t;
const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t);

interface Key { at: number; pose: WorkPose; ease?: Ease; lands?: boolean; }
interface Cycle { period: number; keys: Key[]; }

const CHOP: Cycle = {
  period: 1.05,
  keys: [
    { at: 0, pose: READY, ease: smooth },
    { at: .38, pose: RAISED },
    { at: .5, pose: RAISED, ease: easeIn },
    { at: .58, pose: STRUCK, ease: easeOut, lands: true },
    { at: .72, pose: RECOIL, ease: smooth },
    { at: 1, pose: READY },
  ],
};

const THRUST: Cycle = {
  period: .95,
  keys: [
    { at: 0, pose: GUARD, ease: smooth },
    { at: .42, pose: COILED },
    { at: .52, pose: COILED, ease: easeIn },
    { at: .62, pose: DRIVEN, ease: easeOut, lands: true },
    { at: .78, pose: HELD, ease: smooth },
    { at: 1, pose: GUARD },
  ],
};

function poseAt(cycle: Cycle, elapsed: number, out: WorkPose): WorkPose {
  const spin = elapsed / cycle.period;
  const phase = spin - Math.floor(spin);
  let index = 0;
  while (index + 2 < cycle.keys.length && cycle.keys[index + 1].at <= phase) index++;
  const from = cycle.keys[index];
  const to = cycle.keys[index + 1];
  const t = (from.ease ?? linear)((phase - from.at) / (to.at - from.at));
  out.arms = from.pose.arms + (to.pose.arms - from.pose.arms) * t;
  out.blade = from.pose.blade + (to.pose.blade - from.pose.blade) * t;
  out.swing = from.pose.swing + (to.pose.swing - from.pose.swing) * t;
  out.pitch = from.pose.pitch + (to.pose.pitch - from.pose.pitch) * t;
  out.lean = from.pose.lean + (to.pose.lean - from.pose.lean) * t;
  out.lift = from.pose.lift + (to.pose.lift - from.pose.lift) * t;
  out.brace = from.pose.brace + (to.pose.brace - from.pose.brace) * t;
  return out;
}

function landingsBy(cycle: Cycle, elapsed: number): number {
  const lands = cycle.keys.find((key) => key.lands)!.at * cycle.period;
  return Math.max(0, Math.floor((elapsed - lands) / cycle.period) + 1);
}

export function workPeriod(kind: 'chop' | 'thrust'): number {
  return (kind === 'chop' ? CHOP : THRUST).period;
}

export function chopStrikes(elapsed: number): number {
  return landingsBy(CHOP, elapsed);
}

const working: WorkPose = { arms: 0, blade: 0, swing: 0, pitch: 0, lean: 0, lift: 0, brace: 0 };

export function animateWork(model: T.Object3D, elapsed: number, kind: 'chop' | 'thrust'): void {
  const [body, leftLeg, leftArm, rightLeg, rightArm] = model.children;
  const pose = poseAt(kind === 'chop' ? CHOP : THRUST, elapsed, working);
  leftLeg.rotation.set(.2 + pose.brace, pose.swing * .3, 0);
  rightLeg.rotation.set(-.17 - pose.brace * .6, pose.swing * .3, 0);
  body.rotation.set(pose.pitch, pose.swing, pose.lean);
  body.position.set(0, pose.lift, 0);
  setShoulder(rightArm, 1, pose.swing);
  setShoulder(leftArm, -1, pose.swing);
  leftArm.rotation.set(pose.arms, pose.swing + TUCK, 0);
  holdTool(model, pose.blade, pose.swing, true);
}

const HAUL_REACH = .34;
const HAUL_TWIST = .3;

export function animateHauling(model: T.Object3D, phase: number, stride: number, bounce = 1): void {
  animateFigure(model, phase, stride, bounce);
  const [body, , leftArm, , rightArm] = model.children;
  leftArm.rotation.set(HAUL_REACH, 0, 0);
  rightArm.rotation.set(HAUL_REACH, 0, 0);
  body.rotation.y *= HAUL_TWIST;
}

export type Idle = 'breathe' | 'shift' | 'stretch';

export function animateIdle(model: T.Object3D, spent: number, mood: Idle): void {
  const [body, leftLeg, leftArm, rightLeg, rightArm] = model.children;
  const breath = Math.sin(spent * 1.6) * .012;
  setShoulder(leftArm, -1, 0);
  setShoulder(rightArm, 1, 0);
  body.rotation.set(0, 0, 0);
  body.position.set(0, breath, 0);
  leftLeg.rotation.set(0, 0, 0);
  rightLeg.rotation.set(0, 0, 0);
  leftArm.rotation.set(0, 0, 0);
  rightArm.rotation.set(0, 0, 0);
  if (mood === 'shift') {
    const lean = Math.sin(spent * .9);
    body.rotation.z = lean * .07;
    body.position.y = breath - Math.abs(lean) * .012;
    leftLeg.rotation.x = lean * .1;
    rightLeg.rotation.x = -lean * .1;
    leftArm.rotation.x = -lean * .12;
    rightArm.rotation.x = lean * .12;
  } else if (mood === 'stretch') {
    const reach = Math.max(0, Math.sin(spent * 1.4));
    body.rotation.x = -reach * .22;
    body.position.y = breath + reach * .03;
    leftArm.rotation.x = -reach * 2.1;
    rightArm.rotation.x = -reach * 2.1;
  }
  holdTool(model, .14);
}
