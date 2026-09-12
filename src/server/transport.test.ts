import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { deserializeSharedWorld } from '../sim/save';
import { connect, fixture } from './transport-fixtures.test';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('redeems only same-origin invites, keeps credentials solely in the secure cookie', async () => {
  const f = await fixture(cleanups);
  expect((await f.redeem(f.invites[0], { Origin: 'https://foreign.example' })).status).toBe(403);
  expect((await fetch(`${f.base}/api/world`, { headers: { Origin: f.origin } })).status).toBe(401);
  expect((await fetch(`${f.base}/api/world`)).status).toBe(403);
  const response = await f.redeem(f.invites[0]);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toMatch(/^__Host-oikos=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000$/);
  expect(await response.json()).toEqual({ ok: true });
  expect((await f.redeem(f.invites[1], { Cookie: cookie.split(';')[0] })).status).toBe(409);
  expect((await f.redeem(f.invites[0])).status).toBe(403);
  const admitted = await f.cookie(f.invites[1]);
  expect((await fetch(`${f.base}/api/world`, { headers: { Origin: 'https://foreign.example', Cookie: admitted, Upgrade: 'websocket' } })).status).toBe(403);
  const { snapshot } = await connect(cleanups, f, admitted);
  expect(Object.keys(snapshot).sort()).toEqual(['protocol', 'realmId', 'serial', 'session', 'streamId', 'type', 'world']);
  expect(snapshot.session).toEqual({ ownedCityIds: [], nextSeq: 1, receiptWatermark: 0 });
  expect(deserializeSharedWorld(JSON.stringify(snapshot.world))).toEqual(snapshot.world);
  expect(JSON.stringify(snapshot)).not.toContain('actorId');
  expect(JSON.stringify(snapshot)).not.toContain(admitted.slice('__Host-oikos='.length));
  expect(f.runtime.healthy).toBe(true);
});

test('two authenticated actors claim and found distinct cities; snapshots survive shared loading and restart', async () => {
  const f = await fixture(cleanups);
  const cookieA = await f.cookie();
  const cookieB = await f.cookie(f.invites[1]);
  const a = await connect(cleanups, f, cookieA);
  const b = await connect(cleanups, f, cookieB);
  for (const [home, connection] of [a, b].entries()) {
    connection.peer.send(1, { kind: 'claim', home });
    const receipt = await connection.peer.next('receipt');
    expect(receipt.result).toMatchObject({ status: 'processed', ok: true });
  }
  f.clock.step();
  const claimSnapshot = await a.peer.next('snapshot');
  expect(claimSnapshot.world.cities.map((city) => city.home)).toEqual([0, 1]);
  for (const [index, connection] of [a, b].entries()) {
    const city = claimSnapshot.world.cities[index];
    connection.peer.send(2, { kind: 'command', cityId: city.id, command: { type: 'foundHarbour', x: city.harbour.x, z: city.harbour.z } });
    expect((await connection.peer.next('receipt')).result.ok).toBe(true);
  }
  f.clock.step();
  const founded = await a.peer.next('snapshot');
  expect(founded.world.cities.every((city) => city.founded)).toBe(true);
  expect(founded.world.time).toBeGreaterThan(0);
  expect(founded.session.ownedCityIds).toEqual([founded.world.cities[0].id]);
  expect(founded.serial).toBeGreaterThan(claimSnapshot.serial);
  expect(deserializeSharedWorld(JSON.stringify(founded.world))).toEqual(founded.world);
  await a.peer.close();
  await b.peer.close();
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.realmId).toBe(founded.realmId);
    expect(reopened.snapshot()).toEqual(founded.world);
  } finally { reopened.close(); }
});
