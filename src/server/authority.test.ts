import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ACTOR_CAP, Authority } from './authority';
import { admit, claimFor, foundedActor, freshAuthority, cityNames, rid, roadTileOf, sequenceRow } from './authority-fixtures.test';
import { harbourApron } from '../sim/founding';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe('credential secrecy', () => {
  test('issued credentials are 256-bit hex and never persisted in plaintext', () => {
    const { path, authority } = freshAuthority(cleanups);
    const admission = authority.admit('Tycho');
    if (!admission.ok) throw new Error('expected admission to succeed');

    expect(/^[0-9a-f]{64}$/.test(admission.credential)).toBe(true);

    authority.close();
    const raw = readFileSync(path, 'latin1');
    expect(raw.includes(admission.credential)).toBe(false);
  });
});

describe('open admission', () => {
  test('anyone may join, and each join is a separate actor with its own credential', () => {
    const { authority } = freshAuthority(cleanups);
    const first = authority.admit('Tycho');
    const second = authority.admit('Kleio');
    if (!first.ok || !second.ok) throw new Error('expected both admissions to succeed');
    expect(first.actorId).toBeGreaterThan(0);
    expect(second.actorId).not.toBe(first.actorId);
    expect(second.credential).not.toBe(first.credential);
  });

  test('a joined name is trimmed and kept, and authenticates as its own actor', () => {
    const { authority } = freshAuthority(cleanups);
    const admission = authority.admit('  Tycho  ');
    if (!admission.ok) throw new Error('expected admission to succeed');
    expect(cityNames(authority)).toEqual(['Tycho']);
    expect(authority.authenticate(admission.credential)?.actorId).toBe(admission.actorId);
  });

  test('an unusable name is refused without admitting anyone', () => {
    const { authority } = freshAuthority(cleanups);
    for (const name of ['', '   ', 'x'.repeat(25), 'Ty\u0000cho']) {
      expect(authority.admit(name)).toEqual({ ok: false, reason: 'Choose a city name of up to 24 characters.' });
    }
    expect(cityNames(authority)).toEqual([]);
  });

  test('admission is capped and admits nobody once full', () => {
    const { authority } = freshAuthority(cleanups);
    for (let i = 0; i < ACTOR_CAP; i++) admit(authority);
    expect(authority.admit('Tycho')).toEqual({ ok: false, reason: 'No admission slots remain.' });
  }, 120_000);
});

describe('a genuinely valid claim, founding and a real build', () => {
  test('an admitted actor claims an island, founds it, and rebuilds a road it removed', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const city = authority.snapshot().cities.find((c) => c.id === cityId)!;
    expect(city.roads.length).toBeGreaterThan(0);
    const tile = roadTileOf(authority, cityId);
    const moneyBeforeDemolish = city.money;

    const removal = authority.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(removal.ok).toBe(true);
    const rebuild = authority.submit(credential, 4, rid(4), { kind: 'command', cityId, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } });

    expect(rebuild.status).toBe('processed');
    expect(rebuild.ok).toBe(true);
    const after = authority.snapshot().cities.find((c) => c.id === cityId)!;
    expect(after.roads.length).toBe(city.roads.length);
    expect(after.money).toBeLessThan(moneyBeforeDemolish);
  });
});

describe('sessions', () => {
  test('authenticate exposes the actor, its next sequence, its owned cities and its retained receipt floor', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);

    const session = authority.authenticate(credential)!;
    expect(session.nextSeq).toBe(3);
    expect(session.ownedCityIds).toEqual([cityId]);
    expect(session.receiptWatermark).toBe(0);
    expect(authority.authenticate('bogus')).toBeNull();
  });
});

describe('foreign denial and the one-initial-claim policy', () => {
  test('the owner can remove an owned road; an intruder issuing the same command is refused and nothing changes', () => {
    const { authority } = freshAuthority(cleanups);
    const owner = foundedActor(authority, 0);
    const intruderCredential = admit(authority);
    const tile = roadTileOf(authority, owner.cityId);

    const beforeIntrusion = authority.snapshot();
    const beforeIntruderSequence = sequenceRow(authority, intruderCredential);
    const intrusion = authority.submit(intruderCredential, 1, rid(11), { kind: 'command', cityId: owner.cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(intrusion).toEqual({ ok: false, reason: 'Foreign city.', cityId: owner.cityId, status: 'processed' });
    expect(authority.snapshot()).toEqual(beforeIntrusion);
    expect(sequenceRow(authority, intruderCredential)).toEqual({ watermark: beforeIntruderSequence.watermark + 1, receiptCount: beforeIntruderSequence.receiptCount + 1 });

    const ownerRemoval = authority.submit(owner.credential, 3, rid(12), { kind: 'command', cityId: owner.cityId, command: { type: 'demolish', x: tile.x, z: tile.z } });
    expect(ownerRemoval.ok).toBe(true);
    const cityAfter = authority.snapshot().cities.find((c) => c.id === owner.cityId)!;
    expect(cityAfter.roads).not.toContain(tile.index);
  });

  test('a second claim by the same actor is rejected, whether or not the first is founded', () => {
    const { authority } = freshAuthority(cleanups);
    const credential = admit(authority);
    const pendingClaim = authority.submit(credential, 1, rid(1), claimFor(0));
    expect(pendingClaim.ok).toBe(true);

    const before = authority.snapshot();
    const second = authority.submit(credential, 2, rid(2), claimFor(1));

    expect(second).toEqual({ ok: false, reason: 'This actor already holds an island claim.', cityId: undefined, status: 'processed' });
    expect(authority.snapshot()).toEqual(before);
  });

  test('two actors cannot claim the same island', () => {
    const { authority } = freshAuthority(cleanups);
    const first = admit(authority);
    const second = admit(authority);
    expect(authority.submit(first, 1, rid(1), claimFor(0)).ok).toBe(true);

    const result = authority.submit(second, 1, rid(2), claimFor(0));
    expect(result.ok).toBe(false);
  });
});

describe('sequencing basics', () => {
  test('an unauthenticated credential is rejected without any write', () => {
    const { authority } = freshAuthority(cleanups);
    const before = authority.snapshot();
    const result = authority.submit('bogus-credential', 1, rid(1), claimFor(0));
    expect(result).toEqual({ ok: false, reason: 'Unauthenticated.', status: 'unauthenticated' });
    expect(authority.snapshot()).toEqual(before);
  });

  test('an unrecognized request shape, or a malformed request id, is rejected without any write, including to the private sequence and receipt tables', () => {
    const { authority } = freshAuthority(cleanups);
    const credential = admit(authority);
    const before = authority.snapshot();
    const beforeSequence = sequenceRow(authority, credential);

    const shapeResult = authority.submit(credential, 1, rid(1), { kind: 'unknown', anything: true } as never);
    expect(shapeResult).toEqual({ ok: false, reason: 'Unrecognized request shape.', status: 'invalid-request' });
    const idResult = authority.submit(credential, 1, 'not-a-valid-id', claimFor(0));
    expect(idResult).toEqual({ ok: false, reason: 'Invalid request id.', status: 'invalid-request' });

    expect(authority.snapshot()).toEqual(before);
    expect(sequenceRow(authority, credential)).toEqual(beforeSequence);
  });

  test('resubmitting the same seq, request id and payload returns the prior outcome without reapplying it', () => {
    const { authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const harbour = authority.snapshot().cities.find((c) => c.id === cityId)!.harbour;
    const foundRequest = { kind: 'command' as const, cityId, command: { type: 'roadPath', tiles: harbourApron(harbour.x, harbour.z, harbour.rotation) } };

    const replay = authority.submit(credential, 2, rid(2), foundRequest);

    expect(replay.ok).toBe(true);
    expect(replay.status).toBe('replayed');
    expect(replay.reason).not.toContain('already');
  });
});

describe('restart', () => {
  test('the World, ownership, sequence and realm id survive closing and reopening the store', () => {
    const { path, authority } = freshAuthority(cleanups);
    const { credential, cityId } = foundedActor(authority, 0);
    const realmId = authority.realmId;
    authority.close();

    const reopened = Authority.open(path);
    cleanups.push(() => reopened.close());
    expect(reopened.realmId).toBe(realmId);
    const city = reopened.snapshot().cities.find((c) => c.id === cityId)!;
    expect(city.roads.length).toBeGreaterThan(0);

    const replay = reopened.submit(credential, 2, rid(2), { kind: 'command', cityId, command: { type: 'roadPath', tiles: harbourApron(city.harbour.x, city.harbour.z, city.harbour.rotation) } });
    expect(replay.status).toBe('replayed');

    const next = reopened.submit(credential, 3, rid(3), { kind: 'command', cityId, command: { type: 'demolish', x: 0, z: 0 } });
    expect(next.ok).toBe(false);
  });
});
