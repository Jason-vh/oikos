import { expect } from 'bun:test';
import { startServer, type RuntimeClock } from './runtime';
import { Authority } from './authority';
import { freshAuthority, rid } from './authority-fixtures.test';
import type { AuthorityRequest } from './authority';
import type { ServerPacket } from './protocol';

export class TestClock implements RuntimeClock {
  time = 0;
  callback = () => {};
  now = () => this.time;
  schedule(callback: () => void, milliseconds: number) {
    expect(milliseconds).toBe(250);
    this.callback = callback;
    return () => { this.callback = () => {}; };
  }
  step(milliseconds = 250) {
    this.time += milliseconds;
    this.callback();
  }
}

export async function fixture(cleanups: Array<() => unknown>, prepare: (authority: Authority) => void = () => {}) {
  const files: Array<() => void> = [];
  const { path, authority } = freshAuthority(files);
  cleanups.push(() => { for (const cleanup of files.reverse()) cleanup(); });
  const invites = Array.from({ length: 8 }, () => authority.issueInvite());
  prepare(authority);
  authority.close();
  const clock = new TestClock();
  const origin = 'http://127.0.0.1:43210';
  const runtime = startServer({ path, publicOrigin: origin, port: 0, clock });
  cleanups.push(() => runtime.stop());
  const base = `http://127.0.0.1:${runtime.server.port}`;
  async function redeem(invite: string, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/session/redeem`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ invite }) });
  }
  async function cookie(invite = invites[0]) {
    const response = await redeem(invite);
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  return { path, clock, origin, runtime, base, invites, redeem, cookie };
}

export class Peer {
  readonly ws: WebSocket;
  readonly packets: ServerPacket[] = [];
  private listeners = new Set<() => void>();
  readonly closed: Promise<CloseEvent>;
  constructor(base: string, origin: string, cookie: string) {
    const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
    this.ws = new BunWebSocket(`${base.replace('http:', 'ws:')}/api/world`, { headers: { Origin: origin, Cookie: cookie } });
    this.ws.addEventListener('message', (event) => {
      this.packets.push(JSON.parse(String(event.data)) as ServerPacket);
      for (const notify of this.listeners) notify();
    });
    this.closed = new Promise((resolve) => { this.ws.addEventListener('close', resolve, { once: true }); });
  }
  async next<T extends ServerPacket['type']>(type: T | T[]): Promise<Extract<ServerPacket, { type: T }>> {
    const types: string[] = Array.isArray(type) ? type : [type];
    const find = () => this.packets.findIndex((packet) => types.includes(packet.type));
    if (find() < 0) await new Promise<void>((resolve, reject) => {
      const notify = () => {
        if (find() < 0) return;
        clearTimeout(timeout);
        this.listeners.delete(notify);
        resolve();
      };
      const timeout = setTimeout(() => { this.listeners.delete(notify); reject(new Error(`No ${type} packet.`)); }, 3000);
      this.listeners.add(notify);
    });
    return this.packets.splice(find(), 1)[0] as Extract<ServerPacket, { type: T }>;
  }
  send(seq: number, operation: AuthorityRequest, id = rid(seq)) {
    this.ws.send(JSON.stringify({ type: 'request', requestId: id, seq, operation }));
  }
  async close() {
    this.ws.close();
    await this.closed;
  }
}

export async function connect(cleanups: Array<() => unknown>, f: Awaited<ReturnType<typeof fixture>>, cookie: string) {
  const peer = new Peer(f.base, f.origin, cookie);
  cleanups.push(() => peer.close());
  const snapshot = await peer.next('snapshot');
  return { peer, snapshot };
}
