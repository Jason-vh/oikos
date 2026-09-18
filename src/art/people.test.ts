import { expect, test } from 'bun:test';
import * as T from 'three';
import { animateFigure, animateIdle, animateWork, axe, chopStrikes, CHOP_HEAD, CHOP_SET, citizen, figure, spear, workPeriod } from './people';

function parts(model: T.Object3D) {
  const [body, leftLeg, leftArm] = model.children;
  return {
    lean: Number(body.rotation.z.toFixed(5)),
    pitch: Number(body.rotation.x.toFixed(5)),
    lift: Number(body.position.y.toFixed(5)),
    leg: Number(leftLeg.rotation.x.toFixed(5)),
    arm: Number(leftArm.rotation.x.toFixed(5)),
  };
}

function woodcutter(): T.Group {
  const model = figure(0x8a5a3a, 'none').root;
  model.add(axe());
  return model;
}

function hunter(): T.Group {
  const model = figure(0x6f5a3c, 'none').root;
  model.add(spear());
  return model;
}

test('an idle figure breathes without walking', () => {
  const model = citizen(0xb2c7bb, false);
  animateIdle(model, 0, 'breathe');
  const still = parts(model);
  animateIdle(model, 1.1, 'breathe');
  const later = parts(model);
  expect(later.lift).not.toBe(still.lift);
  expect(later.leg).toBe(0);
  expect(later.arm).toBe(0);
});

test('shifting weight leans and moves the legs; stretching raises the arms', () => {
  const model = citizen(0xb2c7bb, false);
  animateIdle(model, 1.7, 'shift');
  const shifted = parts(model);
  expect(Math.abs(shifted.lean)).toBeGreaterThan(0);
  expect(Math.abs(shifted.leg)).toBeGreaterThan(0);

  animateIdle(model, 1.1, 'stretch');
  const stretched = parts(model);
  expect(stretched.arm).toBeLessThan(-1);
  expect(stretched.pitch).toBeLessThan(0);
});

test('idling leaves nothing of the walk behind it', () => {
  const model = citizen(0xb2c7bb, false);
  animateFigure(model, 2, .55);
  animateIdle(model, .3, 'breathe');
  const [, leftLeg, leftArm, rightLeg, rightArm] = model.children;
  for (const limb of [leftLeg, leftArm, rightLeg, rightArm]) expect(limb.rotation.x).toBe(0);
});

test('a cycle closes on itself: a whole swing later he stands exactly as he began', () => {
  const model = woodcutter();
  const [body] = model.children;
  const tool = model.children[5];
  const frame = () => [body.rotation.y, body.position.y, tool.rotation.x, tool.rotation.y];
  animateWork(model, 0, 'chop');
  const opening = frame();
  for (const swings of [1, 3, 7]) {
    animateWork(model, workPeriod('chop') * swings, 'chop');
    expect(frame()).toEqual(opening);
  }
});

test('two workers side by side are never in step, and each still strikes once a swing', () => {
  const alone = woodcutter();
  const beside = woodcutter();
  const drift = .37;
  animateWork(alone, 2, 'chop');
  animateWork(beside, 2 + drift, 'chop');
  expect(beside.children[5].rotation.y).not.toBeCloseTo(alone.children[5].rotation.y, 3);

  for (const spent of [1, 2, 3, 4]) {
    expect(chopStrikes(spent + drift) - chopStrikes(drift)).toBe(chopStrikes(spent));
  }
});

test('a chop swings without a break, however finely it is sampled', () => {
  const model = woodcutter();
  const [, , , , rightArm] = model.children;
  const blade = model.children[5];
  let armStep = 0;
  let pitchStep = 0;
  let swingStep = 0;
  let previousArm = 0;
  let previousPitch = 0;
  let previousSwing = 0;
  for (let step = 0; step <= 2000; step++) {
    animateWork(model, step / 1000, 'chop');
    if (step > 0) {
      armStep = Math.max(armStep, Math.abs(rightArm.rotation.x - previousArm));
      pitchStep = Math.max(pitchStep, Math.abs(blade.rotation.x - previousPitch));
      swingStep = Math.max(swingStep, Math.abs(blade.rotation.y - previousSwing));
    }
    previousArm = rightArm.rotation.x;
    previousPitch = blade.rotation.x;
    previousSwing = blade.rotation.y;
  }
  expect(armStep).toBeLessThan(.2);
  expect(pitchStep).toBeLessThan(.25);
  expect(swingStep).toBeLessThan(.3);
});

test('the swing is carried by the torso: the arms barely move against it', () => {
  const model = woodcutter();
  const [body, , backArm] = model.children;
  const blade = model.children[5];
  let twistLow = Infinity;
  let twistHigh = -Infinity;
  let shoulderDrift = 0;
  let first: number | null = null;
  for (let step = 0; step <= 1000; step++) {
    animateWork(model, step / 1000, 'chop');
    twistLow = Math.min(twistLow, body.rotation.y);
    twistHigh = Math.max(twistHigh, body.rotation.y);
    const againstTorso = backArm.rotation.y - body.rotation.y;
    first ??= againstTorso;
    shoulderDrift = Math.max(shoulderDrift, Math.abs(againstTorso - first));
    expect(blade.rotation.y).toBeCloseTo(body.rotation.y, 5);
  }
  expect(twistHigh - twistLow).toBeGreaterThan(2.5);
  expect(shoulderDrift).toBeLessThan(1e-9);
  expect(chopStrikes(0)).toBe(0);
  expect(chopStrikes(1)).toBe(1);
  expect(chopStrikes(4)).toBe(4);
});

test('a thrust drives the spear forward without a break, and never points it backwards', () => {
  const model = hunter();
  const [, , , , rightArm] = model.children;
  const shaft = model.children[5];
  let pitchStep = 0;
  let yawStep = 0;
  let armStep = 0;
  let previous = { pitch: 0, yaw: 0, arm: 0 };
  let lowest = Infinity;
  let highest = -Infinity;
  for (let step = 0; step <= 2000; step++) {
    animateWork(model, step / 1000, 'thrust');
    if (step > 0) {
      pitchStep = Math.max(pitchStep, Math.abs(shaft.rotation.x - previous.pitch));
      yawStep = Math.max(yawStep, Math.abs(shaft.rotation.y - previous.yaw));
      armStep = Math.max(armStep, Math.abs(rightArm.rotation.x - previous.arm));
    }
    previous = { pitch: shaft.rotation.x, yaw: shaft.rotation.y, arm: rightArm.rotation.x };
    lowest = Math.min(lowest, shaft.rotation.x);
    highest = Math.max(highest, shaft.rotation.x);
  }
  expect(pitchStep).toBeLessThan(.15);
  expect(yawStep).toBeLessThan(.15);
  expect(armStep).toBeLessThan(.2);
  expect(lowest).toBeGreaterThan(0);
  expect(highest).toBeLessThan(Math.PI / 2 + 1);
});

test('the hunter reaches further at the moment of the thrust than at his guard', () => {
  const model = hunter();
  const shaft = model.children[5];
  const tipReach = () => {
    const tip = new T.Vector3(0, 1.06, 0).applyEuler(shaft.rotation).add(shaft.position);
    return tip.z;
  };
  animateWork(model, 0, 'thrust');
  const guard = tipReach();
  animateWork(model, .62 * .95, 'thrust');
  expect(tipReach()).toBeGreaterThan(guard);
  expect(tipReach()).toBeGreaterThan(1);
});

test('both hands are on the haft, a little apart, whatever he is doing', () => {
  const model = woodcutter();
  const [, , backArm, , foreArm] = model.children;
  const tool = model.children[5];
  const handOf = (arm: T.Object3D) => new T.Vector3(0, -.34, 0).applyEuler(arm.rotation).add(arm.position);
  for (const pose of [() => animateWork(model, .61, 'chop'), () => animateWork(model, .3, 'chop'), () => animateFigure(model, 1.2, .55), () => animateIdle(model, .4, 'shift')]) {
    pose();
    expect(tool.position.distanceTo(handOf(backArm))).toBeLessThan(1e-6);
  }

  for (const at of [0, .2, .42, .61, .9]) {
    animateWork(model, at, 'chop');
    const haft = new T.Vector3(0, 1, 0).applyEuler(tool.rotation);
    const offhand = handOf(foreArm).sub(tool.position);
    const along = offhand.dot(haft);
    expect(along).toBeGreaterThan(.04);
    expect(offhand.sub(haft.multiplyScalar(along)).length()).toBeLessThan(.06);
  }
});

test('the blade lands where the walker is aimed, within the reach he steps up to', () => {
  const model = woodcutter();
  model.scale.setScalar(.83);
  const tool = model.children[5];
  let landing = 0;
  while (chopStrikes(landing) === 0) landing += .001;
  animateWork(model, landing, 'chop');
  model.updateWorldMatrix(true, true);
  const head = CHOP_HEAD.clone().applyMatrix4(tool.matrixWorld);
  expect(Math.atan2(head.x, head.z)).toBeCloseTo(CHOP_SET, 1);
  expect(Math.hypot(head.x, head.z)).toBeGreaterThan(.8);
  expect(Math.hypot(head.x, head.z)).toBeLessThan(1.05);
  expect(head.y).toBeGreaterThan(0);
  expect(head.y).toBeLessThan(.45);
});

test('walking and idling put the work pose down again', () => {
  const model = woodcutter();
  const [body] = model.children;
  const blade = model.children[5];
  animateWork(model, .58, 'chop');
  const struck = blade.rotation.x;
  expect(body.rotation.y).not.toBe(0);
  expect(body.rotation.z).not.toBe(0);
  animateFigure(model, 1.2, .55);
  for (const angle of body.rotation.toArray().slice(0, 3) as number[]) expect(Math.abs(angle)).toBeLessThan(.12);
  expect(blade.rotation.x).not.toBe(struck);
  expect(blade.rotation.y).toBe(0);
  animateIdle(model, .4, 'breathe');
  expect(blade.rotation.x).toBe(.14);
  expect(blade.rotation.y).toBe(0);
});

test('a cart or a companion is never mistaken for a held tool', () => {
  const model = citizen(0xb2c7bb, false);
  const cart = new T.Group();
  model.add(cart);
  animateIdle(model, .4, 'breathe');
  animateFigure(model, 1.1, .55);
  expect(cart.rotation.x).toBe(0);
});

test('the same person idles the same way twice, and two people differently', () => {
  const one = citizen(0xb2c7bb, false);
  const other = citizen(0xb2c7bb, false);
  animateIdle(one, 2.4, 'shift');
  const first = parts(one);
  animateIdle(one, 2.4, 'shift');
  expect(parts(one)).toEqual(first);
  animateIdle(other, 2.4, 'stretch');
  expect(parts(other)).not.toEqual(first);
});

test('a walking torso turns against the legs and stands square when still', () => {
  const model = citizen(0xb2c7bb, false);
  const [body, leftLeg] = model.children;
  animateFigure(model, Math.PI / 2, .55);
  expect(leftLeg.rotation.x).toBeGreaterThan(0);
  expect(body.rotation.y).toBeLessThan(0);
  animateFigure(model, -Math.PI / 2, .55);
  expect(leftLeg.rotation.x).toBeLessThan(0);
  expect(body.rotation.y).toBeGreaterThan(0);
  animateFigure(model, 1.2, 0);
  expect(body.rotation.y).toBeCloseTo(0, 12);
  expect(body.rotation.z).toBeCloseTo(0, 12);
  expect(body.position.x).toBeCloseTo(0, 12);
});
