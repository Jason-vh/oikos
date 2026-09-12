import { afterEach, expect, test } from 'bun:test';
import { connect, fixture } from './transport-fixtures.test';
import { WirePeer } from './wire-fixtures.test';
import { foundedActor, rid } from './authority-fixtures.test';
import { Authority } from './authority';
import { MAX_REQUEST_BYTES } from './protocol';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('negotiates real compression and limits decompressed incoming payloads', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const wire = new WirePeer(f.base, f.origin, cookie, true);
  cleanups.push(() => wire.close());
  await wire.waitFor(() => wire.packets.length === 1);
  expect(wire.packets[0].type).toBe('snapshot');
  expect(wire.frames[0].compressed).toBe(true);
  expect(wire.frames[0].bytes).toBeLessThan(JSON.stringify(wire.packets[0]).length);
  wire.send(JSON.stringify({ type: 'request', requestId: rid(1), seq: 1, operation: { kind: 'claim', home: 0 } }), true);
  await wire.waitFor(() => wire.packets.some((packet) => packet.type === 'receipt'));
  const receipt = wire.packets.find((packet) => packet.type === 'receipt');
  expect(receipt).toMatchObject({ result: { ok: true, status: 'processed' } });
  wire.send('x'.repeat(MAX_REQUEST_BYTES + 1), true);
  await wire.closed;
  const { snapshot } = await connect(cleanups, f, cookie);
  expect(snapshot.session.nextSeq).toBe(2);
  expect(snapshot.world.cities).toHaveLength(1);
  expect(f.runtime.healthy).toBe(true);
});

test('slow readers do not queue every snapshot or stall peers; control backpressure disconnects for replay', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const wire = new WirePeer(f.base, f.origin, cookie);
  cleanups.push(() => wire.close());
  await wire.waitFor(() => wire.packets.length === 1);
  wire.socket.pause();
  const fast = await connect(cleanups, f, cookie);
  let latest = fast.snapshot.serial;
  for (let i = 0; i < 200; i++) {
    f.clock.step();
    latest = (await fast.peer.next('snapshot')).serial;
  }
  f.clock.time += 250;
  wire.send(JSON.stringify({ type: 'request', requestId: rid(1), seq: 1, operation: { kind: 'claim', home: 0 } }));
  expect((await fast.peer.next('snapshot')).session.nextSeq).toBe(2);
  wire.socket.resume();
  await wire.closed;
  const snapshots = wire.packets.filter((packet) => packet.type === 'snapshot');
  expect(snapshots.length).toBeGreaterThan(1);
  expect(snapshots.length).toBeLessThan(200);
  expect(snapshots.at(-1)!.serial).toBeLessThan(latest);
  const reconnected = await connect(cleanups, f, cookie);
  expect(reconnected.snapshot.world.cities).toHaveLength(1);
  reconnected.peer.send(1, { kind: 'claim', home: 0 });
  expect((await reconnected.peer.next('receipt')).result.status).toBe('replayed');
  expect(reconnected.snapshot.serial).toBeGreaterThan(latest);
  expect(f.runtime.healthy).toBe(true);
});

test('receipts precede current snapshots without raising the four-Hz snapshot cap', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const { peer } = await connect(cleanups, f, cookie);
  peer.send(1, { kind: 'claim', home: 0 });
  expect((await peer.next('receipt')).result.ok).toBe(true);
  for (let seq = 2; seq <= 8; seq++) {
    peer.send(seq, { kind: 'claim', home: 1 });
    expect((await peer.next('receipt')).result.ok).toBe(false);
  }
  expect(peer.packets).toEqual([]);
  f.clock.step(249);
  peer.ws.send('{');
  expect((await peer.next('reject')).code).toBe('invalid-request');
  expect(peer.packets).toEqual([]);
  f.clock.step(1);
  const snapshot = await peer.next('snapshot');
  expect(snapshot.session.nextSeq).toBe(9);
  expect(snapshot.world.cities).toHaveLength(1);
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
