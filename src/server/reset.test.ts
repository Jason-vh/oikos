import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { claimFor } from './authority-fixtures.test';
import { connect, fixture } from './transport-fixtures.test';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function reset(base: string, origin: string, cookie: string): Promise<Response> {
  return fetch(`${base}/api/world/reset`, { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
}

test('a world the server does not offer to reset has no reset route', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie('Tycho');
  expect((await reset(f.base, f.origin, cookie)).status).toBe(404);
  const preview = await (await fetch(`${f.base}/api/world/preview`, { headers: { Origin: f.origin } })).json() as { canReset: boolean };
  expect(preview.canReset).toBe(false);
});

test('resetting needs a session of this origin, and only ever a POST', async () => {
  const f = await fixture(cleanups, () => {}, { allowReset: true });
  const cookie = await f.cookie('Tycho');
  expect((await fetch(`${f.base}/api/world/reset`, { method: 'GET', headers: { Origin: f.origin, Cookie: cookie } })).status).toBe(405);
  expect((await fetch(`${f.base}/api/world/reset`, { method: 'POST', headers: { Origin: f.origin } })).status).toBe(401);
  expect((await reset(f.base, 'https://foreign.example', cookie)).status).toBe(403);
  const preview = await (await fetch(`${f.base}/api/world/preview`, { headers: { Origin: f.origin } })).json() as { canReset: boolean };
  expect(preview.canReset).toBe(true);
});

test('a reset empties the archipelago, opens a new realm, and keeps every player admitted', async () => {
  const f = await fixture(cleanups, () => {}, { allowReset: true });
  const cookie = await f.cookie('Tycho');
  const founded = await connect(cleanups, f, cookie);
  founded.peer.send(1, claimFor(0));
  expect((await founded.peer.next('receipt')).result.ok).toBe(true);
  const before = await founded.peer.next('snapshot');
  expect(before.world.cities).toHaveLength(1);

  expect((await reset(f.base, f.origin, cookie)).status).toBe(200);
  await founded.peer.closed;

  const preview = await (await fetch(`${f.base}/api/world/preview`, { headers: { Origin: f.origin, Cookie: cookie } })).json() as { known: boolean };
  expect(preview.known).toBe(true);
  const rejoined = await connect(cleanups, f, cookie);
  expect(rejoined.snapshot.world.cities).toEqual([]);
  expect(rejoined.snapshot.realmId).not.toBe(before.realmId);
  expect(rejoined.snapshot.session).toEqual({ binding: rejoined.snapshot.session.binding, ownedCityIds: [], nextSeq: 1, receiptWatermark: 0 });
  expect(rejoined.snapshot.session.binding).not.toBe(before.session.binding);

  rejoined.peer.send(1, claimFor(0));
  expect((await rejoined.peer.next('receipt')).result.ok).toBe(true);
  expect((await rejoined.peer.next('snapshot')).world.cities).toHaveLength(1);
});

test('the store a reset leaves behind reopens with its invariants intact', async () => {
  const f = await fixture(cleanups, () => {}, { allowReset: true });
  const cookie = await f.cookie('Tycho');
  const connection = await connect(cleanups, f, cookie);
  connection.peer.send(1, claimFor(0));
  expect((await connection.peer.next('receipt')).result.ok).toBe(true);
  expect((await reset(f.base, f.origin, cookie)).status).toBe(200);
  await connection.peer.closed;
  await f.runtime.stop();

  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot().cities).toEqual([]);
    expect(reopened.authenticate(cookie.slice('__Host-oikos='.length))).toEqual({ actorId: 1, nextSeq: 1, ownedCityIds: [], receiptWatermark: 0 });
  } finally { reopened.close(); }
});
