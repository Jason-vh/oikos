import { afterEach, describe, expect, test } from 'bun:test';
import { islandFor, tileAtOn } from '../sim/island';
import { admit, foundedActor, freshAuthority, rid, roadTileOf, sequenceRow } from './authority-fixtures.test';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function sparseArrayCommand(): unknown {
  const tiles: unknown[] = [];
  tiles[0] = { x: 0, z: 0 };
  tiles[2] = { x: 0, z: 1 };
  return { type: 'roadPath', tiles };
}

function extraKeyObjectCommand(): unknown {
  const command: Record<string, unknown> = { type: 'not-a-real-command', x: 0, z: 0 };
  Object.defineProperty(command, 'hidden', { value: 'secret', enumerable: false });
  return command;
}

function extraSymbolObjectCommand(): unknown {
  const command: Record<string | symbol, unknown> = { type: 'not-a-real-command', x: 0, z: 0 };
  command[Symbol('extra')] = 'secret';
  return command;
}

function arrayWithExtraKey(sparse: boolean, enumerable: boolean): unknown[] {
  const array = sparse ? Array(1) : [null];
  Object.defineProperty(array, 'extra', { value: null, enumerable });
  return array;
}

describe('finite-JSON shape edge cases', () => {
  test.each([
    ['a sparse array field', sparseArrayCommand()],
    ['a sparse array with a balancing extra key', arrayWithExtraKey(true, true)],
    ['an array with a hidden extra key', arrayWithExtraKey(false, false)],
    ['an object with a hidden non-enumerable key', extraKeyObjectCommand()],
    ['an object with a symbol-keyed extra property', extraSymbolObjectCommand()],
  ] as const)('%s is rejected without writes or poisoning the authority', (_label, command) => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const before = authority.snapshot();
    const beforeSequence = sequenceRow(authority, credential);

    const result = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command });

    expect(result).toEqual({ ok: false, reason: 'Malformed request payload.', status: 'invalid-request' });
    expect(authority.snapshot()).toEqual(before);
    expect(sequenceRow(authority, credential)).toEqual(beforeSequence);

    const tile = roadTileOf(authority, cityId);
    const validCommand = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(validCommand.ok).toBe(true);
    expect(authority.snapshot().cities.find((city) => city.id === cityId)!.roads).not.toContain(tile.index);
    expect(authority.admitInvite(authority.issueInvite()).ok).toBe(true);
  });
});

describe('normalize once, execute the same value', () => {
  test('fingerprinting and execution use the same captured demolition', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const city = authority.snapshot().cities.find((c) => c.id === cityId)!;
    const map = islandFor(authority.snapshot().seed, city.home);
    const tileA = tileAtOn(map, city.roads[0]);
    const tileB = tileAtOn(map, city.roads[1]);

    let reads = 0;
    const statefulCommand = {
      type: 'demolish',
      get x() {
        reads += 1;
        return reads <= 2 ? tileA.x : tileB.x;
      },
      get z() {
        return reads <= 2 ? tileA.z : tileB.z;
      },
    };

    const result = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: statefulCommand });
    expect(result.ok).toBe(true);
    const cityAfter = authority.snapshot().cities.find((c) => c.id === cityId)!;
    expect(cityAfter.roads.includes(city.roads[0])).toBe(false);
    expect(cityAfter.roads.includes(city.roads[1])).toBe(true);
    const worldAfter = authority.snapshot();

    const replay = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tileA.x, z: tileA.z } });
    expect(replay.status).toBe('replayed');
    expect(replay).toEqual({ ...result, status: 'replayed' });
    expect(authority.snapshot()).toEqual(worldAfter);
  });

  test('an unparseable command with a stateful field is read exactly once per submission, as an ordinary durable logical failure', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const before = authority.snapshot();

    let calls = 0;
    const statefulGarbage = {
      type: 'not-a-real-command',
      get tag() {
        calls += 1;
        return calls;
      },
    };

    const result = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: statefulGarbage });
    expect(result).toEqual({ ok: false, reason: 'Invalid city command.', cityId, status: 'processed' });
    expect(calls).toBe(1);
    expect(authority.snapshot()).toEqual(before);

    const resubmission = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: statefulGarbage });
    expect(resubmission.status).toBe('conflict');
    expect(calls).toBe(2);

    const admitted = admit(authority);
    expect(authority.submit(admitted, 1, rid(4), { kind: 'claim', home: 1 }).ok).toBe(true);
  });
});
