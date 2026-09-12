import { afterEach, expect, test } from 'bun:test';
import { Authority } from './authority';
import { admit, foundedActor, rawDb, rid } from './authority-fixtures.test';
import { connect, fixture, Peer } from './transport-fixtures.test';
import { MAX_REQUEST_BYTES } from './protocol';
import { startServer } from './runtime';
import { readWorldRow, selectAll } from './store';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('admissions bound JSON, type and per-IP attempts without poisoning or consuming denied invites', async () => {
  const f = await fixture(cleanups);
  const post = (body: string, contentType = 'application/json') => fetch(`${f.base}/api/session/redeem`, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': contentType }, body });
  expect((await post('{')).status).toBe(400);
  expect((await post(JSON.stringify({ invite: f.invites[0] }), 'text/plain')).status).toBe(400);
  expect((await post(JSON.stringify({ invite: f.invites[0], actorId: 1 }))).status).toBe(400);
  const oversized = await post(JSON.stringify({ invite: f.invites[0], padding: 'x'.repeat(1024) }));
  expect([400, 413]).toContain(oversized.status);
  f.clock.step(60_000);
  for (let i = 0; i < 5; i++) expect((await f.redeem('0'.repeat(64))).status).toBe(403);
  expect((await f.redeem(f.invites[0])).status).toBe(429);
  f.clock.step(12_000);
  const cookie = await f.cookie();
  expect((await connect(cleanups, f, cookie)).snapshot.session.nextSeq).toBe(1);
  expect(f.runtime.healthy).toBe(true);
});

test('a full realm denies normally and retains the unused invite', async () => {
  const f = await fixture(cleanups, (authority) => { for (let i = 0; i < 8; i++) admit(authority); });
  expect((await f.redeem(f.invites[0])).status).toBe(403);
  expect(f.runtime.healthy).toBe(true);
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(selectAll(rawDb(reopened), 'SELECT consumed_by FROM invites WHERE consumed_by IS NULL')).toHaveLength(8);
    expect(reopened.issueInvite()).toMatch(/^[a-f0-9]{64}$/);
  } finally { reopened.close(); }
});

test('request rate is shared by actor across sockets; malformed, binary and oversized inputs never mutate state', async () => {
  let credential!: string;
  const f = await fixture(cleanups, (authority) => { credential = admit(authority); });
  const a = await connect(cleanups, f, `__Host-oikos=${credential}`);
  const b = await connect(cleanups, f, `__Host-oikos=${credential}`);
  for (let i = 0; i < 16; i++) {
    const peer = i % 2 ? a.peer : b.peer;
    peer.ws.send(i === 0 ? new Uint8Array([1, 2]) : '{');
    expect((await peer.next('reject')).code).toBe('invalid-request');
  }
  b.peer.send(1, { kind: 'claim', home: 0 });
  expect((await b.peer.next('reject')).code).toBe('rate-limited');
  f.clock.time += 125;
  b.peer.send(1, { kind: 'claim', home: 0 });
  expect((await b.peer.next('receipt')).result.ok).toBe(true);
  a.peer.ws.send('x'.repeat(MAX_REQUEST_BYTES + 1));
  await a.peer.closed;
  expect(a.peer.packets.filter((packet) => packet.type === 'receipt')).toEqual([]);
  expect(f.runtime.healthy).toBe(true);
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot().cities).toHaveLength(1);
    expect(reopened.authenticate(credential)?.nextSeq).toBe(2);
    expect(selectAll(rawDb(reopened), 'SELECT seq FROM receipts')).toEqual([{ seq: 1 }]);
  } finally { reopened.close(); }
});

test('WebSocket upgrades enforce Origin, authentication and per-actor socket capacity', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  for (const [origin, token] of [['https://foreign.example', cookie], [f.origin, ''], ['', cookie]]) {
    const peer = new Peer(f.base, origin, token);
    cleanups.push(() => peer.close());
    await peer.closed;
    expect(peer.packets).toEqual([]);
  }
  const peers = [];
  for (let i = 0; i < 8; i++) peers.push(await connect(cleanups, f, cookie));
  const denied = new Peer(f.base, f.origin, cookie);
  cleanups.push(() => denied.close());
  await denied.closed;
  expect(denied.packets).toEqual([]);
  await peers[0].peer.close();
  await fetch(`${f.base}/healthz`);
  expect((await connect(cleanups, f, cookie)).snapshot.session.nextSeq).toBe(1);
  expect(f.runtime.healthy).toBe(true);
});

test('invalid public origins never start a listener or initialize a missing world', async () => {
  const f = await fixture(cleanups);
  for (const publicOrigin of ['http://game.example', 'https://game.example/path', 'https://game.example/', 'https://user:pass@game.example']) {
    expect(() => startServer({ path: `${f.path}.absent`, publicOrigin, port: 0 })).toThrow('publicOrigin');
  }
});

test('durable command failure closes the socket without a false receipt or divergent World', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  const f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    rawDb(authority).run("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts WHEN NEW.seq > 3 BEGIN SELECT RAISE(ABORT, 'blocked receipt'); END;");
  });
  const { peer, snapshot } = await connect(cleanups, f, `__Host-oikos=${actor.credential}`);
  const city = snapshot.world.cities[0];
  const index = city.roads[0];
  const { islandFor, tileAtOn } = await import('../sim/island');
  const tile = tileAtOn(islandFor(snapshot.world.seed, city.home), index);
  peer.send(3, { kind: 'command', cityId: city.id, command: { type: 'demolish', x: tile.x, z: tile.z } });
  expect((await peer.next('receipt')).result.ok).toBe(true);
  peer.send(4, { kind: 'command', cityId: city.id, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } }, rid(4));
  await f.runtime.failed;
  await peer.closed;
  await f.runtime.stop();
  expect(peer.packets.filter((packet) => packet.type === 'receipt')).toEqual([]);
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot().cities[0].roads).not.toContain(index);
    expect(reopened.authenticate(actor.credential)?.nextSeq).toBe(4);
    expect(readWorldRow(rawDb(reopened)).world).toEqual(reopened.snapshot());
  } finally { reopened.close(); }
});
