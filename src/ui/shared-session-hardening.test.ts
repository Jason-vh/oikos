import { expect, test } from 'bun:test';
import type { AuthorityRequest } from '../server/authority';
import type { PendingEnvelope } from './shared-session-protocol';
import { COMMAND, cursor, FakeSocket, FakeStorage, harness, KEY, OTHER, receipt, snapshotPacket } from './shared-session-fixtures.test';

function savedPending(): string {
  const h = harness();
  h.connect();
  void h.session.send(COMMAND);
  const raw = h.storage.raw.get(KEY)!;
  h.session.close();
  return raw;
}

test('an OPEN replacement socket with no pending is fenced until its own snapshot', async () => {
  const h = harness();
  h.connect().drop();
  h.fire(1000);
  const socket = h.sockets[1];
  socket.open();
  expect(h.session.canSend()).toBe(false);
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  expect(socket.sent).toEqual([]);
  socket.message(snapshotPacket({ serial: 2 }));
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test.each(['realmId', 'streamId'])('same-socket %s change fails closed and retains pending', async (field) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  const raw = h.storage.raw.get(KEY);
  socket.message(snapshotPacket({ [field]: OTHER, serial: 2 }));
  expect((await pending).status).toBe('indeterminate');
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(h.storage.raw.get(KEY)).toBe(raw);
  expect(h.snapshots).toHaveLength(1);
  expect(h.realmChanges).toBe(0);
  expect(h.delays).toEqual([]);
  h.session.close();
});

test('new connection resets stream serial; realm callback observes coherent new cursor and ownership', () => {
  let checked = false;
  const h = harness({ events: { realmChanged() {
    checked = true;
    expect(h.session.currentSession).toEqual(cursor(1, []));
    expect(h.session.canSend()).toBe(true);
  } } });
  h.connect({ serial: 99 }).drop();
  h.fire(1000);
  h.connect({ streamId: OTHER });
  expect(h.snapshots).toHaveLength(2);
  h.sockets[1].drop();
  h.fire(1000);
  h.connect({ realmId: OTHER, streamId: OTHER, session: cursor(1, []) });
  expect(checked).toBe(true);
  h.session.close();
});

test('replacement login never receives old intent or triggers realm presentation reset', async () => {
  const h = harness();
  const first = h.connect();
  const pending = h.session.send(COMMAND);
  first.drop();
  expect((await pending).status).toBe('indeterminate');
  h.fire(1000);
  const second = h.connect({ serial: 2, session: { ...cursor(1, []), binding: 'b'.repeat(64) } });
  expect(second.sent).toEqual([]);
  expect(h.storage.raw.has(KEY)).toBe(false);
  expect(h.session.currentSession?.binding).toBe('b'.repeat(64));
  expect(h.realmChanges).toBe(0);
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test.each(['snapshot', 'reject'])('same-socket binding change in %s fails closed', (kind) => {
  const h = harness();
  const socket = h.connect();
  const session = { ...cursor(3), binding: 'b'.repeat(64) };
  if (kind === 'snapshot') socket.message(snapshotPacket({ serial: 2, session }));
  else socket.message({ type: 'reject', code: 'session-mismatch', session });
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(h.realmChanges).toBe(0);
  h.session.close();
});

test('same-stream serials must increase even across reconnect', () => {
  const h = harness();
  const socket = h.connect({ serial: 5 });
  socket.message(snapshotPacket({ serial: 5 }));
  socket.message(snapshotPacket({ serial: 4 }));
  expect(h.snapshots).toHaveLength(1);
  socket.drop();
  h.fire(1000);
  h.connect({ serial: 5 });
  expect(h.session.canSend()).toBe(false);
  h.sockets[1].message(snapshotPacket({ serial: 6 }));
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test.each([
  { protocol: 1 },
  { session: { ...cursor(2), binding: 'bad' } },
  { session: { ...cursor(2), binding: 'A'.repeat(64) } }, { realmId: 'realm-1' }, { streamId: 'stream-1' },
  { realmId: '00000000-0000-0000-0000-000000000000' },
  { serial: 0 }, { serial: Number.MAX_SAFE_INTEGER + 1 },
  { extra: true }, { world: {} },
  { session: { ...cursor(2), actorId: 1 } },
  { session: cursor(2, [0]) }, { session: cursor(2, [-1]) },
  { session: cursor(2, [1, 1]) }, { session: cursor(2, [999]) },
  { session: cursor(0) }, { session: cursor(1.1) },
  { session: { ...cursor(258), receiptWatermark: 0 } },
  { session: { ...cursor(null), receiptWatermark: 0 } },
])('invalid snapshot blocks instead of silently unlocking: %j', (override) => {
  const h = harness();
  h.connect(override);
  expect(h.snapshots).toEqual([]);
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(h.session.canSend()).toBe(false);
  h.session.close();
});

test.each([258, null])('watermark boundary baseline %s is accepted', (nextSeq) => {
  const h = harness();
  h.connect({ session: cursor(nextSeq) });
  expect(h.snapshots).toHaveLength(1);
  expect(h.session.currentStatus).toBe(nextSeq === null ? 'exhausted' : 'ready');
  h.session.close();
});

test.each(['snapshot', 'reject', 'reconnect'])('same-realm cursor regression through %s fails closed', (kind) => {
  const h = harness();
  const socket = h.connect({ session: cursor(258) });
  if (kind === 'reject') socket.message({ type: 'reject', code: 'gap', session: cursor(257) });
  else if (kind === 'snapshot') socket.message(snapshotPacket({ serial: 2, session: cursor(257) }));
  else {
    socket.drop();
    h.fire(1000);
    h.connect({ streamId: OTHER, session: cursor(257) });
  }
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(h.session.currentSession?.nextSeq).toBe(258);
  h.session.close();
});

test('reject may announce newly claimed ownership absent from old World without granting writes', async () => {
  const h = harness();
  const socket = h.connect({ session: cursor(1, []), world: { ...snapshotPacket().world, cities: [], nextCityId: 1 } });
  expect(h.session.canSend()).toBe(true);
  const pending = h.session.send({ kind: 'claim', home: 0 });
  socket.message({ type: 'reject', code: 'conflict', session: cursor(2) });
  expect((await pending).status).toBe('conflict');
  expect(h.session.currentSession).toEqual(cursor(2));
  expect(h.session.currentStatus).toBe('reconciling');
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  socket.message(snapshotPacket({ serial: 2 }));
  expect(h.session.canSend()).toBe(true);
  const fresh = h.session.send(COMMAND);
  expect(socket.sent).toHaveLength(2);
  h.session.close();
  expect((await fresh).status).toBe('indeterminate');
});

test('public session and snapshot mutations cannot alter internal cursor or ownership', async () => {
  const h = harness();
  const socket = h.connect();
  const session = h.session.currentSession!;
  session.nextSeq = 900;
  session.ownedCityIds.push(99);
  h.snapshots[0].session.nextSeq = 901;
  h.snapshots[0].session.ownedCityIds.push(99);
  h.snapshots[0].world.cities[0].id = 99;
  expect(h.session.currentSession).toEqual(cursor(2));
  expect((await h.session.send({ ...COMMAND, cityId: 99 })).status).toBe('unsent');
  void h.session.send(COMMAND);
  expect(JSON.parse(socket.sent[0]).seq).toBe(2);
  h.session.close();
});

test.each([
  { type: 'unknown' }, { type: 'reject', code: 'invented', session: cursor(3) },
  { type: 'reject', code: 'gap', session: { ...cursor(3), extra: true } },
  { type: 'reject', code: 'gap', session: cursor(3), requestId: OTHER },
  { result: { ok: true, reason: '', status: 'conflict' } },
  { result: { ok: true, reason: '', status: 'processed', extra: 1 } },
  { result: { ok: true, reason: '', status: 'processed', cityId: 0 } },
  { result: { ok: true, reason: '', status: 'processed', cityId: Number.MAX_SAFE_INTEGER + 1 } },
  { result: { ok: 1, reason: '', status: 'processed' } },
  { result: { ok: true, reason: 2, status: 'processed' } },
  { session: cursor(3) },
])('malformed control retains exact intent and blocks: %j', async (override) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  const raw = h.storage.raw.get(KEY);
  let packet: unknown = { ...receipt(socket), ...override };
  if ('type' in override) packet = override;
  socket.message(packet);
  expect((await pending).status).toBe('indeterminate');
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(h.storage.raw.get(KEY)).toBe(raw);
  expect(h.session.canSend()).toBe(false);
  h.session.close();
});

test.each(['not-json', '[]', null, new Uint8Array([1])])('invalid raw frames fail closed: %j', (raw) => {
  const h = harness();
  const socket = h.connect();
  socket.raw(raw);
  expect(h.session.currentStatus).toBe('protocol-error');
  h.session.close();
});

test.each(['receipt', 'reject'])('control packets before the current handshake fail closed: %s', (type) => {
  const storage = new FakeStorage();
  const raw = savedPending();
  storage.raw.set(KEY, raw);
  const envelope = JSON.parse(raw);
  const h = harness({ storage });
  h.sockets[0].open();
  if (type === 'receipt') h.sockets[0].message({ type, requestId: envelope.requestId, seq: envelope.seq, result: { ok: true, reason: 'Done.', status: 'processed' } });
  else h.sockets[0].message({ type, code: 'gap', session: cursor(3) });
  expect(h.session.currentSession).toBeNull();
  expect(h.session.currentStatus).toBe('protocol-error');
  expect(storage.raw.get(KEY)).toBe(raw);
  h.session.close();
});

test.each([
  (value: PendingEnvelope) => { value.realmId = 'bad'; },
  (value: PendingEnvelope) => { value.binding = 'b'.repeat(64); },
  (value: PendingEnvelope & { extra?: boolean }) => { value.extra = true; },
  (value: PendingEnvelope) => { value.seq++; },
  (value: PendingEnvelope) => { value.requestId = OTHER; },
  (value: PendingEnvelope) => { value.wire = JSON.stringify({ ...JSON.parse(value.wire), realmId: value.realmId }); },
  (value: PendingEnvelope) => { value.wire = JSON.stringify({ ...JSON.parse(value.wire), operation: { kind: 'unknown' } }); },
  (value: PendingEnvelope) => { value.wire = JSON.stringify({ ...JSON.parse(value.wire), requestId: 'bad' }); },
  (value: PendingEnvelope) => { value.wire += ' '.repeat(65536); },
])('corrupt durable envelopes cannot be replayed or overwritten', (corrupt) => {
  const storage = new FakeStorage();
  const value = JSON.parse(savedPending());
  corrupt(value);
  const raw = JSON.stringify(value);
  storage.raw.set(KEY, raw);
  const h = harness({ storage });
  const socket = h.connect();
  expect(h.session.currentStatus).toBe('storage-error');
  expect(socket.sent).toEqual([]);
  expect(storage.raw.get(KEY)).toBe(raw);
  h.session.close();
});

test.each(['', '{', 'null'])('present corrupt storage differs from missing: %j', (raw) => {
  const storage = new FakeStorage();
  storage.raw.set(KEY, raw);
  const h = harness({ storage });
  h.connect();
  expect(h.session.currentStatus).toBe('storage-error');
  expect(h.session.canSend()).toBe(false);
  expect(storage.raw.get(KEY)).toBe(raw);
  h.session.close();
});

test('unreadable initial storage and a later foreign pending record cannot be overwritten', async () => {
  const storage = new FakeStorage();
  storage.read = () => { throw new Error('denied'); };
  const h = harness({ storage });
  h.connect();
  expect(h.session.currentStatus).toBe('storage-error');
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  h.session.close();
  const other = harness();
  other.connect();
  other.storage.raw.set(KEY, savedPending());
  expect((await other.session.send(COMMAND)).status).toBe('unsent');
  expect(other.session.currentStatus).toBe('storage-error');
  expect(other.sockets[0].sent).toEqual([]);
  other.session.close();
});

test('nonthrowing no-op storage never pretends a request is durable', async () => {
  const h = harness();
  const socket = h.connect();
  h.storage.set = () => {};
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  expect(h.session.currentStatus).toBe('storage-error');
  expect(socket.sent).toEqual([]);
  h.session.close();
});

test.each(['write-then-throw', 'readback-throw'])('uncertain persistence %s remains indeterminate on reload without automatic application', async (mode) => {
  const h = harness();
  const socket = h.connect();
  h.storage.set = (key, value) => {
    h.storage.raw.set(key, value);
    if (mode === 'write-then-throw') throw new Error('after write');
    h.storage.read = () => { throw new Error('readback'); };
  };
  expect((await h.session.send(COMMAND)).status).toBe('indeterminate');
  expect(socket.sent).toEqual([]);
  expect(h.session.currentStatus).toBe('storage-error');
  h.session.close();
  h.storage.read = (key) => h.storage.raw.get(key) ?? null;
  const recovered = harness({ storage: h.storage });
  const original = h.storage.raw.get(KEY);
  const replay = recovered.connect();
  expect(replay.sent).toEqual([]);
  expect(recovered.session.currentStatus).toBe('indeterminate');
  expect(h.storage.raw.get(KEY)).toBe(original);
  recovered.session.close();
});

test.each(['throw', 'noop', 'readback'])('decided receipt survives %s clear failure without permitting overwrite', async (mode) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  h.storage.remove = () => {
    if (mode === 'throw') throw new Error('remove');
    if (mode === 'readback') h.storage.read = () => { throw new Error('readback'); };
  };
  socket.message(receipt(socket));
  expect((await pending).status).toBe('processed');
  expect(h.session.currentStatus).toBe('storage-error');
  socket.message(snapshotPacket({ serial: 2, session: cursor(3) }));
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  expect(socket.sent).toHaveLength(1);
  expect(h.storage.raw.has(KEY)).toBe(true);
  h.session.close();
});

test('replay rechecks durable bytes instead of sending changed storage', () => {
  const h = harness();
  h.connect();
  void h.session.send(COMMAND);
  h.sockets[0].drop();
  h.storage.raw.set(KEY, savedPending());
  h.fire(1000);
  expect(h.connect({ serial: 2, session: cursor(3) }).sent).toEqual([]);
  expect(h.session.currentStatus).toBe('storage-error');
  h.session.close();
});

test('serialization, invalid shape and UTF-8 oversize requests fail before persistence or send', async () => {
  const h = harness();
  const socket = h.connect();
  const cycle: Record<string, unknown> = { kind: 'claim', home: 0 };
  cycle.cycle = cycle;
  const bad = [cycle, { kind: 'claim', home: 0n }, { kind: 'unknown' }, { ...COMMAND, command: { ...COMMAND.command, padding: '🌍'.repeat(17000) } }];
  for (const operation of bad) {
    expect((await h.session.send(operation as AuthorityRequest)).status).toBe('unsent');
    expect(h.storage.raw.has(KEY)).toBe(false);
    expect(socket.sent).toEqual([]);
    expect(h.session.canSend()).toBe(true);
  }
  h.session.close();
});

test('serialization-triggered disposal cannot persist intent or leave a hung caller', async () => {
  const h = harness();
  const socket = h.connect();
  const operation = { toJSON() { h.session.close(); return COMMAND; } } as unknown as AuthorityRequest;
  expect((await h.session.send(operation)).status).toBe('unsent');
  expect(h.storage.raw.has(KEY)).toBe(false);
  expect(socket.sent).toEqual([]);
});

test('a socket closing between persistence and transmission settles uncertainty', async () => {
  const h = harness();
  const socket = h.connect();
  h.storage.set = (key, raw) => { h.storage.raw.set(key, raw); socket.readyState = WebSocket.CLOSED; };
  expect((await h.session.send(COMMAND)).status).toBe('indeterminate');
  expect(h.storage.raw.has(KEY)).toBe(true);
  expect(socket.sent).toEqual([]);
  expect(h.session.currentStatus).toBe('offline');
  h.session.close();
});

test('send and close throws settle indeterminate and preserve exact durable intent', async () => {
  const h = harness();
  const socket = h.connect();
  socket.throwSend = true;
  socket.throwClose = true;
  expect((await h.session.send(COMMAND)).status).toBe('indeterminate');
  expect(h.storage.raw.has(KEY)).toBe(true);
  expect(h.session.currentStatus).toBe('offline');
  expect(h.delays).toEqual([1000]);
  h.session.close();
  expect(h.delays).toEqual([]);
});

test('constructor failures back off to a bound and disposal cancels retry', () => {
  const h = harness({ connect: () => { throw new Error('constructor'); } });
  for (const delay of [1000, 2000, 4000, 8000, 8000]) {
    expect(h.delays).toEqual([delay]);
    h.fire(delay);
  }
  h.session.close();
  expect(h.delays).toEqual([]);
  h.fire();
  expect(h.sockets).toEqual([]);
});

test('socket errors and handshake timeouts reconnect; late detached events are inert', () => {
  const h = harness();
  const first = h.sockets[0];
  first.dispatchEvent(new Event('error'));
  expect(h.session.currentStatus).toBe('offline');
  first.open();
  first.message(snapshotPacket());
  expect(h.snapshots).toEqual([]);
  h.fire(1000);
  h.fire(15000);
  expect(h.delays).toEqual([2000]);
  h.session.close();
  expect(h.delays).toEqual([]);
});

test('ongoing snapshots do not cancel pending receipt timeout', async () => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  socket.message(snapshotPacket({ serial: 2 }));
  expect(h.delays).toEqual([15000]);
  h.fire(15000);
  expect((await pending).status).toBe('indeterminate');
  expect(h.storage.raw.has(KEY)).toBe(true);
  expect(h.session.currentStatus).toBe('offline');
  h.session.close();
});

test('closing with pending settles caller once, preserves journal, and removes timers and socket callbacks', async () => {
  const h = harness({ connect: () => new FakeSocket() });
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  const raw = h.storage.raw.get(KEY);
  h.session.close();
  h.session.close();
  expect((await pending).status).toBe('indeterminate');
  socket.message(receipt(socket));
  socket.message(snapshotPacket({ serial: 2 }));
  expect(h.storage.raw.get(KEY)).toBe(raw);
  expect(h.snapshots).toHaveLength(1);
  expect(h.delays).toEqual([]);
  expect(h.session.currentStatus).toBe('closed');
});
