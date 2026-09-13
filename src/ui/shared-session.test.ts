import { expect, test } from 'bun:test';
import { BINDING, COMMAND, cursor, FakeStorage, harness, KEY, OTHER, REALM, receipt, snapshotPacket } from './shared-session-fixtures.test';

test('valid baseline installs a canonical snapshot and an independently readable cursor', () => {
  const h = harness();
  expect(h.session.canSend()).toBe(false);
  h.connect();
  expect(h.snapshots).toHaveLength(1);
  expect(h.snapshots[0].realmId).toBe(REALM);
  expect(h.session.currentSession).toEqual(cursor(2));
  expect(h.session.currentStatus).toBe('ready');
  h.session.close();
});

test('exact validated wire is durable before send and contains no realm', async () => {
  const h = harness();
  const socket = h.connect();
  socket.beforeSend = (wire) => expect(JSON.parse(h.storage.raw.get(KEY)!).wire).toBe(wire);
  const pending = h.session.send(COMMAND);
  const stored = JSON.parse(h.storage.raw.get(KEY)!);
  expect(stored.realmId).toBe(REALM);
  expect(JSON.parse(stored.wire)).toEqual({ type: 'request', binding: BINDING, requestId: stored.requestId, seq: 2, operation: COMMAND });
  expect(socket.sent).toEqual([stored.wire]);
  expect(h.session.currentStatus).toBe('pending');
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  socket.message(receipt(socket));
  expect(await pending).toEqual({ ok: true, reason: 'Done.', status: 'processed', cityId: 1 });
  expect(h.storage.raw.has(KEY)).toBe(false);
  expect(h.session.currentStatus).toBe('reconciling');
  socket.message(snapshotPacket({ serial: 2, session: cursor(3) }));
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test('wrong receipt id OR sequence does not settle another request', async () => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  let decided = false;
  void pending.then(() => { decided = true; });
  socket.message(receipt(socket, { requestId: OTHER }));
  socket.message(receipt(socket, { seq: 3 }));
  await Promise.resolve();
  expect(decided).toBe(false);
  expect(h.storage.raw.has(KEY)).toBe(true);
  socket.message(receipt(socket));
  expect((await pending).status).toBe('processed');
  h.session.close();
});

test('receipt reconciliation requires a snapshot beyond the confirmed sequence, never just a reject', async () => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  socket.message(receipt(socket));
  await pending;
  socket.message(snapshotPacket({ serial: 2 }));
  expect(h.session.canSend()).toBe(false);
  socket.message({ type: 'reject', code: 'gap', session: cursor(3) });
  expect(h.session.canSend()).toBe(false);
  socket.message(snapshotPacket({ serial: 3, session: cursor(3) }));
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test.each(['invalid-request', 'unauthenticated', 'gap', 'conflict', 'pruned', 'exhausted', 'rate-limited', 'session-mismatch'])('%s decides without automatic reissue', async (code) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  socket.message({ type: 'reject', code, session: cursor(5) });
  expect((await pending).status).toBe(code);
  expect(h.session.canSend()).toBe(false);
  expect(h.storage.raw.has(KEY)).toBe(false);
  socket.drop();
  h.fire(1000);
  h.connect({ serial: 2, session: cursor(5) });
  expect(h.sockets[1].sent).toEqual([]);
  expect(h.session.canSend()).toBe(true);
  h.session.close();
});

test('disconnect settles uncertainty, reconnect waits for its own handshake and replays exact bytes once', async () => {
  const h = harness();
  const first = h.connect();
  const pending = h.session.send(COMMAND);
  const wire = first.sent[0];
  first.drop();
  expect((await pending).status).toBe('indeterminate');
  h.fire(1000);
  const second = h.sockets[1];
  second.open();
  expect(h.session.canSend()).toBe(false);
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  expect(second.sent).toEqual([]);
  second.message(snapshotPacket({ serial: 2, session: cursor(3) }));
  second.message(snapshotPacket({ serial: 3, session: cursor(3) }));
  expect(second.sent).toEqual([wire]);
  first.message(snapshotPacket({ realmId: OTHER, serial: 90 }));
  expect(h.realmChanges).toBe(0);
  h.session.close();
});

test('reload recovers exact durable pending and realm mismatch never transmits it', async () => {
  const first = harness();
  first.connect();
  const pending = first.session.send(COMMAND);
  first.session.close();
  expect((await pending).status).toBe('indeterminate');
  const original = first.storage.raw.get(KEY)!;
  const matching = harness({ storage: first.storage });
  expect(matching.connect({ session: cursor(3) }).sent).toEqual([JSON.parse(original).wire]);
  matching.session.close();
  const other = harness({ storage: first.storage });
  expect(other.connect({ realmId: OTHER }).sent).toEqual([]);
  expect(other.storage.raw.has(KEY)).toBe(false);
  other.session.close();
});

test('definitely failed persistence is unsent and blocks further writes', async () => {
  const storage = new FakeStorage();
  storage.set = () => { throw new Error('quota'); };
  const h = harness({ storage });
  const socket = h.connect();
  expect((await h.session.send(COMMAND)).status).toBe('unsent');
  expect(socket.sent).toEqual([]);
  expect(h.session.currentStatus).toBe('storage-error');
  expect(h.session.statusReason).not.toBe('');
  h.session.close();
});
