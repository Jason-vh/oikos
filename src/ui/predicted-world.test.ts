import { expect, test } from 'bun:test';
import { createWorld } from '../sim/world';
import { primaryCity } from '../sim/city';
import { spotFor } from '../sim/testing';
import { serializeWorld, deserializeWorld } from '../sim/save';
import { PredictedWorld } from './predicted-world';

function fixture() {
  const world = createWorld(1, 0);
  const city = primaryCity(world);
  const spot = spotFor(world, 'house')!;
  return { world, cityId: city.id, spot };
}

test('an unpredicted view is the authoritative world itself', () => {
  const { world } = fixture();
  const predicted = new PredictedWorld(world);
  expect(predicted.world).toBe(world);
  expect(predicted.predicting).toBe(false);
});

test('a predicted command shows its building and its cost without touching the authority', () => {
  const { world, cityId, spot } = fixture();
  const before = serializeWorld(world);
  const predicted = new PredictedWorld(world);
  predicted.predict(cityId, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
  const city = predicted.world.cities[0];
  expect(city.buildings.some((building) => building.x === spot.x && building.z === spot.z)).toBe(true);
  expect(city.money).toBeLessThan(world.cities[0].money);
  expect(serializeWorld(world)).toBe(before);
  expect(predicted.predicting).toBe(true);
});

test('wildlife is shared with the authoritative world rather than copied', () => {
  const { world, cityId, spot } = fixture();
  const predicted = new PredictedWorld(world);
  predicted.predict(cityId, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
  expect(predicted.world.wildlife).toBe(world.wildlife);
});

test('a newer snapshot keeps an unresolved prediction until it is discarded', () => {
  const { world, cityId, spot } = fixture();
  const predicted = new PredictedWorld(world);
  predicted.predict(cityId, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
  const advanced = deserializeWorld(serializeWorld(world))!;
  advanced.time += 5;
  predicted.sync(advanced);
  expect(predicted.world.time).toBe(advanced.time);
  expect(predicted.world.cities[0].buildings).toHaveLength(1);
  predicted.discard();
  expect(predicted.world).toBe(advanced);
});

test('a prediction the world has outgrown leaves the authoritative state alone', () => {
  const { world, cityId, spot } = fixture();
  const predicted = new PredictedWorld(world);
  predicted.predict(cityId, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
  const taken = deserializeWorld(serializeWorld(predicted.world))!;
  predicted.sync(taken);
  expect(predicted.world.cities[0].buildings).toHaveLength(1);
  expect(predicted.world.cities[0].money).toBe(taken.cities[0].money);
});

test('a command that fails here is not predicted at all', () => {
  const { world, cityId } = fixture();
  const predicted = new PredictedWorld(world);
  expect(predicted.predict(cityId, { type: 'build', tool: 'house', x: 0, z: 0, rotation: 0 })).toBe(false);
  expect(predicted.predicting).toBe(false);
  expect(predicted.world).toBe(world);
});

test('discarding returns the view to the authority', () => {
  const { world, cityId, spot } = fixture();
  const predicted = new PredictedWorld(world);
  predicted.predict(cityId, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
  predicted.discard();
  expect(predicted.world).toBe(world);
  expect(predicted.predicting).toBe(false);
});
