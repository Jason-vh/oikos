import { expect, test } from 'bun:test';
import { primaryCity } from './city';
import { islandFor } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { connect, onHomeIsland, spotFor } from './testing';
import { advance, build, createWorld, demolish, dropInvalidWalkers } from './world';

function activeHunt() {
  const world = createWorld(1);
  const city = primaryCity(world);
  const nearby = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
  const lodgeSpot = spotFor(world, 'lodge', { x: Math.floor(nearby.homeX), z: Math.floor(nearby.homeZ) })!;
  expect(build(world, city, 'lodge', lodgeSpot.x, lodgeSpot.z).ok).toBe(true);
  const lodge = city.buildings[0];
  expect(connect(world, lodge).ok).toBe(true);
  const houseSpot = spotFor(world, 'house', islandFor(world.seed).entry)!;
  expect(build(world, city, 'house', houseSpot.x, houseSpot.z).ok).toBe(true);
  expect(connect(world, city.buildings[1]).ok).toBe(true);
  for (let step = 0; step < 1600; step++) {
    advance(world, .25);
    const hunter = city.walkers.find((walker) => walker.kind === 'hunter' && walker.working > 0);
    if (!hunter) continue;
    const prey = world.wildlife.find((animal) => animal.id === hunter.quarry)!;
    expect(prey.cornered).toBe(true);
    return { world, city, lodge, hunter, prey };
  }
  throw new Error('The lodge never cornered prey.');
}

function anotherHunter(hunt: ReturnType<typeof activeHunt>) {
  const { world, city, lodge, hunter } = hunt;
  const spot = spotFor(world, 'lodge', lodge)!;
  expect(build(world, city, 'lodge', spot.x, spot.z).ok).toBe(true);
  const home = city.buildings[city.buildings.length - 1];
  const other = { ...structuredClone(hunter), id: world.nextId++, homeId: home.id };
  city.walkers.push(other);
  return { home, hunter: other };
}

test('demolishing a working hunter’s lodge releases its living prey before saving', () => {
  const { world, city, lodge, hunter, prey } = activeHunt();
  expect(demolish(world, city, lodge.x, lodge.z).ok).toBe(true);
  expect(city.walkers.some((walker) => walker.id === hunter.id)).toBe(false);
  expect(prey.cornered).toBe(false);
  expect(prey.respawn).toBe(0);
  expect(deserializeWorld(serializeWorld(world))).toEqual(world);
});

test('demolition leaves prey cornered until its last working hunter retires', () => {
  const hunt = activeHunt();
  const other = anotherHunter(hunt);
  const { world, city, lodge, prey } = hunt;
  expect(demolish(world, city, lodge.x, lodge.z).ok).toBe(true);
  expect(prey.cornered).toBe(true);
  expect(city.walkers.some((walker) => walker.id === other.hunter.id)).toBe(true);
  expect(demolish(world, city, other.home.x, other.home.z).ok).toBe(true);
  expect(prey.cornered).toBe(false);
});

test.each([{ working: 0, returning: false }, { working: 5, returning: true }])('a hunter not actively holding prey cannot keep it trapped: %j', (state) => {
  const hunt = activeHunt();
  const other = anotherHunter(hunt);
  Object.assign(other.hunter, state);
  expect(demolish(hunt.world, hunt.city, hunt.lodge.x, hunt.lodge.z).ok).toBe(true);
  expect(hunt.prey.cornered).toBe(false);
});

test('retiring invalid routes does not release prey held by another working hunter', () => {
  const hunt = activeHunt();
  const other = anotherHunter(hunt);
  const { world, city, hunter, prey } = hunt;
  hunter.path = [];
  dropInvalidWalkers(world, city);
  expect(city.walkers.some((walker) => walker.id === hunter.id)).toBe(false);
  expect(prey.cornered).toBe(true);
  other.hunter.path = [];
  dropInvalidWalkers(world, city);
  expect(prey.cornered).toBe(false);
});
