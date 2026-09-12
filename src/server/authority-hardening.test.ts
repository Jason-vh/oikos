import { afterEach, describe, expect, test } from 'bun:test';
import { RETAINED_RECEIPTS, Authority } from './authority';
import { closeStore, initStore, openStore } from './store';
import { claimIsland } from '../sim/claims';
import { createSharedWorld } from '../sim/world';
import { serializeWorld } from '../sim/save';
import { foundedActor, freshAuthority, freshPath, rawDb, revisionOf, rid, roadTileOf, sequenceRow } from './authority-fixtures.test';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function cyclicCommand(): unknown {
  const value: Record<string, unknown> = { type: 'not-a-real-command' };
  value.self = value;
  return value;
}

describe('malformed in-process payload resilience', () => {
  test.each([
    ['a cyclic inner command', cyclicCommand()],
    ['a BigInt inner command', { type: 'not-a-real-command', amount: 10n }],
    ['an undefined inner command', undefined],
    ['a function inner command', () => {}],
    ['a symbol inner command', Symbol('x')],
    ['a NaN inner command', NaN],
    ['an Infinity inner command', Infinity],
    ['a Date inner command', new Date()],
  ] as const)('%s is rejected without writes or poisoning the authority, in-process (not a claim about any particular wire format)', (_label, command) => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const before = authority.snapshot();
    const beforeSequence = sequenceRow(authority, credential);

    const result = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command });

    expect(result).toEqual({ ok: false, reason: 'Malformed request payload.', status: 'invalid-request' });
    expect(authority.snapshot()).toEqual(before);
    expect(sequenceRow(authority, credential)).toEqual(beforeSequence);

    const validCommand = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(validCommand.status).toBe('processed');
    expect(authority.admitInvite(authority.issueInvite()).ok).toBe(true);
  });

  test('null is processed as an ordinary logical-failure baseline; NaN at the same seq is rejected as malformed, never replaying it', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);

    const nullResult = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: null });
    expect(nullResult).toEqual({ ok: false, reason: 'Invalid city command.', cityId, status: 'processed' });

    const nanResult = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: NaN });
    expect(nanResult).toEqual({ ok: false, reason: 'Malformed request payload.', status: 'invalid-request' });
  });
});

describe('sequencing, dedupe and replay edge cases', () => {
  test('the same seq is a conflict whether the payload or just the request id differs, and neither disturbs private state', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const harbour = authority.snapshot().cities.find((c) => c.id === cityId)!.harbour;
    const before = authority.snapshot();
    const beforeSequence = sequenceRow(authority, credential);

    const differentPayload = authority.submit(credential, 2, rid(2), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(differentPayload).toEqual({ ok: false, reason: 'Sequence already used with a different request.', status: 'conflict' });
    const differentId = authority.submit(credential, 2, rid(99), { kind: 'command', cityId, command: { type: 'foundHarbour', x: harbour.x, z: harbour.z } });
    expect(differentId).toEqual({ ok: false, reason: 'Sequence already used with a different request.', status: 'conflict' });

    expect(authority.snapshot()).toEqual(before);
    expect(sequenceRow(authority, credential)).toEqual(beforeSequence);
  });

  test('a request id already bound to an earlier sequence is refused for a new sequence', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);

    const result = authority.submit(credential, 3, rid(2), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });

    expect(result).toEqual({ ok: false, reason: 'Request id already used for a different sequence or payload.', status: 'conflict' });
  });

  test('a sequence gap is rejected and does not disturb the watermark', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const before = authority.snapshot();

    const beforeSequence = sequenceRow(authority, credential);
    const gap = authority.submit(credential, 5, rid(5), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(gap.reason).toBe('Sequence gap; expected 3.');
    expect(gap.status).toBe('gap');
    expect(authority.snapshot()).toEqual(before);
    expect(sequenceRow(authority, credential)).toEqual(beforeSequence);

    const next = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(next.ok).toBe(false);
    expect(next.reason).toBe('Nothing to demolish there.');
  });

  test('a well-formed rejected command still advances the sequence and leaves the World unchanged', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const before = authority.snapshot();

    const result = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(result).toEqual({ ok: false, reason: 'Nothing to demolish there.', cityId, status: 'processed' });
    expect(authority.snapshot()).toEqual(before);

    const replay = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(replay).toEqual({ ...result, status: 'replayed' });
  });

  test('a pruned old sequence cannot be replayed once its receipt has aged out', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    let seq = 3;
    for (let i = 0; i < RETAINED_RECEIPTS + 5; i++) {
      authority.submit(credential, seq, rid(seq), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
      seq += 1;
    }
    const result = authority.submit(credential, 1, rid(1), { kind: 'claim', home: 0 });
    expect(result).toEqual({ ok: false, reason: 'Sequence already processed; history not retained.', status: 'pruned' });
  });

  test('equivalent commands with incidental extra fields fingerprint identically', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);

    const first = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0, garbage: 'ignored' } as unknown });
    const replay = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });

    expect(replay).toEqual({ ...first, status: 'replayed' });
  });

  test('replaying a stale receipt can never undo a newer, legitimate mutation of the same tile', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const tile = roadTileOf(authority, cityId);

    const removal = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(removal.ok).toBe(true);
    const rebuild = authority.submit(credential, 4, rid(4), { kind: 'command', cityId, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } });
    expect(rebuild.ok).toBe(true);
    const afterRebuild = authority.snapshot();

    const immediateReplay = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(immediateReplay.status).toBe('replayed');
    expect(authority.snapshot()).toEqual(afterRebuild);

    let seq = 5;
    for (let i = 0; i < RETAINED_RECEIPTS + 5; i++) {
      authority.submit(credential, seq, rid(seq), { kind: 'command', cityId, command: { type: 'vendor', id: authority.snapshot().cities[0].harbour.id, enabled: false } });
      seq += 1;
    }
    const prunedReplay = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(prunedReplay.status).toBe('pruned');
    expect(authority.snapshot()).toEqual(afterRebuild);
  });
});

describe('failed commit consistency', () => {
  test('refuses to increment a revision already at the safe-integer ceiling, without persisting an unsafe value', () => {
    const { path, authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const tile = roadTileOf(authority, cityId);
    rawDb(authority).run('UPDATE world SET revision = ? WHERE id = 1;', [Number.MAX_SAFE_INTEGER]);
    authority.close();

    const reopened = Authority.open(path);
    cleanups.push(() => reopened.close());
    const beforeData = rawDb(reopened).query<{ data: string }, []>('SELECT data FROM world WHERE id = 1;').get()!.data;

    expect(() => reopened.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } })).toThrow();

    const row = rawDb(reopened).query<{ revision: number; data: string }, []>('SELECT revision, data FROM world WHERE id = 1;').get()!;
    expect(row.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(row.data).toBe(beforeData);
  });

  test('a revision fencing failure rolls back the whole transaction, leaves the World and DB untouched, and poisons the authority', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const tile = roadTileOf(authority, cityId);
    const before = authority.snapshot();

    rawDb(authority).run('UPDATE world SET revision = revision + 1 WHERE id = 1;');
    const beforeRevision = revisionOf(authority);
    const beforeData = rawDb(authority).query<{ data: string }, []>('SELECT data FROM world WHERE id = 1;').get()!.data;

    expect(() => authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } })).toThrow();

    expect(authority.snapshot()).toEqual(before);
    expect(revisionOf(authority)).toBe(beforeRevision);
    expect(rawDb(authority).query<{ data: string }, []>('SELECT data FROM world WHERE id = 1;').get()!.data).toBe(beforeData);

    const actorId = rawDb(authority).query<{ actor_id: number }, []>('SELECT actor_id FROM credentials LIMIT 1;').get()!.actor_id;
    const watermark = rawDb(authority).query<{ high_watermark: number }, [number]>('SELECT high_watermark FROM sequences WHERE actor_id = ?;').get(actorId)!.high_watermark;
    expect(watermark).toBe(2);
    const receipt = rawDb(authority).query<{ seq: number }, [number, number]>('SELECT seq FROM receipts WHERE actor_id = ? AND seq = ?;').get(actorId, 3);
    expect(receipt).toBeNull();

    expect(() => authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } })).toThrow();
    expect(() => authority.issueInvite()).toThrow();
  });

  test('a COMMIT-time constraint failure (not just a statement failure) rolls back the whole transaction and leaves memory untouched', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const tile = roadTileOf(authority, cityId);
    const before = authority.snapshot();
    const beforeRevision = revisionOf(authority);
    const db = rawDb(authority);
    db.run('CREATE TABLE test_only_guard (id INTEGER PRIMARY KEY, ref INTEGER REFERENCES actors(id) DEFERRABLE INITIALLY DEFERRED);');
    db.run('CREATE TRIGGER test_only_break_commit AFTER INSERT ON receipts BEGIN INSERT INTO test_only_guard (ref) VALUES (999999); END;');

    expect(() => authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } })).toThrow();

    expect(authority.snapshot()).toEqual(before);
    expect(revisionOf(authority)).toBe(beforeRevision);
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM test_only_guard;').get()!.count).toBe(0);
    const actorId = db.query<{ actor_id: number }, []>('SELECT actor_id FROM credentials LIMIT 1;').get()!.actor_id;
    expect(db.query<{ seq: number }, [number, number]>('SELECT seq FROM receipts WHERE actor_id = ? AND seq = ?;').get(actorId, 3)).toBeNull();
  });
});

describe('corrupt authority state', () => {
  test('refuses to open when a claimed city has no owner row', () => {
    const path = freshPath(cleanups);
    initStore(path);
    const world = createSharedWorld();
    claimIsland(world, 0);
    const store = openStore(path);
    store.db.run('UPDATE world SET revision = revision + 1, data = ? WHERE id = 1;', [serializeWorld(world)]);
    closeStore(store);
    expect(() => Authority.open(path)).toThrow();
  });

  test('refuses to open when ownership references a city absent from the World', () => {
    const { path, authority } = freshAuthority(cleanups);
    const { cityId } = foundedActor(authority, 0);
    const actorId = rawDb(authority).query<{ actor_id: number }, []>('SELECT actor_id FROM credentials LIMIT 1;').get()!.actor_id;
    rawDb(authority).run('INSERT INTO ownership (city_id, actor_id, created_at) VALUES (?, ?, ?);', [cityId + 100, actorId, Date.now()]);
    authority.close();
    expect(() => Authority.open(path)).toThrow();
  });

  test('refuses to open when a stored row violates a real foreign key relationship', () => {
    const path = freshPath(cleanups);
    initStore(path);
    const store = openStore(path);
    store.db.run('PRAGMA foreign_keys = OFF;');
    store.db.run('INSERT INTO credentials (actor_id, credential_hash, created_at) VALUES (?, ?, ?);', [999, 'deadbeef', Date.now()]);
    closeStore(store);
    expect(() => Authority.open(path)).toThrow();
  });

  test.each([
    ['an actor is missing its sequence row', (authority: Authority) => rawDb(authority).run('DELETE FROM sequences;')],
    ['a receipt outcome is malformed JSON', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET outcome = 'not json' WHERE seq = 2;")],
    ['a credential hash is malformed', (authority: Authority) => rawDb(authority).run("UPDATE credentials SET credential_hash = 'not-a-hash';")],
    ['an invite hash is malformed', (authority: Authority) => rawDb(authority).run("INSERT INTO invites (code_hash, created_at) VALUES ('not-a-hash', 0);")],
    ['a receipt request id is malformed', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET request_id = 'not-a-valid-id' WHERE seq = 2;")],
    ['a receipt fingerprint is malformed', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET fingerprint = 'not-a-hash' WHERE seq = 2;")],
    ['a receipt outcome carries an unexpected extra key', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET outcome = json_set(outcome, '$.extra', 1) WHERE seq = 2;")],
    ['a receipt names a city absent from the World', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET outcome = json_set(outcome, '$.cityId', 999999) WHERE seq = 2;")],
    ['a successful receipt is missing its city', (authority: Authority) => rawDb(authority).run("UPDATE receipts SET outcome = json_remove(outcome, '$.cityId') WHERE seq = 2;")],
    ['the realm id is malformed', (authority: Authority) => rawDb(authority).run("UPDATE meta SET realm_id = 'not-a-uuid';")],
    ['the invites table is missing', (authority: Authority) => rawDb(authority).run('DROP TABLE invites;')],
  ] as const)('refuses to open when %s', (_label, corrupt) => {
    const { path, authority } = freshAuthority(cleanups);
    foundedActor(authority, 0);
    corrupt(authority);
    authority.close();
    expect(() => Authority.open(path)).toThrow();
  });

  test('refuses to open when one request id is bound to more than one sequence', () => {
    const { path, authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    rawDb(authority).run('UPDATE receipts SET request_id = ? WHERE seq = 3;', [rid(2)]);
    authority.close();
    expect(() => Authority.open(path)).toThrow();
  });
});
