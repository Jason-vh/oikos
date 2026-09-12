import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Authority } from './authority';
import { admit, rid } from './authority-fixtures.test';
import { connect, fixture } from './transport-fixtures.test';
import { startServer } from './runtime';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('same-realm replacement login cannot replay another account request; binding survives restart without granting authentication', async () => {
  let firstCredential = '';
  let secondCredential = '';
  const f = await fixture(cleanups, (authority) => {
    firstCredential = admit(authority);
    secondCredential = admit(authority);
  });
  const first = await connect(cleanups, f, `__Host-oikos=${firstCredential}`);
  const same = await connect(cleanups, f, `__Host-oikos=${firstCredential}`);
  const second = await connect(cleanups, f, `__Host-oikos=${secondCredential}`);
  const firstBinding = first.snapshot.session.binding;
  const secondBinding = second.snapshot.session.binding;
  expect(same.snapshot.session.binding).toBe(firstBinding);
  expect(firstBinding === secondBinding).toBe(false);
  expect(firstBinding === firstCredential).toBe(false);
  expect(firstBinding === createHash('sha256').update(firstCredential).digest('hex')).toBe(false);
  expect(first.snapshot.realmId).toBe(second.snapshot.realmId);
  expect(first.snapshot.session.nextSeq).toBe(1);
  expect(second.snapshot.session.nextSeq).toBe(1);
  expect(first.snapshot.session.ownedCityIds).toEqual([]);
  expect(second.snapshot.session.ownedCityIds).toEqual([]);
  expect(first.snapshot.world.cities).toEqual([]);

  const unauthorized = await fetch(`${f.base}/api/world`, { headers: { Origin: f.origin, Cookie: `__Host-oikos=${firstBinding}` } });
  expect(unauthorized.status).toBe(401);
  const operation = { kind: 'claim' as const, home: 0 };
  const previousLoginWire = JSON.stringify({ type: 'request', binding: firstBinding, requestId: rid(1), seq: 1, operation });
  second.peer.ws.send(previousLoginWire);
  expect(await second.peer.next('reject')).toEqual({ type: 'reject', code: 'session-mismatch', session: second.snapshot.session });
  await f.runtime.stop();
  const reopened = Authority.open(f.path);
  try {
    expect(reopened.snapshot()).toEqual(first.snapshot.world);
    expect(reopened.authenticate(firstCredential)?.nextSeq).toBe(1);
    expect(reopened.authenticate(secondCredential)?.nextSeq).toBe(1);
  } finally { reopened.close(); }

  const runtime = startServer({ path: f.path, publicOrigin: f.origin, port: 0, clock: f.clock });
  cleanups.push(() => runtime.stop());
  const restarted = { ...f, runtime, base: `http://127.0.0.1:${runtime.server.port}` };
  const resumed = await connect(cleanups, restarted, `__Host-oikos=${secondCredential}`);
  expect(resumed.snapshot.realmId).toBe(second.snapshot.realmId);
  expect(resumed.snapshot.streamId).not.toBe(second.snapshot.streamId);
  expect(resumed.snapshot.session.binding).toBe(secondBinding);
  resumed.peer.send(1, operation);
  expect((await resumed.peer.next('receipt')).result).toMatchObject({ ok: true, status: 'processed' });
  await runtime.stop();
  const persisted = Authority.open(f.path);
  try {
    expect(persisted.snapshot().cities.map((city) => city.home)).toEqual([0]);
    expect(persisted.authenticate(secondCredential)?.nextSeq).toBe(2);
    expect(persisted.authenticate(firstCredential)?.ownedCityIds).toEqual([]);
  } finally { persisted.close(); }
});
