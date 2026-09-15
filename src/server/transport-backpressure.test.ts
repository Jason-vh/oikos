import { afterEach, expect, test } from 'bun:test';
import { connect, fixture } from './transport-fixtures.test';
import { WirePeer } from './wire-fixtures.test';
import { claimFor, foundedActor, rid } from './authority-fixtures.test';
import { Authority } from './authority';
import { MAX_REQUEST_BYTES } from './protocol';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('refuses compression so browser frames arrive, and limits incoming payloads', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const wire = new WirePeer(f.base, f.origin, cookie, true);
  cleanups.push(() => wire.close());
  await wire.waitFor(() => wire.packets.length === 1);
  expect(wire.packets[0].type).toBe('snapshot');
  expect(wire.frames[0].compressed).toBe(false);
  wire.send(JSON.stringify({ type: 'request', binding: wire.binding, requestId: rid(1), seq: 1, operation: claimFor(0) }));
  await wire.waitFor(() => wire.packets.some((packet) => packet.type === 'receipt'));
  const receipt = wire.packets.find((packet) => packet.type === 'receipt');
  expect(receipt).toMatchObject({ result: { ok: true, status: 'processed' } });
  wire.send('x'.repeat(MAX_REQUEST_BYTES + 1));
  await wire.waitClosed();
  const { snapshot } = await connect(cleanups, f, cookie);
  expect(snapshot.session.nextSeq).toBe(2);
  expect(snapshot.world.cities).toHaveLength(1);
  expect(f.runtime.healthy).toBe(true);
});

test('a slow reader skips snapshots rather than queueing them, and still receives its receipts', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const wire = new WirePeer(f.base, f.origin, cookie);
  cleanups.push(() => wire.close());
  await wire.waitFor(() => wire.packets.length === 1);
  wire.socket.pause();
  const fast = await connect(cleanups, f, cookie);
  let latest = 0;
  for (let i = 0; i < 24; i++) {
    f.clock.step();
    latest = (await fast.peer.next('snapshot')).serial;
  }
  f.clock.time += 250;
  wire.send(JSON.stringify({ type: 'request', binding: wire.binding, requestId: rid(1), seq: 1, operation: claimFor(0) }));
  expect((await fast.peer.next('snapshot')).session.nextSeq).toBe(2);
  wire.socket.resume();
  await wire.waitFor(() => wire.packets.some((packet) => packet.type === 'receipt'));
  expect(wire.packets.find((packet) => packet.type === 'receipt')).toMatchObject({ result: { ok: true, status: 'processed' } });
  expect(wire.packets.filter((packet) => packet.type === 'snapshot').at(-1)!.serial).toBeLessThanOrEqual(latest + 1);
  expect(f.runtime.server.pendingWebSockets).toBe(2);
  expect(f.runtime.healthy).toBe(true);
});

test('a receipt is followed at once by the snapshot that resolves it; rejects keep the four-Hz cap', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const { peer } = await connect(cleanups, f, cookie);
  peer.send(1, claimFor(0));
  expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'receipt', seq: 1, result: { ok: true } });
  expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'snapshot', session: { nextSeq: 2 }, world: { cities: [{ home: 0 }] } });
  for (let seq = 2; seq <= 8; seq++) {
    peer.send(seq, claimFor(1));
    expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'receipt', seq, result: { ok: false } });
    expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'snapshot', session: { nextSeq: seq + 1 } });
  }
  expect(peer.packets).toEqual([]);
  peer.ws.send('{');
  expect((await peer.next('reject')).code).toBe('invalid-request');
  expect(peer.packets).toEqual([]);
  f.clock.step();
  expect(await peer.next('snapshot')).toMatchObject({ session: { nextSeq: 9 } });
});

test('shutdown completes with an OPEN paused reader and checkpoints the last live World', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => { actor = foundedActor(authority, 0); });
  const cookie = `__Host-oikos=${actor.credential}`;
  const wire = new WirePeer(f.base, f.origin, cookie);
  cleanups.push(() => wire.close());
  await wire.waitFor(() => wire.packets.length === 1);
  wire.socket.pause();
  const fast = await connect(cleanups, f, cookie);
  let world = fast.snapshot.world;
  for (let i = 0; i < 100; i++) {
    f.clock.step();
    world = (await fast.peer.next('snapshot')).world;
  }
  expect(world.time).toBeGreaterThan(fast.snapshot.world.time);
  expect(wire.socket.isPaused()).toBe(true);
  await f.runtime.stop();
  await fast.peer.closed;
  expect(wire.socket.isPaused()).toBe(true);
  f.clock.step(1000);
  const reopened = Authority.open(f.path);
  try { expect(reopened.snapshot()).toEqual(world); } finally { reopened.close(); }
});

test('a snapshot carries the whole world in a frame small enough to be read at a glance', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => { actor = foundedActor(authority, 0); });
  const { peer, snapshot } = await connect(cleanups, f, `__Host-oikos=${actor.credential}`);
  expect(snapshot.world.wildlife.length).toBeGreaterThan(2000);
  expect(JSON.stringify(snapshot.world.wildlife.map((animal) => animal.id)).length).toBeGreaterThan(9000);
  f.clock.step();
  const next = await peer.next('snapshot');
  expect(next.world.wildlife).toEqual(snapshot.world.wildlife);
  expect(JSON.stringify({ ...next.world, wildlife: [] }).length).toBeLessThan(2000);
});

test('an immediate snapshot rides beside the steady rhythm rather than displacing it', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => { actor = foundedActor(authority, 0); });
  const { peer } = await connect(cleanups, f, `__Host-oikos=${actor.credential}`);
  f.clock.step();
  expect(await peer.next('snapshot')).toBeDefined();
  f.clock.time += 100;
  peer.send(3, claimFor(1));
  expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'receipt', seq: 3 });
  expect(await peer.next(['receipt', 'snapshot'])).toMatchObject({ type: 'snapshot' });
  f.clock.step(150);
  expect((await peer.next('snapshot')).world.time).toBeGreaterThan(0);
});

test('a beat is the cadence, not a request against the throttle between beats', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => { actor = foundedActor(authority, 0); });
  const { peer } = await connect(cleanups, f, `__Host-oikos=${actor.credential}`);
  for (let beat = 1; beat <= 6; beat++) {
    f.clock.step(249);
    expect((await peer.next('snapshot')).serial).toBe(beat + 1);
  }
});
