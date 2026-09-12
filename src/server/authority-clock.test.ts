import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { freshAuthority, foundedActor, rawDb, revisionOf, rid, roadTileOf } from './authority-fixtures.test';
import { readWorldRow } from './store';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

test('trusted ticks remain private until checkpoint; replay and logical failure do not clear dirty state', () => {
  const { authority, path } = freshAuthority(cleanups);
  const actor = foundedActor(authority, 0);
  const initial = authority.snapshot();
  const revision = revisionOf(authority);
  authority.advance(1);
  expect(authority.snapshot().time).toBeGreaterThan(initial.time);
  expect(readWorldRow(rawDb(authority)).world).toEqual(initial);
  expect(authority.submit(actor.credential, 1, rid(1), { kind: 'claim', home: 0 }).status).toBe('replayed');
  expect(authority.submit(actor.credential, 3, rid(3), { kind: 'claim', home: 1 })).toMatchObject({ status: 'processed', ok: false });
  expect(revisionOf(authority)).toBe(revision);
  expect(authority.checkpoint()).toBe(true);
  expect(revisionOf(authority)).toBe(revision + 1);
  const persisted = authority.snapshot();
  expect(authority.checkpoint()).toBe(false);
  expect(revisionOf(authority)).toBe(revision + 1);
  authority.close();
  const reopened = Authority.open(path);
  try { expect(reopened.snapshot()).toEqual(persisted); } finally { reopened.close(); }
});

test('successful commands checkpoint accumulated ticks; pending worlds and invalid clock intervals do not advance', () => {
  const { authority } = freshAuthority(cleanups);
  authority.advance(1);
  expect(authority.snapshot().time).toBe(0);
  expect(authority.checkpoint()).toBe(false);
  for (const interval of [-1, 6, NaN, Infinity]) expect(() => authority.advance(interval)).toThrow('Invalid authority clock interval');
  const actor = foundedActor(authority, 0);
  authority.advance(1);
  const world = authority.snapshot();
  const city = world.cities[0];
  const tile = roadTileOf(authority, city.id);
  const outcome = authority.submit(actor.credential, 3, rid(3), { kind: 'command', cityId: city.id, command: { type: 'demolish', x: tile.x, z: tile.z } });
  expect(outcome.ok).toBe(true);
  expect(authority.snapshot().cities[0].roads).not.toContain(tile.index);
  expect(readWorldRow(rawDb(authority)).world).toEqual(authority.snapshot());
  expect(authority.checkpoint()).toBe(false);
});

test('checkpoint commit failure preserves durable state and poisons subsequent writes', () => {
  const { authority } = freshAuthority(cleanups);
  foundedActor(authority, 0);
  authority.advance(1);
  expect(authority.checkpoint()).toBe(true);
  const durable = readWorldRow(rawDb(authority));
  rawDb(authority).run("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON world BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  authority.advance(1);
  expect(() => authority.checkpoint()).toThrow('blocked');
  expect(readWorldRow(rawDb(authority))).toEqual(durable);
  expect(() => authority.advance(1)).toThrow('terminal fault');
  expect(() => authority.checkpoint()).toThrow('terminal fault');
  expect(() => authority.issueInvite()).toThrow('terminal fault');
});
