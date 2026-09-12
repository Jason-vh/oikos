import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { foundedActor, freshAuthority, rawDb } from './authority-fixtures.test';
import { readWorldRow } from './store';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

test('checkpoint revision exhaustion refuses overflow and fences future ticks', () => {
  const { authority, path } = freshAuthority(cleanups);
  foundedActor(authority, 0);
  authority.advance(1);
  expect(authority.checkpoint()).toBe(true);
  rawDb(authority).run('UPDATE world SET revision = ? WHERE id = 1', [Number.MAX_SAFE_INTEGER]);
  authority.close();
  const reopened = Authority.open(path);
  cleanups.push(() => reopened.close());
  const before = readWorldRow(rawDb(reopened));
  reopened.advance(1);
  expect(reopened.snapshot().time).toBeGreaterThan(before.world.time);
  expect(() => reopened.checkpoint()).toThrow('revision is exhausted');
  expect(readWorldRow(rawDb(reopened))).toEqual(before);
  expect(() => reopened.advance(1)).toThrow('terminal fault');
});

test('checkpoint revision mismatch rolls back a real tick checkpoint and poisons writes', () => {
  const { authority } = freshAuthority(cleanups);
  foundedActor(authority, 0);
  authority.advance(1);
  expect(authority.checkpoint()).toBe(true);
  rawDb(authority).run('UPDATE world SET revision = revision + 1 WHERE id = 1');
  const before = readWorldRow(rawDb(authority));
  authority.advance(1);
  expect(authority.snapshot().time).toBeGreaterThan(before.world.time);
  expect(() => authority.checkpoint()).toThrow('revision changed underneath');
  expect(readWorldRow(rawDb(authority))).toEqual(before);
  expect(() => authority.checkpoint()).toThrow('terminal fault');
  expect(() => authority.issueInvite()).toThrow('terminal fault');
});
