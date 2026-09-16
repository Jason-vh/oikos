import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { islandFor, terrainOn } from './island';
import { SPECIES, alive, animalAt, animalQuarry, killAnimal, wildlifeRoster, wildlifeObstacles, RESPAWN_SECONDS } from './wildlife';
import { spotFor } from './testing';
import { primaryCity } from './city';
import type { Animal, World } from './types';

function place(world: World, animal: Animal, at = world.time) {
  return animalAt(islandFor(world.seed), wildlifeObstacles(world), animal, at);
}

describe('wildlife', () => {
  test('spawns every species in its habitat, deterministically per seed', () => {
    const world = createWorld(1);
    const map = islandFor(1);
    const kinds = new Set(world.wildlife.map((animal) => animal.kind));
    expect([...kinds].sort()).toEqual(['boar', 'fish', 'gull', 'rabbit']);
    for (const animal of world.wildlife) {
      expect(SPECIES[animal.kind].habitat(map, Math.floor(animal.homeX), Math.floor(animal.homeZ))).toBe(true);
    }
    expect(wildlifeRoster(1).map((animal) => [animal.kind, animal.homeX, animal.homeZ])).toEqual(world.wildlife.map((animal) => [animal.kind, animal.homeX, animal.homeZ]));
  });

  test('an animal is wherever the time says, without the world having stepped', () => {
    const world = createWorld(1);
    const animal = world.wildlife.find((candidate) => candidate.kind === 'boar')!;
    const early = place(world, animal, 3);
    const later = place(world, animal, 9);
    expect(Math.hypot(later.x - early.x, later.z - early.z)).toBeGreaterThan(.1);
    expect(place(world, animal, 3)).toEqual(early);
    expect(world.time).toBe(0);
  });

  test('animals wander but stay near home, on ground they can hold, inside the map', () => {
    const world = createWorld(1);
    const map = islandFor(1);
    let moved = 0;
    for (const animal of world.wildlife) {
      let far = 0;
      for (const at of [0, 7, 19, 43, 87, 120]) {
        const { x, z } = place(world, animal, at);
        expect(Math.hypot(x - animal.homeX, z - animal.homeZ)).toBeLessThan(SPECIES[animal.kind].range + 1.5);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(map.width);
        expect(z).toBeLessThanOrEqual(map.depth);
        const terrain = terrainOn(map, Math.floor(x), Math.floor(z));
        if (animal.kind === 'fish') expect(terrain).toBe('water');
        if (animal.kind === 'boar' || animal.kind === 'rabbit') expect(terrain).not.toBe('water');
        far = Math.max(far, Math.hypot(x - animal.homeX, z - animal.homeZ));
      }
      if (far > .5) moved++;
    }
    expect(moved).toBeGreaterThan(world.wildlife.length / 2);
  });

  test('land animals never stand in a building, before or after it is raised', () => {
    const world = createWorld(1);
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    for (const animal of world.wildlife) {
      if (animal.kind === 'fish' || animal.kind === 'gull') continue;
      for (const at of [0, 5, 11, 26, 60]) {
        const { x, z } = place(world, animal, at);
        const inside = x >= spot.x && x < spot.x + 3 && z >= spot.z && z < spot.z + 3;
        expect(inside).toBe(false);
      }
    }
  });

  test('a killed animal is gone until its hour comes round', () => {
    const world = createWorld(1);
    const animal = world.wildlife.find((candidate) => candidate.kind === 'boar')!;
    expect(alive(animal, world.time)).toBe(true);
    const yielded = killAnimal(world, animal);
    expect(yielded).toBe(SPECIES.boar.yield);
    expect(alive(animal, world.time)).toBe(false);
    expect(place(world, animal)).toEqual({ x: animal.homeX, z: animal.homeZ });
    advance(world, RESPAWN_SECONDS + 1);
    expect(alive(animal, world.time)).toBe(true);
    expect(animal.respawnAt).toBeNull();
  });

  test('a cornered animal stands still for its hunter', () => {
    const world = createWorld(1);
    const animal = world.wildlife.find((candidate) => candidate.kind === 'boar')!;
    animal.cornered = true;
    expect(place(world, animal, 4)).toEqual(place(world, animal, 40));
  });

  test('every huntable species declares the food it yields', () => {
    expect(SPECIES.boar.food).toBe('meat');
    expect(SPECIES.rabbit.food).toBe('meat');
    expect(SPECIES.fish.food).toBe('fish');
    expect(SPECIES.gull.food).toBeNull();
  });

  test('quarry names an animal and what it yields, and stays silent for animals worth no food', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    const gull = world.wildlife.find((animal) => animal.kind === 'gull')!;
    expect(animalQuarry(boar)).toEqual({ name: 'Wild boar', yield: SPECIES.boar.yield, food: 'meat' });
    expect(animalQuarry(gull)).toBeNull();
  });
});

describe('rest', () => {
  test('land animals spend most of their time standing still, and walk at their own pace when they move', () => {
    const world = createWorld(1);
    const map = islandFor(world.seed);
    const occupied = wildlifeObstacles(world);
    for (const kind of ['boar', 'rabbit'] as const) {
      const animals = world.wildlife.filter((animal) => animal.kind === kind).slice(0, 60);
      let still = 0;
      let samples = 0;
      let travelled = 0;
      for (const animal of animals) {
        let previous = animalAt(map, occupied, animal, 0);
        for (let at = .1; at < 90; at += .1) {
          const now = animalAt(map, occupied, animal, at);
          const pace = Math.hypot(now.x - previous.x, now.z - previous.z) / .1;
          samples += 1;
          if (pace < .02) still += 1;
          else travelled += pace;
          previous = now;
        }
      }
      expect(still / samples).toBeGreaterThan(.6);
      expect(travelled / (samples - still)).toBeLessThan(SPECIES[kind].speed * 1.6);
    }
  });

  test('gulls never stop, because they are flying', () => {
    const world = createWorld(1);
    const map = islandFor(world.seed);
    const occupied = wildlifeObstacles(world);
    const gull = world.wildlife.find((animal) => animal.kind === 'gull')!;
    let previous = animalAt(map, occupied, gull, 0);
    for (let at = .1; at < 30; at += .1) {
      const now = animalAt(map, occupied, gull, at);
      expect(Math.hypot(now.x - previous.x, now.z - previous.z)).toBeGreaterThan(0);
      previous = now;
    }
  });
});

describe('pace', () => {
  test('no animal ever crosses ground faster than its own speed', () => {
    const world = createWorld(1);
    const map = islandFor(world.seed);
    const occupied = wildlifeObstacles(world);
    for (const kind of ['boar', 'rabbit', 'fish', 'gull'] as const) {
      const species = SPECIES[kind];
      for (const animal of world.wildlife.filter((candidate) => candidate.kind === kind).slice(0, 40)) {
        let previous = animalAt(map, occupied, animal, 0);
        for (let at = .02; at < 30; at += .02) {
          const now = animalAt(map, occupied, animal, at);
          const pace = Math.hypot(now.x - previous.x, now.z - previous.z) / .02;
          expect(pace).toBeLessThan(species.speed * 1.6);
          previous = now;
        }
      }
    }
  });

  test('a rabbit crosses in one bound and then sits for seconds', () => {
    const world = createWorld(1);
    const map = islandFor(world.seed);
    const occupied = wildlifeObstacles(world);
    const cycle = SPECIES.rabbit.move / (1 - SPECIES.rabbit.rest);
    expect(cycle).toBeGreaterThan(3);
    const rabbit = world.wildlife.find((animal) => animal.kind === 'rabbit')!;
    let bounds = 0;
    let moving = false;
    for (let at = 0; at < cycle * 4; at += .02) {
      const pace = Math.hypot(
        animalAt(map, occupied, rabbit, at + .02).x - animalAt(map, occupied, rabbit, at).x,
        animalAt(map, occupied, rabbit, at + .02).z - animalAt(map, occupied, rabbit, at).z,
      ) / .02;
      if (pace > .02 && !moving) bounds += 1;
      moving = pace > .02;
    }
    expect(bounds).toBe(4);
  });
});

test('a seed hands out the same roster every time, and never the same objects twice', () => {
  const first = wildlifeRoster(7);
  const second = wildlifeRoster(7);
  expect(second.length).toBe(first.length);
  expect(second).toEqual(first);
  expect(second[0]).not.toBe(first[0]);

  first[0].respawnAt = 500;
  first[0].cornered = true;
  const third = wildlifeRoster(7);
  expect(third[0].respawnAt).toBeNull();
  expect(third[0].cornered).toBe(false);
});
