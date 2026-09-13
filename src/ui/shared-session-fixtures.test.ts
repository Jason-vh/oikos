import { createWorld } from '../sim/world';
import { serializeWorld } from '../sim/save';
import { SharedSession, type SharedRequestOutcome, type SharedSessionEvents, type SharedSnapshot } from './shared-session';

export const REALM = '11111111-1111-4111-8111-111111111111';
export const STREAM = '22222222-2222-4222-8222-222222222222';
export const OTHER = '33333333-3333-4333-8333-333333333333';
export const BINDING = 'a'.repeat(64);
export const KEY = 'oikos.shared.pending.v1';
const WORLD = JSON.parse(serializeWorld(createWorld(1, 0)));

export class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  throwSend = false;
  throwClose = false;
  beforeSend = (_wire: string) => {};
  send(wire: string): void {
    this.beforeSend(wire);
    this.sent.push(wire);
    if (this.throwSend) throw new Error('send');
  }
  close(): void {
    this.drop();
    if (this.throwClose) throw new Error('close');
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  message(packet: unknown): void {
    this.raw(JSON.stringify(packet));
  }
  raw(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  drop(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

export class FakeStorage {
  raw = new Map<string, string>();
  read = (key: string): string | null => this.raw.get(key) ?? null;
  set = (key: string, value: string): void => { this.raw.set(key, value); };
  remove = (key: string): void => { this.raw.delete(key); };
  getItem(key: string): string | null { return this.read(key); }
  setItem(key: string, value: string): void { this.set(key, value); }
  removeItem(key: string): void { this.remove(key); }
}

export function snapshotPacket(overrides: Record<string, unknown> = {}) {
  return {
    type: 'snapshot', protocol: 2, realmId: REALM, streamId: STREAM, serial: 1,
    session: { binding: BINDING, ownedCityIds: [1], nextSeq: 2, receiptWatermark: 0 },
    world: structuredClone(WORLD), ...overrides,
  };
}

export function cursor(nextSeq: number | null, ownedCityIds = [1]) {
  const high = nextSeq === null ? Number.MAX_SAFE_INTEGER : nextSeq - 1;
  return { binding: BINDING, ownedCityIds, nextSeq, receiptWatermark: Math.max(0, high - 256) };
}

export function harness(options: { storage?: FakeStorage; connect?: () => FakeSocket; events?: Partial<SharedSessionEvents> } = {}) {
  const sockets: FakeSocket[] = [];
  const storage = options.storage ?? new FakeStorage();
  const snapshots: SharedSnapshot[] = [];
  const statuses: string[] = [];
  const outcomes: SharedRequestOutcome[] = [];
  let realmChanges = 0;
  let scheduled: { callback: () => void; ms: number }[] = [];
  const session = new SharedSession({
    storage,
    connect() {
      const socket = options.connect?.() ?? new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    schedule(callback, ms) {
      const entry = { callback, ms };
      scheduled.push(entry);
      return () => { scheduled = scheduled.filter((item) => item !== entry); };
    },
  }, {
    snapshot: (snapshot) => { snapshots.push(snapshot); options.events?.snapshot?.(snapshot); },
    realmChanged: () => { realmChanges++; options.events?.realmChanged?.(); },
    status: (status, reason) => { statuses.push(status); options.events?.status?.(status, reason); },
    outcome: (result) => { outcomes.push(result); options.events?.outcome?.(result); },
  });
  return {
    session, sockets, snapshots, storage, statuses, outcomes,
    get realmChanges() { return realmChanges; },
    get delays() { return scheduled.map((entry) => entry.ms); },
    fire(ms?: number) {
      const due = scheduled.filter((entry) => ms === undefined || entry.ms === ms);
      scheduled = scheduled.filter((entry) => !due.includes(entry));
      for (const entry of due) entry.callback();
    },
    connect(overrides: Record<string, unknown> = {}) {
      const socket = sockets.at(-1)!;
      socket.open();
      socket.message(snapshotPacket(overrides));
      return socket;
    },
  };
}

export function receipt(socket: FakeSocket, overrides: Record<string, unknown> = {}) {
  const request = JSON.parse(socket.sent.at(-1)!);
  return { type: 'receipt', requestId: request.requestId, seq: request.seq, result: { ok: true, reason: 'Done.', status: 'processed', cityId: 1 }, ...overrides };
}

export const COMMAND = { kind: 'command', cityId: 1, command: { type: 'demolish', x: 0, z: 0 } } as const;
