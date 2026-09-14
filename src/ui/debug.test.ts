import { expect, test } from 'bun:test';
import { ProtocolLog, debugEnabled, delaySends, latencyMillis, observe } from './debug';

class FakeSocket extends EventTarget {
  readyState = WebSocket.OPEN;
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
