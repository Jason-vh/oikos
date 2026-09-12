import type { Animal, AnimalKind, Food, World } from './types';
import { footprintTiles } from './grid';
import { buildable, islandFor, levelOn, terrainOn, type IslandMap } from './island';
import { hash } from './island';

export interface SpeciesDefinition {
  name: string;
  food: Food | null;
  yield: number;
  speed: number;
  range: number;
  habitat: (map: IslandMap, x: number, z: number) => boolean;
  density: number;
  flock: number;
}

const coastalWater = (map: IslandMap, x: number, z: number): boolean => {
  if (terrainOn(map, x, z) !== 'water') return false;
  return [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dz]) => terrainOn(map, x + dx, z + dz) !== 'water')
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => terrainOn(map, x + dx, z + dz) === 'water');
};

export const SPECIES: Record<AnimalKind, SpeciesDefinition> = {
  boar: { name: 'Wild boar', food: 'meat', yield: 40, speed: .35, range: 4, habitat: (map, x, z) => terrainOn(map, x, z) === 'forest', density: .07, flock: 1 },
  rabbit: { name: 'Rabbit', food: 'meat', yield: 8, speed: .6, range: 2.5, habitat: (map, x, z) => terrainOn(map, x, z) === 'scrub', density: .12, flock: 2 },
  fish: { name: 'Fish', food: 'fish', yield: 30, speed: .5, range: 3, habitat: coastalWater, density: .06, flock: 4 },
  gull: { name: 'Gull', food: null, yield: 0, speed: 1.6, range: 9, habitat: (map, x, z) => terrainOn(map, x, z) === 'sand' || coastalWater(map, x, z), density: .03, flock: 1 },
};

export function spawnWildlife(world: World): Animal[] {
  const map = islandFor(world.seed);
  const animals: Animal[] = [];
  for (const kind of Object.keys(SPECIES) as AnimalKind[]) {
    const species = SPECIES[kind];
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        if (!species.habitat(map, x, z)) continue;
        const roll = hash(x, z, world.seed * 31 + kind.length * 977);
        if (roll > species.density) continue;
        for (let member = 0; member < species.flock; member++) {
          const angle = hash(x + member * 13, z + member * 7, world.seed + 5) * Math.PI * 2;
          const drift = { x: x + .5 + Math.cos(angle) * .35 * member, z: z + .5 + Math.sin(angle) * .35 * member };
          const spread = canRoam(map, kind, drift.x, drift.z, levelOn(map, x, z)) ? drift : { x: x + .5, z: z + .5 };
          animals.push({
            id: world.nextId++,
            kind,
            x: Math.min(map.width - .05, Math.max(.05, spread.x)),
            z: Math.min(map.depth - .05, Math.max(.05, spread.z)),
            homeX: x + .5,
            homeZ: z + .5,
            heading: angle,
            phase: hash(x, z, world.seed + member + 11) * 100,
            respawn: 0,
            cornered: false,
          });
        }
      }
    }
  }
  return animals;
}

function canRoam(map: IslandMap, kind: AnimalKind, x: number, z: number, level: number): boolean {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.depth) return false;
  const terrain = terrainOn(map, tx, tz);
  if (kind === 'fish') return terrain === 'water';
  if (kind === 'gull') return true;
  if (terrain === 'water' || terrain === 'cliff' || levelOn(map, tx, tz) !== level) return false;
  return terrain === 'forest' || terrain === 'scrub' || buildable(terrain);
}

export function stepWildlife(world: World, dt: number): void {
  const map = islandFor(world.seed);
  const obstacles = wildlifeObstacles(world);
  for (const animal of world.wildlife) {
    const species = SPECIES[animal.kind];
    if (animal.respawn > 0) {
      animal.respawn = Math.max(0, animal.respawn - dt);
      if (animal.respawn === 0) {
        animal.x = animal.homeX;
        animal.z = animal.homeZ;
      }
      continue;
    }
    animal.phase += dt;
    if (animal.cornered) continue;
    const wander = Math.sin(animal.phase * .7 + animal.id) * .9 + Math.sin(animal.phase * .23 + animal.id * 2) * .6;
    const toHomeX = animal.homeX - animal.x;
    const toHomeZ = animal.homeZ - animal.z;
    const distance = Math.hypot(toHomeX, toHomeZ);
    const pull = distance > species.range ? Math.atan2(toHomeZ, toHomeX) : null;
    if (pull === null) animal.heading += wander * dt;
    else {
      let turn = pull - animal.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      animal.heading += turn * Math.min(1, dt * 4);
    }
    const resting = animal.kind !== 'gull' && animal.kind !== 'fish' && Math.sin(animal.phase * .35 + animal.id) < -.3;
    if (resting) continue;
    const nextX = animal.x + Math.cos(animal.heading) * species.speed * dt;
    const nextZ = animal.z + Math.sin(animal.heading) * species.speed * dt;
    const level = levelOn(map, Math.floor(animal.homeX), Math.floor(animal.homeZ));
    if (canRoam(map, animal.kind, nextX, nextZ, level) && !obstacles.has(Math.floor(nextZ) * map.width + Math.floor(nextX))) {
      animal.x = nextX;
      animal.z = nextZ;
    } else {
      animal.heading += Math.PI * .75;
    }
  }
}

export function wildlifeObstacles(world: World): ReadonlySet<number> {
  const map = islandFor(world.seed);
  const occupied = new Set<number>();
  for (const city of world.cities) {
    for (const road of city.roads) occupied.add(road);
    for (const building of city.buildings) {
      for (const tile of footprintTiles(map, building)) occupied.add(tile);
    }
  }
  return occupied;
}

export function animalName(animal: Animal): string {
  return SPECIES[animal.kind].name;
}

export function animalStatus(animal: Animal): string[] {
  const species = SPECIES[animal.kind];
  if (animal.kind === 'gull') return ['Wheeling over the shore.'];
  if (animal.kind === 'fish') return [`A shoal in the shallows. Worth ${species.yield} fish to a fisherman.`];
  return [`Roaming the ${animal.kind === 'boar' ? 'forest' : 'scrub'}. Worth ${species.yield} meat to a hunter.`];
}

export const RESPAWN_SECONDS = 240;

export function alive(animal: Animal): boolean {
  return animal.respawn === 0;
}

export function killAnimal(animal: Animal): number {
  const amount = SPECIES[animal.kind].yield;
  animal.respawn = RESPAWN_SECONDS;
  return amount;
}
