import { afterEach, expect, test } from 'bun:test';
import { admit, foundedActor, freshAuthority, rid, roadTileOf, sequenceRow } from './authority-fixtures.test';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

test('claim validation, fingerprint and execution share one captured envelope', () => {
  const { authority } = freshAuthority(cleanups);
  const credential = admit(authority);
  let kindReads = 0;
  let homeReads = 0;
  const request = {
    get kind() { kindReads++; return 'claim' as const; },
    get home() { return homeReads++; },
  };
  expect(authority.submit(credential, 1, rid(1), request).ok).toBe(true);
  expect(kindReads).toBe(1);
  expect(homeReads).toBe(1);
  const world = authority.snapshot();
  expect(world.cities[0].home).toBe(0);
  expect(authority.submit(credential, 1, rid(1), { kind: 'claim', home: 0 }).status).toBe('replayed');
  expect(authority.snapshot()).toEqual(world);
});

test('an invalid inner command and its target are captured once before durable evaluation', () => {
  const { authority } = freshAuthority(cleanups);
  const { credential, cityId } = foundedActor(authority, 0);
  const before = authority.snapshot();
  const reads = { kind: 0, cityId: 0, command: 0 };
  const request = {
    get kind() { reads.kind++; return 'command' as const; },
    get cityId() { reads.cityId++; return cityId; },
    get command() { reads.command++; return { type: 'unknown', tag: reads.command }; },
  };
  expect(authority.submit(credential, 3, rid(3), request)).toEqual({ ok: false, reason: 'Invalid city command.', cityId, status: 'processed' });
  expect(reads).toEqual({ kind: 1, cityId: 1, command: 1 });
  expect(authority.snapshot()).toEqual(before);
  expect(authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'unknown', tag: 1 } }).status).toBe('replayed');
  const tile = roadTileOf(authority, cityId);
  expect(authority.submit(credential, 4, rid(4), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } }).ok).toBe(true);
  expect(authority.snapshot().cities[0].roads).not.toContain(tile.index);
});

test('non-finite values returned during command copying cannot consume a sequence', () => {
  const { authority } = freshAuthority(cleanups);
  const { credential, cityId } = foundedActor(authority, 0);
  const tile = roadTileOf(authority, cityId);
  const before = authority.snapshot();
  const sequence = sequenceRow(authority, credential);
  let reads = 0;
  const command = {
    type: 'demolish',
    get x() { reads++; return reads === 1 ? tile.x : NaN; },
    z: tile.z,
  };
  expect(authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command }).status).toBe('invalid-request');
  expect(authority.snapshot()).toEqual(before);
  expect(sequenceRow(authority, credential)).toEqual(sequence);
  expect(authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } }).ok).toBe(true);
  expect(authority.snapshot().cities[0].roads).not.toContain(tile.index);
});

test('throwing envelope accessors are malformed input, not storage faults', () => {
  const { authority } = freshAuthority(cleanups);
  const credential = admit(authority);
  const before = authority.snapshot();
  const sequence = sequenceRow(authority, credential);
  const request = { get kind(): 'claim' { throw new Error('caller error'); }, home: 0 };
  expect(authority.submit(credential, 1, rid(1), request).status).toBe('invalid-request');
  expect(authority.snapshot()).toEqual(before);
  expect(sequenceRow(authority, credential)).toEqual(sequence);
  expect(authority.submit(credential, 1, rid(1), { kind: 'claim', home: 0 }).ok).toBe(true);
});
