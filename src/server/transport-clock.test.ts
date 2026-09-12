import { afterEach, expect, test } from 'bun:test';
import { copyFileSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { Authority } from './authority';
import { foundedActor, rawDb, rid } from './authority-fixtures.test';
import { connect, fixture } from './transport-fixtures.test';
import { startServer } from './runtime';
import { readWorldRow } from './store';
import { deserializeSharedWorld } from '../sim/save';
import { planStarterNeighbourhood } from '../sim/scenario';
import { islandFor, tileAtOn } from '../sim/island';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function durable(path: string) {
  const copy = `${path}.inspection`;
  copyFileSync(path, copy);
  const db = new Database(copy, { readonly: true });
  try { return readWorldRow(db); } finally { db.close(); rmSync(copy); }
}

test('one remaining socket advances both cities; tick checkpoints, last close, restart and empty time never catch up', async () => {
  let a!: ReturnType<typeof foundedActor>;
  let b!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => {
    a = foundedActor(authority, 0);
    b = foundedActor(authority, 1);
    for (const actor of [a, b]) {
      const world = authority.snapshot();
      const city = world.cities.find((city) => city.id === actor.cityId)!;
      const farm = planStarterNeighbourhood(world, city)!.buildings[0];
      expect(authority.submit(actor.credential, 3, rid(3), { kind: 'command', cityId: city.id, command: { type: 'build', tool: farm.kind, x: farm.x, z: farm.z, rotation: 0 } }).ok).toBe(true);
    }
  });
  const initial = durable(f.path);
  f.clock.step(1000);
  const first = await connect(cleanups, f, `__Host-oikos=${a.credential}`);
  expect(first.snapshot.world).toEqual(initial.world);
  f.clock.time += 100;
  const second = await connect(cleanups, f, `__Host-oikos=${b.credential}`);
  f.clock.step(150);
  const both = await first.peer.next('snapshot');
  expect(both.world.time).toBeCloseTo(0.25);
  expect(durable(f.path)).toEqual(initial);
  await first.peer.close();
  f.clock.step(250);
  const remaining = await second.peer.next('snapshot');
  expect(remaining.world.time).toBeCloseTo(0.5);
  for (let i = 0; i < 2; i++) expect(remaining.world.cities[i].money).toBeLessThan(initial.world.cities[i].money);
  f.clock.step(4500);
  const checkpoint = await second.peer.next('snapshot');
  expect(checkpoint.world.time).toBeCloseTo(5);
  expect(durable(f.path).world).toEqual(checkpoint.world);
  f.clock.step(60_000);
  const gap = await second.peer.next('snapshot');
  expect(gap.world).toEqual(checkpoint.world);
  f.clock.time += 100;
  second.peer.send(4, { kind: 'claim', home: 2 });
  expect((await second.peer.next('receipt')).result.ok).toBe(false);
  f.clock.step(150);
  const settled = await second.peer.next('snapshot');
  expect(settled.world.time).toBeCloseTo(5.25);
  await second.peer.close();
  await fetch(`${f.base}/healthz`);
  expect(durable(f.path).world).toEqual(settled.world);
  f.clock.step(1000);
  const third = await connect(cleanups, f, `__Host-oikos=${a.credential}`);
  expect(third.snapshot.world).toEqual(settled.world);
  expect(third.snapshot.streamId).toBe(first.snapshot.streamId);
  expect(deserializeSharedWorld(JSON.stringify(third.snapshot.world))).toEqual(third.snapshot.world);
  await third.peer.close();
  await f.runtime.stop();
  f.clock.time += 1000;
  const restart = startServer({ path: f.path, publicOrigin: f.origin, port: 0, clock: f.clock });
  cleanups.push(() => restart.stop());
  const reconnected = await connect(cleanups, { ...f, runtime: restart, base: `http://127.0.0.1:${restart.server.port}` }, `__Host-oikos=${b.credential}`);
  expect(reconnected.snapshot.world).toEqual(settled.world);
  expect(reconnected.snapshot.realmId).toBe(first.snapshot.realmId);
  expect(reconnected.snapshot.streamId).not.toBe(first.snapshot.streamId);
});

test('a real checkpoint failure stops the listener and sockets, emits no false receipt, and preserves committed data', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    rawDb(authority).run("CREATE TRIGGER clock_limit BEFORE UPDATE ON world WHEN json_extract(NEW.data, '$.time') > 6 BEGIN SELECT RAISE(ABORT, 'checkpoint blocked'); END;");
  });
  const { peer } = await connect(cleanups, f, `__Host-oikos=${actor.credential}`);
  f.clock.step(5000);
  const baseline = await peer.next('snapshot');
  expect(baseline.world.time).toBeCloseTo(5);
  const committed = durable(f.path);
  expect(committed.world).toEqual(baseline.world);
  const city = baseline.world.cities[0];
  const tile = tileAtOn(islandFor(baseline.world.seed, city.home), city.roads[0]);
  peer.send(3, { kind: 'command', cityId: city.id, command: { type: 'demolish', x: tile.x, z: tile.z } });
  f.clock.step(5000);
  await f.runtime.failed;
  await peer.closed;
  await f.runtime.stop();
  expect(f.runtime.healthy).toBe(false);
  expect(peer.packets.filter((packet) => packet.type === 'receipt')).toEqual([]);
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot()).toEqual(committed.world);
    expect(reopened.authenticate(actor.credential)?.nextSeq).toBe(3);
  } finally { reopened.close(); }
  f.clock.step(5000);
  expect(durable(f.path)).toEqual(committed);
  expect(await fetch(`${f.base}/healthz`).then(() => true, () => false)).toBe(false);
});
