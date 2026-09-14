import { expect, test } from 'bun:test';
import { ProtocolLog, SnapshotLog, cadence, debugEnabled, delaySends, latencyMillis, observe } from './debug';

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  send(wire: string): void { this.sent.push(wire); }
}

function socket(): FakeSocket & WebSocket {
  return new FakeSocket() as unknown as FakeSocket & WebSocket;
}

test('the seam stays off unless the page asks for it', () => {
  expect(debugEnabled('')).toBe(false);
  expect(debugEnabled('?seed=3')).toBe(false);
  expect(debugEnabled('?debug')).toBe(true);
  expect(debugEnabled('?latency=250&debug')).toBe(true);
});

test('latency is a positive number of milliseconds or nothing at all', () => {
  expect(latencyMillis('?debug')).toBe(0);
  expect(latencyMillis('?latency=nonsense')).toBe(0);
  expect(latencyMillis('?latency=-5')).toBe(0);
  expect(latencyMillis('?latency=250')).toBe(250);
  expect(latencyMillis('?latency=999999')).toBe(10_000);
});

test('the log names each frame by its packet type and both directions', () => {
  const log = new ProtocolLog();
  const ws = socket();
  observe(ws, log);
  ws.send(JSON.stringify({ type: 'request', seq: 1 }));
  ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'receipt' }) }));
  ws.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(64) }));
  expect(log.all.map((entry) => [entry.direction, entry.kind])).toEqual([
    ['sent', 'request'],
    ['received', 'receipt'],
    ['received', 'snapshot'],
  ]);
  expect(log.all[2].bytes).toBe(64);
  expect(ws.sent.length).toBe(1);
});

test('observing a socket does not swallow what it sends', () => {
  const log = new ProtocolLog();
  const ws = socket();
  observe(ws, log);
  ws.send('{"type":"request"}');
  expect(ws.sent).toEqual(['{"type":"request"}']);
});

test('the log keeps the most recent frames and can be emptied', () => {
  const log = new ProtocolLog();
  for (let index = 0; index < 600; index++) log.record('sent', `frame-${index}`, 1);
  expect(log.all.length).toBe(500);
  expect(log.all[0].kind).toBe('frame-100');
  log.clear();
  expect(log.all).toEqual([]);
});

test('a latency dial holds a send back without losing it', async () => {
  const ws = socket();
  delaySends(ws, 20);
  ws.send('first');
  expect(ws.sent).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(ws.sent).toEqual(['first']);
});

test('a send delayed past closing is dropped rather than thrown', async () => {
  const ws = socket();
  delaySends(ws, 20);
  ws.send('first');
  ws.readyState = WebSocket.CLOSED;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(ws.sent).toEqual([]);
});

test('snapshot timings carry the gap in arrival and in world time', () => {
  const log = new SnapshotLog();
  log.record(1, 10);
  log.record(2, 10.25);
  const entries = log.all;
  expect(entries[0].arrival).toBe(0);
  expect(entries[0].advance).toBe(0);
  expect(entries[1].advance).toBeCloseTo(.25, 10);
  expect(entries[1].arrival).toBeGreaterThanOrEqual(0);
});

test('cadence ignores the first snapshot, which has nothing to be measured against', () => {
  const entries = [
    { at: 0, serial: 1, time: 0, arrival: 0, advance: 0 },
    { at: 250, serial: 2, time: .25, arrival: 250, advance: .25 },
    { at: 500, serial: 3, time: .5, arrival: 250, advance: .25 },
  ];
  const measured = cadence(entries);
  expect(measured.count).toBe(3);
  expect(measured.arrival).toEqual({ min: 250, max: 250, mean: 250 });
  expect(measured.advance.mean).toBeCloseTo(.25, 10);
  expect(measured.drift).toBeCloseTo(1, 10);
});

test('a world running slower than the wall clock shows as drift below one', () => {
  const entries = [
    { at: 0, serial: 1, time: 0, arrival: 0, advance: 0 },
    { at: 1000, serial: 2, time: .5, arrival: 1000, advance: .5 },
  ];
  expect(cadence(entries).drift).toBeCloseTo(.5, 10);
  expect(cadence([]).drift).toBe(0);
});
