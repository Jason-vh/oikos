import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { foundedActor, rawDb, rid, roadTileOf } from './authority-fixtures.test';
import { connect, fixture } from './transport-fixtures.test';
import { WirePeer } from './wire-fixtures.test';
import { readWorldRow, selectAll } from './store';
import type { AuthorityRequest } from './authority';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function stored(authority: Authority) {
  const db = rawDb(authority);
  return {
    world: readWorldRow(db),
    sequences: selectAll(db, 'SELECT * FROM sequences ORDER BY actor_id'),
    receipts: selectAll(db, 'SELECT * FROM receipts ORDER BY actor_id, seq'),
  };
}

test('foreign mutable targets fail without retargeting; actor-global races, gaps, injection and logical failures', async () => {
  let a!: ReturnType<typeof foundedActor>;
  let b!: ReturnType<typeof foundedActor>;
  let tile!: ReturnType<typeof roadTileOf>;
  const f = await fixture(cleanups, (authority) => {
    a = foundedActor(authority, 0);
    b = foundedActor(authority, 1);
    tile = roadTileOf(authority, b.cityId);
  });
  const owner = await connect(cleanups, f, `__Host-oikos=${b.credential}`);
  const foreign = await connect(cleanups, f, `__Host-oikos=${a.credential}`);
  const same = await connect(cleanups, f, `__Host-oikos=${b.credential}`);
  const remove: AuthorityRequest = { kind: 'command', cityId: b.cityId, command: { type: 'demolish', x: tile.x, z: tile.z } };
  foreign.peer.send(3, remove);
  expect((await foreign.peer.next('receipt')).result).toMatchObject({ ok: false, status: 'processed', cityId: b.cityId });
  owner.peer.send(3, remove);
  same.peer.send(3, remove, rid(300));
  const race = await Promise.all([owner.peer.next(['receipt', 'reject']), same.peer.next(['receipt', 'reject'])]);
  expect(race.filter((packet) => packet.type === 'receipt').map((packet) => packet.result)).toMatchObject([{ ok: true, status: 'processed' }]);
  expect(race.filter((packet) => packet.type === 'reject').map((packet) => packet.code)).toEqual(['conflict']);
  owner.peer.send(4, { kind: 'command', cityId: b.cityId, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } });
  expect((await owner.peer.next('receipt')).result.ok).toBe(true);
  const rebuilt = await connect(cleanups, f, `__Host-oikos=${b.credential}`);
  expect(rebuilt.snapshot.world.cities[1].roads).toContain(tile.index);
  const cursor = { ownedCityIds: [b.cityId], nextSeq: 5, receiptWatermark: 0 };
  owner.peer.send(6, remove);
  expect(await owner.peer.next('reject')).toEqual({ type: 'reject', code: 'gap', session: cursor });
  owner.peer.send(3, remove, rid(3333));
  expect(await owner.peer.next('reject')).toEqual({ type: 'reject', code: 'conflict', session: cursor });
  for (const injection of [{ actorId: a.cityId }, { world: { cities: [] } }]) {
    owner.peer.ws.send(JSON.stringify({ type: 'request', seq: 5, requestId: rid(5), operation: remove, ...injection }));
    expect(await owner.peer.next('reject')).toEqual({ type: 'reject', code: 'invalid-request', session: cursor });
  }
  const unchanged = await connect(cleanups, f, `__Host-oikos=${b.credential}`);
  expect(unchanged.snapshot.world).toEqual(rebuilt.snapshot.world);
  expect(unchanged.snapshot.session).toEqual(cursor);
  owner.peer.send(5, { kind: 'claim', home: 2 });
  expect((await owner.peer.next('receipt')).result).toMatchObject({ ok: false, status: 'processed' });
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    const world = reopened.snapshot();
    expect(world.time).toBe(owner.snapshot.world.time);
    expect(world.cities[0]).toEqual(owner.snapshot.world.cities[0]);
    expect(world).toEqual(rebuilt.snapshot.world);
    expect(world.cities[1].roads).toContain(tile.index);
    expect(reopened.authenticate(a.credential)?.nextSeq).toBe(4);
    expect(reopened.authenticate(b.credential)?.nextSeq).toBe(6);
    expect(selectAll(rawDb(reopened), 'SELECT seq FROM receipts WHERE actor_id = 2 ORDER BY seq')).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 }]);
  } finally { reopened.close(); }
});

test('exact acknowledgement-loss replay survives reconnect; rebuilt road survives retained and pruned replay', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  let tile!: ReturnType<typeof roadTileOf>;
  const f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    tile = roadTileOf(authority, actor.cityId);
  });
  const cookie = `__Host-oikos=${actor.credential}`;
  const first = new WirePeer(f.base, f.origin, cookie);
  cleanups.push(() => first.close());
  await first.waitFor(() => first.packets.length === 1);
  first.socket.pause();
  const observer = await connect(cleanups, f, cookie);
  const remove: AuthorityRequest = { kind: 'command', cityId: actor.cityId, command: { type: 'demolish', x: tile.x, z: tile.z } };
  f.clock.time += 250;
  first.send(JSON.stringify({ type: 'request', requestId: rid(3), seq: 3, operation: remove }));
  expect((await observer.peer.next('snapshot')).session.nextSeq).toBe(4);
  await first.close();
  expect(first.packets.filter((packet) => packet.type === 'receipt')).toEqual([]);
  await observer.peer.close();
  const second = await connect(cleanups, f, cookie);
  expect(second.snapshot.session.nextSeq).toBe(4);
  expect(second.snapshot.world.cities[0].roads).not.toContain(tile.index);
  second.peer.send(3, remove);
  expect((await second.peer.next('receipt')).result).toMatchObject({ ok: true, status: 'replayed' });
  second.peer.send(4, { kind: 'command', cityId: actor.cityId, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } });
  expect((await second.peer.next('receipt')).result.ok).toBe(true);
  second.peer.send(3, remove);
  expect((await second.peer.next('receipt')).result.status).toBe('replayed');
  for (let seq = 5; seq <= 260; seq++) {
    f.clock.time += 125;
    second.peer.send(seq, { kind: 'claim', home: 1 });
    expect((await second.peer.next('receipt')).result).toMatchObject({ status: 'processed', ok: false });
  }
  second.peer.send(3, remove);
  expect(await second.peer.next('reject')).toEqual({ type: 'reject', code: 'pruned', session: { ownedCityIds: [actor.cityId], nextSeq: 261, receiptWatermark: 4 } });
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot().cities[0].roads).toContain(tile.index);
    expect(selectAll(rawDb(reopened), 'SELECT seq FROM receipts ORDER BY seq')).toEqual(Array.from({ length: 256 }, (_, index) => ({ seq: index + 5 })));
    const before = stored(reopened);
    expect(reopened.submit(actor.credential, 3, rid(3), remove).status).toBe('pruned');
    expect(stored(reopened)).toEqual(before);
  } finally { reopened.close(); }
});
