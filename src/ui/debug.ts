export interface ProtocolEntry {
  at: number;
  direction: 'sent' | 'received';
  kind: string;
  bytes: number;
}

const LOG_LIMIT = 500;

export class ProtocolLog {
  private readonly entries: ProtocolEntry[] = [];

  record(direction: ProtocolEntry['direction'], kind: string, bytes: number): void {
    this.entries.push({ at: Math.round(performance.now()), direction, kind, bytes });
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT);
  }

  get all(): ProtocolEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const protocolLog = new ProtocolLog();

export interface SnapshotTiming {
  at: number;
  serial: number;
  time: number;
  arrival: number;
  advance: number;
}

export class SnapshotLog {
  private readonly entries: SnapshotTiming[] = [];

  record(serial: number, time: number): void {
    const at = Math.round(performance.now());
    const previous = this.entries[this.entries.length - 1];
    this.entries.push({
      at,
      serial,
      time,
      arrival: previous ? at - previous.at : 0,
      advance: previous ? time - previous.time : 0,
    });
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT);
  }

  get all(): SnapshotTiming[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const snapshotLog = new SnapshotLog();

export interface Spread {
  min: number;
  max: number;
  mean: number;
}

export interface Cadence {
  count: number;
  arrival: Spread;
  advance: Spread;
  drift: number;
}

const NO_SPREAD: Spread = { min: 0, max: 0, mean: 0 };

function spread(values: number[]): Spread {
  if (values.length === 0) return { ...NO_SPREAD };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min: Math.min(...values), max: Math.max(...values), mean };
}

export function cadence(entries: SnapshotTiming[]): Cadence {
  const measured = entries.slice(1);
  const arrival = spread(measured.map((entry) => entry.arrival));
  const advance = spread(measured.map((entry) => entry.advance));
  const wall = measured.reduce((sum, entry) => sum + entry.arrival, 0);
  const simulated = measured.reduce((sum, entry) => sum + entry.advance, 0) * 1000;
  return { count: entries.length, arrival, advance, drift: wall === 0 ? 0 : simulated / wall };
}

export function debugEnabled(search: string): boolean {
  return new URLSearchParams(search).has('debug');
}

export function latencyMillis(search: string): number {
  const raw = Number(new URLSearchParams(search).get('latency'));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 10_000);
}

const encoder = new TextEncoder();

function frameBytes(data: unknown): number {
  if (typeof data === 'string') return encoder.encode(data).length;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

function frameKind(data: unknown): string {
  if (typeof data !== 'string') return 'snapshot';
  try {
    const packet: unknown = JSON.parse(data);
    if (packet && typeof packet === 'object' && 'type' in packet) return String((packet as { type: unknown }).type);
  } catch {}
  return 'unparsed';
}

export function observe(socket: WebSocket, log: ProtocolLog = protocolLog): void {
  socket.addEventListener('message', (event) => {
    log.record('received', frameKind(event.data), frameBytes(event.data));
  });
  for (const name of ['open', 'close', 'error'] as const) {
    socket.addEventListener(name, () => log.record('received', name, 0));
  }
  const send = socket.send.bind(socket);
  socket.send = (data: string) => {
    log.record('sent', frameKind(data), frameBytes(data));
    send(data);
  };
}

export function delaySends(socket: WebSocket, latency: number): void {
  if (latency <= 0) return;
  const send = socket.send.bind(socket);
  socket.send = (data: string) => {
    setTimeout(() => { if (socket.readyState === WebSocket.OPEN) send(data); }, latency);
  };
}
