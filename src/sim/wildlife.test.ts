import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { islandFor, terrainOn } from './island';
import { SPECIES, animalStatus, spawnWildlife } from './wildlife';
import { spotFor } from './testing';
import { primaryCity } from './city';

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

  test('animals wander but stay near home, on land they can roam, and inside the map', () => {
    const world = createWorld(1);
    const map = islandFor(1);
    advance(world, 120);
    let moved = 0;
    for (const animal of world.wildlife) {
      const distance = Math.hypot(animal.x - animal.homeX, animal.z - animal.homeZ);
      expect(distance).toBeLessThan(SPECIES[animal.kind].range + 1.5);
      expect(animal.x).toBeGreaterThanOrEqual(0);
      expect(animal.z).toBeGreaterThanOrEqual(0);
      expect(animal.x).toBeLessThanOrEqual(map.width);
      expect(animal.z).toBeLessThanOrEqual(map.depth);
      const terrain = terrainOn(map, Math.floor(animal.x), Math.floor(animal.z));
      if (animal.kind === 'fish') expect(terrain).toBe('water');
      if (animal.kind === 'boar' || animal.kind === 'rabbit') expect(terrain).not.toBe('water');
      if (distance > .5) moved++;
    }
    expect(moved).toBeGreaterThan(world.wildlife.length / 2);
  });

  test('land animals never walk through buildings', () => {
    const world = createWorld(1);
    const spot = spotFor(world, "house")!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    advance(world, 60);
    for (const animal of world.wildlife) {
      if (animal.kind === 'fish' || animal.kind === 'gull') continue;
      const inside = animal.x >= spot.x && animal.x < spot.x + 3 && animal.z >= spot.z && animal.z < spot.z + 3;
      expect(inside).toBe(false);
    }
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
