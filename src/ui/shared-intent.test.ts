import { expect, test } from 'bun:test';
import { claimFor } from '../server/authority-fixtures.test';
import { SharedIntent } from './shared-intent';
import type { SendOutcome } from './shared-session';

const uncertain: SendOutcome = { ok: false, status: 'indeterminate', reason: 'Persistence uncertain.' };
const success: SendOutcome = { ok: true, status: 'processed', reason: 'Island claimed.', cityId: 1 };

function fixture(immediate?: SendOutcome) {
  let resolve!: (outcome: SendOutcome) => void;
  let realm = 'realm-a';
  let sends = 0;
  const shown: { outcome: SendOutcome; kind?: string }[] = [];
  const session = {
    currentSession: { binding: 'binding-a', nextSeq: 1, ownedCityIds: [], receiptWatermark: 0 },
    canSend: () => true,
    send: () => {
      sends++;
      if (immediate) return Promise.resolve(immediate);
      return new Promise<SendOutcome>((done) => { resolve = done; });
    },
  };
  const intent = new SharedIntent(session, () => realm, (outcome, kind) => shown.push({ outcome, kind }));
  return { intent, session, shown, get sends() { return sends; }, resolve: (outcome: SendOutcome) => resolve(outcome), realm: (value: string) => { realm = value; } };
}

async function flush(): Promise<void> { await Promise.resolve(); }

test('uncertain persistence without an event settles the claim once and releases UI busy state', async () => {
  const h = fixture(uncertain);
  h.intent.send(claimFor(0));
  expect(h.intent.busy).toBe(true);
  await flush();
  expect(h.intent.busy).toBe(false);
  expect(h.shown).toEqual([{ outcome: uncertain, kind: 'claim' }]);
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: uncertain });
  expect(h.shown).toHaveLength(1);
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: success });
  expect(h.shown).toEqual([{ outcome: uncertain, kind: 'claim' }, { outcome: success, kind: 'claim' }]);
});

test('event and promise share one decision path and requests are single-flight', async () => {
  const h = fixture();
  h.intent.send(claimFor(0));
  h.intent.send(claimFor(1));
  expect(h.sends).toBe(1);
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: success });
  h.resolve(success);
  await flush();
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: success });
  expect(h.shown).toEqual([{ outcome: success, kind: 'claim' }]);
  expect(h.intent.busy).toBe(false);
});

test('immediate unsent failure clears busy and is presented as a claim failure', async () => {
  const outcome: SendOutcome = { ok: false, status: 'unsent', reason: 'Storage blocked.' };
  const h = fixture(outcome);
  h.intent.send(claimFor(0));
  await flush();
  expect(h.intent.busy).toBe(false);
  expect(h.shown).toEqual([{ outcome, kind: 'claim' }]);
});

test('recovered outcomes cannot settle a different sequence or request identity', () => {
  const h = fixture();
  h.intent.send(claimFor(0));
  h.intent.outcome({ requestId: 'older', seq: 2, outcome: success });
  expect(h.intent.busy).toBe(true);
  expect(h.shown[0].kind).toBeUndefined();
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: uncertain });
  h.intent.outcome({ requestId: 'other', seq: 1, outcome: success });
  expect(h.shown.at(-1)?.kind).toBeUndefined();
});

for (const replacement of ['realm', 'binding'] as const) {
  test(`${replacement} replacement cannot attach an old outcome to current claim presentation`, async () => {
    const h = fixture();
    h.intent.send(claimFor(0));
    if (replacement === 'realm') h.realm('realm-b');
    else h.session.currentSession.binding = 'binding-b';
    h.intent.outcome({ requestId: 'one', seq: 1, outcome: uncertain });
    h.resolve(uncertain);
    await flush();
    expect(h.shown).toEqual([{ outcome: uncertain, kind: undefined }]);
    h.intent.reset();
    expect(h.intent.busy).toBe(false);
  });
}

test('explicit discard fences a late promise and preserves generic recovered notifications', async () => {
  const h = fixture();
  h.intent.send(claimFor(0));
  h.intent.reset();
  h.resolve(uncertain);
  await flush();
  expect(h.shown).toEqual([]);
  h.intent.outcome({ requestId: 'one', seq: 1, outcome: success });
  expect(h.shown).toEqual([{ outcome: success, kind: undefined }]);
});
