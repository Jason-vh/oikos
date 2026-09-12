import { expect, test } from 'bun:test';
import { applyCommand, MAX_ROAD_PATH, parseCommand, type CityCommand } from './commands';
import { serializeWorld } from './save';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './scenario';
import { spotFor } from './testing';
import { advance, createWorld, getSummary } from './world';
import { primaryCity } from './city';

const BUILD: CityCommand = { type: 'build', tool: 'house', x: 2, z: 3, rotation: 0 };

test('invalid city commands cannot mutate simulation state', () => {
  const world = createWorld();
  const before = serializeWorld(world);
  const invalid: unknown[] = [
    undefined, null, [], 'build', {},
    { type: 'advance', seconds: 1000 },
    { ...BUILD, tool: 'harbour' },
    { ...BUILD, tool: 'inspect' },
    { ...BUILD, x: NaN },
    { ...BUILD, z: Infinity },
    { ...BUILD, x: Number.MAX_SAFE_INTEGER + 1 },
    { ...BUILD, x: '2' },
    { ...BUILD, rotation: .5 },
    { ...BUILD, rotation: 4 },
    { ...BUILD, rotation: undefined },
    { type: 'vendor', id: -1, enabled: true },
    { type: 'vendor', id: 0, enabled: 'yes' },
    { type: 'roadPath', tiles: [] },
    { type: 'roadPath', tiles: [{ x: 1, z: 1 }, null] },
    { type: 'roadPath', tiles: Array.from({ length: MAX_ROAD_PATH + 1 }, () => ({ x: 1, z: 1 })) },
    { type: 'demolish', x: 1.5, z: 1 },
    { type: 'foundHarbour', x: 1, z: undefined },
  ];
  for (const raw of invalid) {
    expect(parseCommand(raw)).toBeNull();
    expect(applyCommand(world, raw)).toEqual({ ok: false, reason: 'Invalid city command.' });
    expect(serializeWorld(world)).toBe(before);
  }
});

test('parsing copies command data and strips fields that do not belong to the action', () => {
  const raw = { type: 'roadPath', tiles: [{ x: 2, z: 3, money: 1000 }], money: 1000 };
  const parsed = parseCommand(raw);
  raw.tiles[0].x = 100;
  raw.tiles.push({ x: 4, z: 5, money: 0 });
  expect(parsed).toEqual({ type: 'roadPath', tiles: [{ x: 2, z: 3 }] });
  expect(parseCommand({ ...BUILD, ownerId: 'someone-else', money: 1e9 })).toEqual(BUILD);
  expect(parseCommand({ type: 'roadPath', tiles: Array.from({ length: MAX_ROAD_PATH }, (_, x) => ({ x, z: 1 })) })).not.toBeNull();
});

test('JSON commands found and grow exactly the same city as the direct simulation API', () => {
  const world = createWorld(2, 0, false);
  const replay = structuredClone(world);
  const commands: CityCommand[] = [];
  const execute = (command: CityCommand) => {
    commands.push(command);
    expect(applyCommand(world, JSON.parse(JSON.stringify(command))).ok).toBe(true);
  };
  execute({ type: 'foundHarbour', x: primaryCity(world).harbour.x, z: primaryCity(world).harbour.z });
  const plan = planStarterNeighbourhood(world)!;
  expect(plan).not.toBeNull();
  for (const building of plan.buildings) execute({ type: 'build', tool: building.kind, x: building.x, z: building.z, rotation: 0 });
  execute({ type: 'roadPath', tiles: plan.roads });
  execute({ type: 'vendor', id: primaryCity(world).buildings.find((building) => building.kind === 'agora')!.id, enabled: true });
  for (const command of commands) expect(applyCommand(replay, command).ok).toBe(true);
  const direct = createWorld(2, 0);
  expect(buildStarterNeighbourhood(direct).ok).toBe(true);
  advance(world, 180);
  advance(replay, 180);
  advance(direct, 180);
  expect(getSummary(primaryCity(world)).goal).toBe(true);
  expect(world).toEqual(replay);
  expect(world).toEqual(direct);
  const house = primaryCity(world).buildings.find((building) => building.kind === 'house')!;
  expect(applyCommand(world, { type: 'demolish', x: house.x, z: house.z }).ok).toBe(true);
  expect(primaryCity(world).buildings.some((building) => building.id === house.id)).toBe(false);
});

test('well-formed commands still enforce founding and territory rules', () => {
  const world = createWorld(1, 0, false);
  const foreign = createWorld(1, 7);
  const spot = spotFor(foreign, 'house')!;
  const command: CityCommand = { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 };
  expect(applyCommand(world, command).reason).toContain('founding harbour');
  expect(applyCommand(world, { type: 'foundHarbour', x: primaryCity(world).harbour.x, z: primaryCity(world).harbour.z }).ok).toBe(true);
  const before = serializeWorld(world);
  expect(applyCommand(world, command).reason).toContain('settled island');
  expect(serializeWorld(world)).toBe(before);
});
