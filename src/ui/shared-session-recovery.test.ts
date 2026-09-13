import { expect, test } from 'bun:test';
import { COMMAND, cursor, harness, KEY, OTHER, receipt, snapshotPacket } from './shared-session-fixtures.test';

function recoverable() {
  const h = harness();
  h.connect();
  void h.session.send(COMMAND);
  h.session.close();
  return h.storage;
}

test.each([1, 2])('unconsumed/future pending at cursor %s never auto-applies across reload', (nextSeq) => {
  const storage = recoverable();
  const raw = storage.raw.get(KEY);
  const h = harness({ storage });
  const socket = h.connect({ session: cursor(nextSeq) });
  expect(socket.sent).toEqual([]);
  expect(h.session.currentStatus).toBe('indeterminate');
  expect(h.outcomes).toHaveLength(1);
  expect(h.outcomes[0].outcome.status).toBe('indeterminate');
  expect(h.session.canSend()).toBe(false);
  expect(storage.raw.get(KEY)).toBe(raw);
  socket.message(snapshotPacket({ serial: 2, session: cursor(3) }));
  expect(socket.sent).toEqual([]);
  expect(h.session.currentStatus).toBe('indeterminate');
  h.session.close();
});

test.each(['realm', 'login'])('constructor journal announces %s mismatch without sending old intent', (scope) => {
  const storage = recoverable();
  const h = harness({ storage });
  const change = scope === 'realm' ? { realmId: OTHER } : { session: { ...cursor(3, []), binding: 'b'.repeat(64) } };
  expect(h.connect(change).sent).toEqual([]);
  expect(h.outcomes).toHaveLength(1);
  expect(h.outcomes[0].outcome.status).toBe('indeterminate');
  expect(storage.raw.has(KEY)).toBe(false);
  h.session.close();
});

test.each(['rate-limited', 'gap'])('failed clear after %s cannot turn decided rejection into reload application', async (code) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  const raw = h.storage.raw.get(KEY);
  h.storage.remove = () => { throw new Error('denied'); };
  socket.message({ type: 'reject', code, session: cursor(2) });
  expect((await pending).status).toBe(code);
  expect(h.session.currentStatus).toBe('storage-error');
  h.session.close();
  const recovered = harness({ storage: h.storage });
  expect(recovered.connect().sent).toEqual([]);
  expect(recovered.session.currentStatus).toBe('indeterminate');
  expect(h.storage.raw.get(KEY)).toBe(raw);
  recovered.session.close();
});

test('explicit discard confirms removal, fences stale transport, and requires fresh user intent', async () => {
  const storage = recoverable();
  const h = harness({ storage });
  const first = h.connect();
  expect(h.session.currentStatus).toBe('indeterminate');
  expect(h.session.discardPending()).toBe(true);
  expect(storage.raw.has(KEY)).toBe(false);
  expect(h.session.canSend()).toBe(false);
  first.message({ type: 'reject', code: 'gap', session: cursor(3) });
  h.fire(1000);
  const second = h.connect({ serial: 2 });
  expect(second.sent).toEqual([]);
  expect(h.session.canSend()).toBe(true);
  const fresh = h.session.send(COMMAND);
  expect(second.sent).toHaveLength(1);
  second.message(receipt(second));
  expect((await fresh).status).toBe('processed');
  h.session.close();
});

test('explicit discard cannot unlock on nonthrowing removal failure', () => {
  const storage = recoverable();
  const h = harness({ storage });
  h.connect();
  storage.remove = () => {};
  expect(h.session.discardPending()).toBe(false);
  expect(h.session.currentStatus).toBe('storage-error');
  expect(storage.raw.has(KEY)).toBe(true);
  expect(h.session.canSend()).toBe(false);
  h.session.close();
});

test.each(['receipt', 'reject'])('%s starts a reconciliation deadline; nonadvancing World cannot extend it', async (kind) => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  if (kind === 'receipt') socket.message(receipt(socket));
  else socket.message({ type: 'reject', code: 'conflict', session: cursor(3) });
  await pending;
  expect(h.delays).toEqual([15000]);
  if (kind === 'receipt') socket.message(snapshotPacket({ serial: 2 }));
  expect(h.delays).toEqual([15000]);
  h.fire(15000);
  expect(h.session.currentStatus).toBe('offline');
  h.fire(1000);
  h.connect({ serial: 3, session: cursor(3) });
  expect(h.session.currentStatus).toBe('ready');
  expect(h.delays).toEqual([]);
  h.session.close();
});

test('event reports eventual definitive replay after original caller has settled indeterminate', async () => {
  const h = harness();
  const socket = h.connect();
  const pending = h.session.send(COMMAND);
  socket.drop();
  expect((await pending).status).toBe('indeterminate');
  h.fire(1000);
  const recovered = h.connect({ serial: 2, session: cursor(3) });
  recovered.message(receipt(recovered, { result: { ok: false, status: 'replayed', reason: 'Rejected placement.' } }));
  expect(h.outcomes.map((event) => event.outcome.status)).toEqual(['indeterminate', 'replayed']);
  expect(h.outcomes[1]).toMatchObject({ seq: 2, outcome: { ok: false, reason: 'Rejected placement.' } });
  expect(h.outcomes[0].requestId).toBe(h.outcomes[1].requestId);
  h.session.close();
});

test.each(['replayed', 'conflict', 'pruned', 'exhausted'])('constructor journal exposes recovered %s outcome without an original caller', (status) => {
  const storage = recoverable();
  const h = harness({ storage });
  const socket = h.connect({ session: cursor(3) });
  if (status === 'replayed') socket.message(receipt(socket, { result: { ok: true, reason: 'Already done.', status } }));
  else socket.message({ type: 'reject', code: status, session: cursor(3) });
  expect(h.outcomes).toHaveLength(1);
  expect(h.outcomes[0].outcome.status).toBe(status);
  expect(h.outcomes[0].seq).toBe(2);
  expect(storage.raw.has(KEY)).toBe(false);
  h.session.close();
});
