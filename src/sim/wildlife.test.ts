import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { islandFor, terrainOn } from './island';
import { SPECIES, alive, animalAt, animalStatus, killAnimal, spawnWildlife, wildlifeObstacles, RESPAWN_SECONDS } from './wildlife';
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
    expect(spawnWildlife(createWorld(1)).map((animal) => [animal.kind, animal.homeX, animal.homeZ])).toEqual(world.wildlife.map((animal) => [animal.kind, animal.homeX, animal.homeZ]));
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
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    expect(animalStatus(boar)[0]).toContain('meat');
  });
});
