import { expect, test } from 'bun:test';
import * as T from 'three';
import { animateFigure, animateIdle, citizen } from './people';

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
