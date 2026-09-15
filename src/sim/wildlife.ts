import type { Animal, AnimalKind, AnimalPlace, Food, World } from './types';
import { footprintTiles } from './grid';
import { buildable, islandFor, levelOn, terrainOn, type IslandMap } from './island';
import { hash } from './island';

export interface SpeciesDefinition {
  name: string;
  food: Food | null;
  yield: number;
  speed: number;
  range: number;
  rest: number;
  move: number;
  hop: boolean;
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
  boar: { name: 'Wild boar', food: 'meat', yield: 40, speed: .35, range: 4, rest: .72, move: 2.6, hop: false, habitat: (map, x, z) => terrainOn(map, x, z) === 'forest', density: .07, flock: 1 },
  rabbit: { name: 'Rabbit', food: 'meat', yield: 8, speed: 1.8, range: 2.5, rest: .82, move: .45, hop: true, habitat: (map, x, z) => terrainOn(map, x, z) === 'scrub', density: .12, flock: 2 },
  fish: { name: 'Fish', food: 'fish', yield: 30, speed: .5, range: 3, rest: .45, move: 2.6, hop: false, habitat: coastalWater, density: .06, flock: 4 },
  gull: { name: 'Gull', food: null, yield: 0, speed: 1.6, range: 9, rest: 0, move: 2.6, hop: false, habitat: (map, x, z) => terrainOn(map, x, z) === 'sand' || coastalWater(map, x, z), density: .03, flock: 1 },
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
          animals.push({
            id: world.nextId++,
            kind,
            homeX: x + .5,
            homeZ: z + .5,
            drift: hash(x + member * 13, z + member * 7, world.seed + 5) * Math.PI * 2,
            respawnAt: null,
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

const WANDER_STEPS = 6;

function scatter(animal: Animal, index: number): number {
  const value = Math.sin(animal.id * 12.9898 + index * 78.233 + animal.drift) * 43758.5453;
  return value - Math.floor(value);
}

function loopAt(animal: Animal, species: SpeciesDefinition, turns: number): AnimalPlace {
  const reach = species.range * .72;
  const slow = animal.drift + turns;
  const fast = animal.drift * 2.3 + turns * 2.4;
  return {
    x: (Math.cos(slow) * .68 + Math.cos(fast) * .32) * reach,
    z: (Math.sin(slow) * .68 + Math.sin(fast * .87) * .32) * reach,
  };
}

function restingPlace(animal: Animal, species: SpeciesDefinition, index: number): AnimalPlace {
  const step = species.speed * species.move;
  const wobble = scatter(animal, index) * .3 + .85;
  return loopAt(animal, species, index * step / (species.range * .72) * wobble);
}

interface Gait {
  offset: AnimalPlace;
  stride: number;
}

function wanderGait(animal: Animal, time: number): Gait {
  const species = SPECIES[animal.kind];
  const cycle = species.move / (1 - species.rest);
  const phase = time / cycle + animal.drift;
  const index = Math.floor(phase);
  const within = phase - index;
  const settled = restingPlace(animal, species, index);
  if (within <= species.rest) return { offset: settled, stride: 0 };
  const next = restingPlace(animal, species, index + 1);
  const share = (within - species.rest) / (1 - species.rest);
  const eased = species.rest > 0 && !species.hop ? share * share * (3 - 2 * share) : share;
  return {
    offset: {
      x: settled.x + (next.x - settled.x) * eased,
      z: settled.z + (next.z - settled.z) * eased,
    },
    stride: eased,
  };
}

export function animalStride(animal: Animal, time: number): number {
  if (animal.respawnAt !== null || animal.cornered) return 0;
  return wanderGait(animal, time).stride;
}

export function animalAt(map: IslandMap, occupied: ReadonlySet<number>, animal: Animal, time: number): AnimalPlace {
  const home = { x: animal.homeX, z: animal.homeZ };
  if (animal.respawnAt !== null || animal.cornered) return home;
  const level = levelOn(map, Math.floor(animal.homeX), Math.floor(animal.homeZ));
  const { offset } = wanderGait(animal, time);
  let allowed = 0;
  for (let attempt = WANDER_STEPS; attempt >= 1; attempt--) {
    const share = attempt / WANDER_STEPS;
    const x = home.x + offset.x * share;
    const z = home.z + offset.z * share;
    if (!canRoam(map, animal.kind, x, z, level)) continue;
    if (animal.kind !== 'gull' && animal.kind !== 'fish' && occupied.has(Math.floor(z) * map.width + Math.floor(x))) continue;
    allowed = share;
    break;
  }
  return {
    x: Math.min(map.width - .05, Math.max(.05, home.x + offset.x * allowed)),
    z: Math.min(map.depth - .05, Math.max(.05, home.z + offset.z * allowed)),
  };
}

export function animalPlace(world: World, animal: Animal, occupied: ReadonlySet<number>): AnimalPlace {
  return animalAt(islandFor(world.seed), occupied, animal, world.time);
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

export function alive(animal: Animal, time: number): boolean {
  return animal.respawnAt === null || time >= animal.respawnAt;
}

export function retireRespawned(world: World): void {
  for (const animal of world.wildlife) {
    if (animal.respawnAt !== null && world.time >= animal.respawnAt) animal.respawnAt = null;
  }
}

export function killAnimal(world: World, animal: Animal): number {
  const amount = SPECIES[animal.kind].yield;
  animal.respawnAt = world.time + RESPAWN_SECONDS;
  animal.cornered = false;
  return amount;
}
