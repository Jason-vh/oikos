import { afterEach, expect, test } from 'bun:test';
import { Authority, type AuthorityRequest } from '../server/authority';
import { foundedActor, rawDb } from '../server/authority-fixtures.test';
import { connect, fixture } from '../server/transport-fixtures.test';
import { WirePeer } from '../server/wire-fixtures.test';
import { startServer } from '../server/runtime';
import { readWorldRow, selectAll } from '../server/store';
import { islandFor, tileAtOn } from '../sim/island';
import { SharedSession, type SendOutcome, type SharedRequestOutcome, type SharedSessionInit, type SharedSnapshot } from './shared-session';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const PENDING_KEY = 'oikos.shared.pending.v1';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

function bunSocket(f: Awaited<ReturnType<typeof fixture>>, cookie: string): WebSocket {
  const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  return new BunWebSocket(`${f.base.replace('http:', 'ws:')}/api/world`, { headers: { Origin: f.origin, Cookie: cookie } });
}

function recordingBunSocket(f: Awaited<ReturnType<typeof fixture>>, cookie: string, sent: string[]): WebSocket {
  const socket = bunSocket(f, cookie);
  const rawSend = socket.send.bind(socket);
  socket.send = ((data: string) => { sent.push(data); return rawSend(data); }) as typeof socket.send;
  return socket;
}

class WirePeerSocket extends EventTarget {
  readonly wire: WirePeer;
  readyState: number = WebSocket.CONNECTING;
  private delivered = 0;
  private pumping = true;

  constructor(base: string, origin: string, cookie: string) {
    super();
    this.wire = new WirePeer(base, origin, cookie);
    this.wire.closed.then(() => {
      this.pumping = false;
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(new Event('close'));
    });
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.pumping) {
      try {
        await this.wire.waitFor(() => this.wire.packets.length > this.delivered);
      } catch {
        return;
      }
      while (this.delivered < this.wire.packets.length) {
        const packet = this.wire.packets[this.delivered];
        this.delivered += 1;
        if (this.readyState === WebSocket.CONNECTING) {
          this.readyState = WebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
        }
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(packet) }));
      }
    }
  }

  send(data: string): void {
    this.wire.send(data);
  }

  close(): void {
    this.pumping = false;
    void this.wire.close().catch(() => {});
  }
}

async function realClient(f: Awaited<ReturnType<typeof fixture>>, cookie: string, storage = new MemoryStorage(), connectOverride?: () => WebSocket, schedule?: SharedSessionInit['schedule']) {
  const snapshots: SharedSnapshot[] = [];
  const statuses: string[] = [];
  const outcomes: SharedRequestOutcome[] = [];
  let realmChanges = 0;
  let currentSocket: WebSocket | null = null;
  const session = new SharedSession(
    {
      connect: () => {
        const socket = connectOverride ? connectOverride() : bunSocket(f, cookie);
        currentSocket = socket;
        return socket;
      },
      storage,
      schedule,
    },
    {
      snapshot: (snapshot) => snapshots.push(snapshot),
      realmChanged: () => { realmChanges += 1; },
      status: (status) => statuses.push(status),
      outcome: (result) => outcomes.push(result),
    },
  );
  cleanups.push(() => session.close());
  await waitFor(() => snapshots.length >= 1);
  return { session, storage, snapshots, statuses, outcomes, get realmChanges() { return realmChanges; }, get socket() { return currentSocket!; } };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function reconcile(f: Awaited<ReturnType<typeof fixture>>, client: Awaited<ReturnType<typeof realClient>>): Promise<void> {
  const seenBefore = client.snapshots.length;
  f.clock.step(250);
  await waitFor(() => client.snapshots.length > seenBefore);
}

async function relaunch(f: Awaited<ReturnType<typeof fixture>>): Promise<Awaited<ReturnType<typeof fixture>>> {
  const runtime = startServer({ path: f.path, publicOrigin: f.origin, port: 0, clock: f.clock });
  cleanups.push(() => runtime.stop());
  return { ...f, runtime, base: `http://127.0.0.1:${runtime.server.port}` };
}

function rawLedger(path: string) {
  const authority = Authority.open(path);
  try {
    const db = rawDb(authority);
    return {
      ...readWorldRow(db),
      sequences: selectAll(db, 'SELECT * FROM sequences ORDER BY actor_id'),
      receipts: selectAll(db, 'SELECT * FROM receipts ORDER BY actor_id, seq'),
    };
  } finally {
    authority.close();
  }
}

function roadTileAt(authority: Authority, cityId: number, position: number): { x: number; z: number; index: number } {
  const world = authority.snapshot();
  const city = world.cities.find((c) => c.id === cityId)!;
  const index = city.roads[position];
  return { ...tileAtOn(islandFor(world.seed, city.home), index), index };
}

function requestIdOf(wire: string): string {
  return (JSON.parse(wire) as { requestId: string }).requestId;
}

function pendingEnvelope(realmId: string, binding: string, requestId: string, seq: number, operation: AuthorityRequest): string {
  const wire = JSON.stringify({ type: 'request', binding, requestId, seq, operation });
  return JSON.stringify({ realmId, binding, wire, requestId, seq });
}

test('a real client claims an island and issues a command through receipts only', async () => {
  const f = await fixture(cleanups);
  const cookie = await f.cookie();
  const client = await realClient(f, cookie);

  const claim = await client.session.send({ kind: 'claim', home: 0 });
  expect(claim.ok).toBe(true);
  const cityId = claim.cityId!;
  await reconcile(f, client);
  expect(client.snapshots.at(-1)!.world.cities.some((city) => city.id === cityId)).toBe(true);
  expect(client.snapshots.at(-1)!.session.ownedCityIds).toContain(cityId);

  const harbour = client.snapshots.at(-1)!.world.cities.find((city) => city.id === cityId)!.harbour;
  const found = await client.session.send({ kind: 'command', cityId, command: { type: 'foundHarbour', x: harbour.x, z: harbour.z } });
  expect(found.ok).toBe(true);
  await reconcile(f, client);
  expect(client.snapshots.at(-1)!.world.cities.find((city) => city.id === cityId)!.founded).toBe(true);
}, 10000);

test('an acknowledgement lost on a paused socket settles indeterminate, then the recovered receipt reports replayed exactly once', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  let tile!: ReturnType<typeof roadTileAt>;
  let f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    tile = roadTileAt(authority, actor.cityId, 0);
  });
  const cookie = `__Host-oikos=${actor.credential}`;
  const remove: AuthorityRequest = { kind: 'command', cityId: actor.cityId, command: { type: 'demolish', x: tile.x, z: tile.z } };
  const rebuild: AuthorityRequest = { kind: 'command', cityId: actor.cityId, command: { type: 'build', tool: 'road', x: tile.x, z: tile.z, rotation: 0 } };

  let paused: WirePeerSocket | undefined;
  let attempts = 0;
  const storage = new MemoryStorage();
  const reconnectSent: string[] = [];
  let reconnect: (() => void) | undefined;
  const client = await realClient(f, cookie, storage, () => {
    attempts += 1;
    if (attempts === 1) {
      paused = new WirePeerSocket(f.base, f.origin, cookie);
      return paused as unknown as WebSocket;
    }
    return recordingBunSocket(f, cookie, reconnectSent);
  }, (callback, milliseconds) => {
    if (milliseconds === 1000) {
      reconnect = callback;
      return () => { reconnect = undefined; };
    }
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  });
  expect(client.session.currentSession?.nextSeq).toBe(3);

  paused!.wire.socket.pause();
  const observer = await connect(cleanups, f, cookie);
  f.clock.time += 250;
  const before = client.session.send(remove);
  const persisted = storage.getItem(PENDING_KEY)!;
  const original = JSON.parse(persisted) as { requestId: string; seq: number; wire: string };
  expect(original.seq).toBe(3);

  expect((await observer.peer.next('snapshot')).session.nextSeq).toBe(4);
  const durable = await connect(cleanups, f, cookie);
  expect(durable.snapshot.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(tile.index);
  expect(durable.snapshot.session.nextSeq).toBe(4);
  expect(paused!.wire.packets.filter((packet) => packet.type === 'receipt')).toEqual([]);
  expect(client.snapshots.at(-1)!.world.cities.find((city) => city.id === actor.cityId)!.roads).toContain(tile.index);

  paused!.wire.socket.destroy();
  const outcome: SendOutcome = await before;
  expect(outcome.ok).toBe(false);
  expect(outcome.status).toBe('indeterminate');
  await f.runtime.stop();
  const committed = rawLedger(f.path);
  expect(committed.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(tile.index);
  expect(committed.sequences).toEqual([{ actor_id: 1, high_watermark: 3 }]);
  expect(committed.receipts).toHaveLength(3);
  expect(storage.getItem(PENDING_KEY)).toBe(persisted);
  expect(reconnectSent).toEqual([]);
  expect(client.outcomes.map((entry) => entry.outcome.status)).toEqual(['indeterminate']);
  f = await relaunch(f);
  expect(reconnect).toBeDefined();
  const resume = reconnect!;
  reconnect = undefined;
  resume();

  await waitFor(() => client.outcomes.some((entry) => entry.requestId === original.requestId && entry.outcome.status === 'replayed'), 8000);
  const recovered = client.outcomes.find((entry) => entry.requestId === original.requestId && entry.outcome.status === 'replayed')!;
  expect(recovered.seq).toBe(3);
  expect(recovered.outcome.ok).toBe(true);
  expect(storage.getItem(PENDING_KEY)).toBeNull();
  expect(reconnectSent).toEqual([original.wire]);

  await reconcile(f, client);
  const rebuilt = await client.session.send(rebuild);
  expect(rebuilt.ok).toBe(true);
  expect(rebuilt.status).toBe('processed');
  await reconcile(f, client);
  expect(client.snapshots.at(-1)!.world.cities.find((city) => city.id === actor.cityId)!.roads).toContain(tile.index);

  const replayAgain = await connect(cleanups, f, cookie);
  replayAgain.peer.ws.send(original.wire);
  const receipt = await replayAgain.peer.next('receipt');
  expect(receipt.result).toMatchObject({ ok: true, status: 'replayed' });
  const after = await connect(cleanups, f, cookie);
  expect(after.snapshot.world.cities.find((city) => city.id === actor.cityId)!.roads).toContain(tile.index);

  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot().cities.find((city) => city.id === actor.cityId)!.roads).toContain(tile.index);
    const actorId = reopened.authenticate(actor.credential)!.actorId;
    expect(selectAll(rawDb(reopened), 'SELECT seq FROM receipts WHERE actor_id = ? ORDER BY seq', actorId)).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
  } finally { reopened.close(); }
}, 20000);

test('an adapter recovering an already-consumed stale journal entry receives conflict via the outcome event; the ledger is identical before and after, and the retry carries a fresh nonce', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  let target!: ReturnType<typeof roadTileAt>;
  let rivalTarget!: ReturnType<typeof roadTileAt>;
  let f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    target = roadTileAt(authority, actor.cityId, 0);
    rivalTarget = roadTileAt(authority, actor.cityId, 1);
  });
  const cookie = `__Host-oikos=${actor.credential}`;
  const remove: AuthorityRequest = { kind: 'command', cityId: actor.cityId, command: { type: 'demolish', x: target.x, z: target.z } };

  const rival = await connect(cleanups, f, cookie);
  rival.peer.send(3, { kind: 'command', cityId: actor.cityId, command: { type: 'demolish', x: rivalTarget.x, z: rivalTarget.z } });
  expect((await rival.peer.next('receipt')).result).toMatchObject({ ok: true, status: 'processed' });
  await rival.peer.close();

  const before = await connect(cleanups, f, cookie);
  expect(before.snapshot.world.cities.find((city) => city.id === actor.cityId)!.roads).toContain(target.index);
  expect(before.snapshot.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(rivalTarget.index);
  expect(before.snapshot.session.nextSeq).toBe(4);
  await before.peer.close();
  await f.runtime.stop();
  const baseline = rawLedger(f.path);
  f = await relaunch(f);

  const staleRequestId = crypto.randomUUID();
  const storage = new MemoryStorage();
  storage.setItem(PENDING_KEY, pendingEnvelope(before.snapshot.realmId, before.snapshot.session.binding, staleRequestId, 3, remove));
  const sentStale: string[] = [];
  const client = await realClient(f, cookie, storage, () => recordingBunSocket(f, cookie, sentStale));
  await waitFor(() => client.outcomes.length >= 1);
  expect(sentStale).toHaveLength(1);
  expect(client.outcomes).toEqual([{ requestId: staleRequestId, seq: 3, outcome: { ok: false, reason: 'Request rejected: conflict.', status: 'conflict' } }]);
  expect(client.session.currentSession?.nextSeq).toBe(4);
  client.session.close();

  await f.runtime.stop();
  const after = rawLedger(f.path);
  expect(after).toEqual(baseline);
  expect(after.sequences).toEqual([{ actor_id: 1, high_watermark: 3 }]);
  expect(after.receipts).toHaveLength(3);
  f = await relaunch(f);

  const sentFresh: string[] = [];
  const fresh = await realClient(f, cookie, undefined, () => recordingBunSocket(f, cookie, sentFresh));
  expect(fresh.session.currentSession?.nextSeq).toBe(4);
  const retry = await fresh.session.send(remove);
  expect(retry.ok).toBe(true);
  expect(retry.status).toBe('processed');
  expect(requestIdOf(sentFresh.at(-1)!)).not.toBe(staleRequestId);

  await reconcile(f, fresh);
  expect(fresh.snapshots.at(-1)!.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(target.index);

  await f.runtime.stop();
  const final = rawLedger(f.path);
  expect(final.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(target.index);
  expect(final.receipts).toHaveLength(4);
}, 10000);

test('a future, unconsumed stored request is never autosent; a real gap from a rogue peer never mutates the ledger; discarding and a fresh nonce recover', async () => {
  let actor!: ReturnType<typeof foundedActor>;
  let target!: ReturnType<typeof roadTileAt>;
  let realmId!: string;
  let f = await fixture(cleanups, (authority) => {
    actor = foundedActor(authority, 0);
    target = roadTileAt(authority, actor.cityId, 0);
    realmId = authority.realmId;
  });
  const cookie = `__Host-oikos=${actor.credential}`;
  const remove: AuthorityRequest = { kind: 'command', cityId: actor.cityId, command: { type: 'demolish', x: target.x, z: target.z } };

  const probe = await connect(cleanups, f, cookie);
  const binding = probe.snapshot.session.binding;
  await probe.peer.close();

  const staleRequestId = crypto.randomUUID();
  const storage = new MemoryStorage();
  storage.setItem(PENDING_KEY, pendingEnvelope(realmId, binding, staleRequestId, 9, remove));
  const sent: string[] = [];
  const client = await realClient(f, cookie, storage, () => recordingBunSocket(f, cookie, sent));

  expect(client.session.currentStatus).toBe('indeterminate');
  expect(client.session.currentSession?.nextSeq).toBe(3);
  expect(sent).toEqual([]);

  const untouchedByStoredFuture = await connect(cleanups, f, cookie);
  expect(untouchedByStoredFuture.snapshot.world.cities.find((city) => city.id === actor.cityId)!.roads).toContain(target.index);
  expect(untouchedByStoredFuture.snapshot.session.nextSeq).toBe(3);
  await untouchedByStoredFuture.peer.close();
  client.session.close();

  await f.runtime.stop();
  const baseline = rawLedger(f.path);
  f = await relaunch(f);
  const rogue = await connect(cleanups, f, cookie);
  rogue.peer.send(9, remove);
  expect(await rogue.peer.next('reject')).toMatchObject({ type: 'reject', code: 'gap', session: { nextSeq: 3 } });
  await rogue.peer.close();

  await f.runtime.stop();
  const after = rawLedger(f.path);
  expect(after).toEqual(baseline);
  expect(after.sequences).toEqual([{ actor_id: 1, high_watermark: 2 }]);
  expect(after.receipts).toHaveLength(2);
  f = await relaunch(f);

  const sentFresh: string[] = [];
  const recovered = await realClient(f, cookie, storage, () => recordingBunSocket(f, cookie, sentFresh));
  expect(recovered.session.currentStatus).toBe('indeterminate');
  expect(recovered.session.discardPending()).toBe(true);
  await waitFor(() => recovered.session.canSend(), 8000);
  expect(recovered.session.currentSession?.nextSeq).toBe(3);

  const outcome = await recovered.session.send(remove);
  expect(outcome.ok).toBe(true);
  expect(outcome.status).toBe('processed');
  expect(requestIdOf(sentFresh.at(-1)!)).not.toBe(staleRequestId);

  await reconcile(f, recovered);
  expect(recovered.snapshots.at(-1)!.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(target.index);

  await f.runtime.stop();
  const final = rawLedger(f.path);
  expect(final.world.cities.find((city) => city.id === actor.cityId)!.roads).not.toContain(target.index);
  expect(final.receipts).toHaveLength(3);
}, 20000);
