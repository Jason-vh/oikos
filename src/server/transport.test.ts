import { afterEach, expect, test } from 'bun:test';
import { claimFor } from './authority-fixtures.test';
import { Authority } from './authority';
import { deserializeSharedWorld, serializeWorld } from '../sim/save';
import { harbourApron } from '../sim/founding';
import { connect, fixture, withoutWildlife } from './transport-fixtures.test';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('joins only from the configured origin, keeps credentials solely in the secure cookie', async () => {
  const f = await fixture(cleanups);
  expect((await f.joinAs('Tycho', { Origin: 'https://foreign.example' })).status).toBe(403);
  expect((await fetch(`${f.base}/api/world`, { headers: { Origin: f.origin } })).status).toBe(401);
  expect((await fetch(`${f.base}/api/world`)).status).toBe(403);
  const response = await f.joinAs('Tycho');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toMatch(/^__Host-oikos=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000$/);
  expect(await response.json()).toEqual({ ok: true });
  expect((await f.joinAs('Kleio', { Cookie: cookie.split(';')[0] })).status).toBe(409);
  const admitted = await f.cookie('Kleio');
  expect((await fetch(`${f.base}/api/world`, { headers: { Origin: 'https://foreign.example', Cookie: admitted, Upgrade: 'websocket' } })).status).toBe(403);
  const { snapshot } = await connect(cleanups, f, admitted);
  expect(Object.keys(snapshot).sort()).toEqual(['protocol', 'realmId', 'serial', 'session', 'streamId', 'type', 'world']);
  expect(snapshot.protocol).toBe(5);
  expect(snapshot.session.binding).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.session).toEqual({ binding: snapshot.session.binding, ownedCityIds: [], nextSeq: 1, receiptWatermark: 0 });
  expect(deserializeSharedWorld(serializeWorld(snapshot.world))).toEqual(snapshot.world);
  expect(JSON.stringify(snapshot)).not.toContain('actorId');
  expect(JSON.stringify(snapshot)).not.toContain(admitted.slice('__Host-oikos='.length));
  expect(f.runtime.healthy).toBe(true);
});

test('previews the world before admission and reports whether the visitor is known', async () => {
  const f = await fixture(cleanups);
  expect((await fetch(`${f.base}/api/world/preview`, { headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
  expect((await fetch(`${f.base}/api/world/preview`, { method: 'POST', headers: { Origin: f.origin } })).status).toBe(405);
  const anonymous = await fetch(`${f.base}/api/world/preview`);
  expect(anonymous.status).toBe(200);
  expect(anonymous.headers.get('cache-control')).toBe('no-store');
  const stranger = await anonymous.json() as { known: boolean; world: unknown };
  expect(stranger.known).toBe(false);
  expect(deserializeSharedWorld(JSON.stringify(stranger.world))).not.toBeNull();
  const cookie = await f.cookie('Tycho');
  const response = await fetch(`${f.base}/api/world/preview`, { headers: { Origin: f.origin, Cookie: cookie } });
  const admitted = await response.json() as { known: boolean; world: unknown };
  expect(admitted.known).toBe(true);
  expect(JSON.stringify(admitted)).not.toContain(cookie.slice('__Host-oikos='.length));
  expect(f.runtime.healthy).toBe(true);
});

test('two authenticated actors claim and found distinct cities; snapshots survive shared loading and restart', async () => {
  const f = await fixture(cleanups);
  const cookieA = await f.cookie('Tycho');
  const cookieB = await f.cookie('Kleio');
  const a = await connect(cleanups, f, cookieA);
  const b = await connect(cleanups, f, cookieB);
  for (const [home, connection] of [a, b].entries()) {
    connection.peer.send(1, claimFor(home));
    const receipt = await connection.peer.next('receipt');
    expect(receipt.result).toMatchObject({ status: 'processed', ok: true });
    expect((await connection.peer.next('snapshot')).session.ownedCityIds).toHaveLength(1);
  }
  f.clock.step();
  const claimSnapshot = await a.peer.next('snapshot');
  expect(claimSnapshot.world.cities.map((city) => city.home)).toEqual([0, 1]);
  expect((await b.peer.next('snapshot')).serial).toBe(claimSnapshot.serial);
  for (const [index, connection] of [a, b].entries()) {
    const city = claimSnapshot.world.cities[index];
    connection.peer.send(2, { kind: 'command', cityId: city.id, command: { type: 'roadPath', tiles: harbourApron(city.harbour.x, city.harbour.z, city.harbour.rotation) } });
    expect((await connection.peer.next('receipt')).result.ok).toBe(true);
    expect((await connection.peer.next('snapshot')).world.cities[index].roads.length).toBeGreaterThan(0);
  }
  f.clock.step();
  const founded = await a.peer.next('snapshot');
  expect(founded.world.cities.every((city) => city.roads.length > 0)).toBe(true);
  expect(founded.world.time).toBeGreaterThan(0);
  expect(founded.session.ownedCityIds).toEqual([founded.world.cities[0].id]);
  expect(founded.serial).toBeGreaterThan(claimSnapshot.serial);
  expect(deserializeSharedWorld(serializeWorld(founded.world))).toEqual(founded.world);
  await a.peer.close();
  await b.peer.close();
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.realmId).toBe(founded.realmId);
    expect(withoutWildlife(reopened.snapshot())).toEqual(withoutWildlife(founded.world));
    expect(reopened.snapshot().wildlife).toHaveLength(founded.world.wildlife.length);
  } finally { reopened.close(); }
});
