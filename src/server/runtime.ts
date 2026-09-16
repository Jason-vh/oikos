import type { ServerWebSocket } from 'bun';
import { createHash, randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AuthorityGame } from '../agent/authority-game';
import { createServer } from '../agent/mcp';
import { Authority } from './authority';
import { COOKIE, MAX_REQUEST_BYTES, PROTOCOL, credentialFrom, parseJoin, parseRequest, publicSession, type RejectCode } from './protocol';
import { serializeWorld } from '../sim/save';

export interface RuntimeClock {
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}
export interface RuntimeOptions {
  path: string;
  publicOrigin: string;
  hostname?: string;
  port?: number;
  clock?: RuntimeClock;
  allowReset?: boolean;
}
interface SocketData {
  credential: string;
  binding: string;
  actorId: number;
  snapshotDue: boolean;
  lastSnapshot: number;
}
interface Bucket { tokens: number; at: number }
export const AGENT_PRESENCE_MS = 30_000;
const BEARER = /^Bearer ([a-f0-9]{64})$/;
const VERBOSE = process.env.OIKOS_LOG === '1';

function trace(event: string, detail: Record<string, unknown> = {}): void {
  if (!VERBOSE) return;
  const fields = Object.entries(detail).map(([key, value]) => `${key}=${String(value)}`).join(' ');
  console.log(`[oikos] ${event}${fields.length > 0 ? ` ${fields}` : ''}`);
}
const SNAPSHOT_INTERVAL_MS = 250;
const clockDefault: RuntimeClock = {
  now: () => performance.now(),
  schedule(callback, milliseconds) {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  },
};

function take(buckets: Map<string | number, Bucket>, key: string | number, now: number, capacity: number, perSecond: number): boolean {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 4096) {
      for (const [id, entry] of buckets) if (now - entry.at >= capacity / perSecond * 1000) buckets.delete(id);
      if (buckets.size >= 4096) return false;
    }
    bucket = { tokens: capacity, at: now };
    buckets.set(key, bucket);
  }
  bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) / 1000 * perSecond);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function response(status: number, code: string): Response {
  return Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function startServer(options: RuntimeOptions) {
  if (!Bun.semver.satisfies(Bun.version, '>=1.4.2')) throw new Error('Authority transport requires Bun 1.4.2 or newer.');
  const origin = new URL(options.publicOrigin);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.origin !== options.publicOrigin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) throw new Error('publicOrigin must be an exact HTTPS origin or HTTP loopback origin.');
  const authority = Authority.open(options.path);
  const clock = options.clock ?? clockDefault;
  const streamId = randomUUID();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const slots = new Set<SocketData>();
  const requests = new Map<string | number, Bucket>();
  const admissions = new Map<string | number, Bucket>();
  let healthy = true;
  let stopped = false;
  let anchor: number | null = null;
  let agentsPresentUntil = -Infinity;
  let checkpointAt = clock.now();
  let lastTick = clock.now();
  let serial = 0;
  let cancel = () => {};
  let stopPromise: Promise<void> | undefined;
  let signalFailure!: () => void;
  const failed = new Promise<void>((resolve) => { signalFailure = resolve; });

  function hasOpenSocket(): boolean {
    return [...sockets].some((ws) => ws.readyState === 1);
  }

  function anyonePlaying(): boolean {
    return hasOpenSocket() || clock.now() < agentsPresentUntil;
  }

  function beginPlaying(): void {
    if (anchor !== null) return;
    anchor = clock.now();
    checkpointAt = anchor;
  }

  function settle(): void {
    if (anchor === null) return;
    const now = clock.now();
    const elapsed = now - anchor;
    anchor = now;
    if (elapsed > 0 && elapsed <= 5000) authority.advance(elapsed / 1000);
  }

  function fatal(error?: unknown): void {
    if (error !== undefined) console.error('[oikos] fatal', error);
    if (!healthy) return;
    healthy = false;
    signalFailure();
    void stop();
  }

  function guarded(run: () => void): void {
    if (stopped) return;
    try { run(); } catch (error) { fatal(error); }
  }

  function session(ws: ServerWebSocket<SocketData>) {
    const value = authority.authenticate(ws.data.credential);
    if (!value) throw new Error('Authenticated session disappeared.');
    return publicSession(value, ws.data.binding);
  }

  function control(ws: ServerWebSocket<SocketData>, packet: unknown): void {
    if (ws.readyState !== 1) {
      trace('control-skipped', { actor: ws.data.actorId, readyState: ws.readyState });
      return;
    }
    const sent = ws.send(JSON.stringify(packet));
    trace('control-sent', { actor: ws.data.actorId, sent, buffered: ws.getBufferedAmount() });
    if (sent === 0) ws.terminate();
  }

  function reject(ws: ServerWebSocket<SocketData>, code: RejectCode): void {
    trace('reject', { actor: ws.data.actorId, code });
    control(ws, { type: 'reject', code, session: session(ws) });
  }

  function snapshots(author: ServerWebSocket<SocketData> | null = null, beat = false): void {
    const now = clock.now();
    const due = (ws: ServerWebSocket<SocketData>) => beat || ws === author || now - ws.data.lastSnapshot >= SNAPSHOT_INTERVAL_MS;
    if (VERBOSE) for (const ws of sockets) {
      if (ws.readyState === 1 && ws.data.snapshotDue && !due(ws)) trace('snapshot-not-due', { since: (now - ws.data.lastSnapshot).toFixed(2) });
    }
    const eligible = [...sockets].filter((ws) => ws.readyState === 1 && ws.data.snapshotDue && due(ws));
    const ready = eligible.filter((ws) => ws.getBufferedAmount() === 0);
    if (VERBOSE) for (const ws of eligible) {
      const buffered = ws.getBufferedAmount();
      if (buffered !== 0) trace('snapshot-skipped', { actor: ws.data.actorId, buffered });
    }
    if (!ready.length) return;
    if (serial >= Number.MAX_SAFE_INTEGER) throw new Error('Snapshot serial exhausted.');
    const world = serializeWorld(authority.snapshot());
    const header = { type: 'snapshot', protocol: PROTOCOL, realmId: authority.realmId, streamId, serial: ++serial };
    for (const ws of ready) {
      const prefix = JSON.stringify({ ...header, session: session(ws) });
      const early = !beat && now - ws.data.lastSnapshot < SNAPSHOT_INTERVAL_MS;
      const sent = ws.send(Bun.gzipSync(`${prefix.slice(0, -1)},"world":${world}}`));
      ws.data.snapshotDue = false;
      if (!early) ws.data.lastSnapshot = now;
      if (sent === 0) {
        trace('snapshot-dropped', { actor: ws.data.actorId, buffered: ws.getBufferedAmount() });
        ws.terminate();
      }
    }
  }

  function tick(): void {
    guarded(() => {
      if (VERBOSE) {
        const now = clock.now();
        if (now - lastTick > SNAPSHOT_INTERVAL_MS * 1.5) trace('tick-late', { since: Math.round(now - lastTick) });
        lastTick = now;
      }
      if (!anyonePlaying()) {
        if (anchor === null) return;
        settle();
        authority.checkpoint();
        anchor = null;
        return;
      }
      settle();
      const now = clock.now();
      if (now - checkpointAt >= 5000 || now < checkpointAt) {
        authority.checkpoint();
        checkpointAt = now;
      }
      for (const ws of sockets) ws.data.snapshotDue = true;
      snapshots(null, true);
    });
  }

  async function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    if (stopped) return;
    if (healthy) {
      try { settle(); authority.checkpoint(); } catch { healthy = false; signalFailure(); }
    }
    stopped = true;
    cancel();
    stopPromise = Promise.resolve(server.stop(true)).finally(() => {
      sockets.clear();
      slots.clear();
      authority.close();
    }).catch(() => { healthy = false; signalFailure(); throw new Error('Authority shutdown failed.'); });
    return stopPromise;
  }

  async function serveAgent(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== options.publicOrigin) return response(403, 'origin-denied');
    const offered = BEARER.exec(request.headers.get('authorization') ?? '');
    const credential = offered ? offered[1] : '';
    const authenticated = credential ? authority.authenticate(credential) : null;
    if (!authenticated) {
      return Response.json({ code: 'unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer realm="oikos"' } });
    }
    if (!take(requests, authenticated.actorId, clock.now(), 16, 8)) return response(429, 'rate-limited');

    settle();
    agentsPresentUntil = clock.now() + AGENT_PRESENCE_MS;
    beginPlaying();

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createServer(new AuthorityGame(authority, credential));
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      for (const ws of sockets) ws.data.snapshotDue = true;
      snapshots();
    }
  }

  let server: ReturnType<typeof Bun.serve<SocketData>>;
  try {
    server = Bun.serve({
      hostname: options.hostname ?? '127.0.0.1',
      port: options.port ?? 3000,
      maxRequestBodySize: MAX_REQUEST_BYTES,
      fetch(request, listener) {
        if (!healthy || stopped) return response(503, 'unavailable');
        const path = new URL(request.url).pathname;
        if (path === '/healthz' && request.method === 'GET') return response(200, 'healthy');
        if (path === '/mcp') {
          return serveAgent(request).catch(() => { fatal(); return response(503, 'unavailable'); });
        }
        if (path !== '/api/session/join' && path !== '/api/world' && path !== '/api/world/preview' && path !== '/api/world/reset') return response(404, 'not-found');
        if (path === '/api/world/reset' && !options.allowReset) return response(404, 'not-found');
        const browserOrigin = request.headers.get('origin');
        const previewing = path === '/api/world/preview';
        if (previewing && browserOrigin !== null && browserOrigin !== options.publicOrigin) return response(403, 'origin-denied');
        if (!previewing && browserOrigin !== options.publicOrigin) return response(403, 'origin-denied');
        try {
          const credential = credentialFrom(request);
          const authenticated = credential ? authority.authenticate(credential) : null;
          if (previewing) {
            if (request.method !== 'GET') return response(405, 'method-not-allowed');
            const ip = listener.requestIP(request)?.address;
            if (!ip || !take(requests, ip, clock.now(), 8, 2)) return response(429, 'rate-limited');
            const body = `{"known":${authenticated !== null},"canReset":${options.allowReset === true},"world":${serializeWorld(authority.snapshot())}}`;
            return new Response(Bun.gzipSync(body), { headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
              'Cache-Control': 'no-store',
            } });
          }
          if (path === '/api/world/reset') {
            if (request.method !== 'POST') return response(405, 'method-not-allowed');
            if (!authenticated) return response(401, 'unauthenticated');
            if (!take(requests, authenticated.actorId, clock.now(), 4, 1)) return response(429, 'rate-limited');
            settle();
            authority.reset();
            anchor = null;
            for (const ws of sockets) ws.terminate();
            return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
          }
          if (path === '/api/session/join') {
            if (request.method !== 'POST') return response(405, 'method-not-allowed');
            if (authenticated) return response(409, 'already-authenticated');
            const ip = listener.requestIP(request)?.address;
            if (!ip || !take(admissions, ip, clock.now(), 5, 5 / 60)) return response(429, 'rate-limited');
            return parseJoin(request).then((joining) => {
              if (!joining) return response(400, 'invalid-name');
              if (!healthy || stopped) return response(503, 'unavailable');
              const admission = authority.admit(joining.name, joining.color);
              if (!admission.ok) return response(403, 'admission-denied');
              return Response.json({ ok: true }, { headers: {
                'Cache-Control': 'no-store',
                'Set-Cookie': `${COOKIE}=${admission.credential}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
              } });
            }).catch(() => { fatal(); return response(503, 'unavailable'); });
          }
          if (request.method !== 'GET') return response(405, 'method-not-allowed');
          if (!authenticated) return response(401, 'unauthenticated');
          if (slots.size >= 64 || [...slots].filter((slot) => slot.actorId === authenticated.actorId).length >= 8) return response(429, 'socket-limit');
          const binding = createHash('sha256').update(`oikos:session-binding:v1\0${authority.realmId}\0${credential}`).digest('hex');
          const data: SocketData = { credential, binding, actorId: authenticated.actorId, snapshotDue: true, lastSnapshot: -Infinity };
          slots.add(data);
          if (listener.upgrade(request, { data })) return;
          slots.delete(data);
          return response(400, 'upgrade-required');
        } catch {
          fatal();
          return response(503, 'unavailable');
        }
      },
      websocket: {
        data: {} as SocketData,
        perMessageDeflate: false,
        maxPayloadLength: MAX_REQUEST_BYTES,
        backpressureLimit: 1024 * 1024,
        closeOnBackpressureLimit: true,
        idleTimeout: 60,
        open(ws) {
          trace('socket-open', { actor: ws.data.actorId });
          if (stopped) { slots.delete(ws.data); ws.terminate(); return; }
          guarded(() => {
            beginPlaying();
            sockets.add(ws);
            snapshots();
          });
        },
        message(ws, message) {
          guarded(() => {
            settle();
            if (!take(requests, ws.data.actorId, clock.now(), 16, 8)) { reject(ws, 'rate-limited'); return; }
            const request = typeof message === 'string' && Buffer.byteLength(message) <= MAX_REQUEST_BYTES ? parseRequest(message) : null;
            if (!request) { reject(ws, 'invalid-request'); return; }
            if (request.binding !== ws.data.binding) { reject(ws, 'session-mismatch'); return; }
            const result = authority.submit(ws.data.credential, request.seq, request.requestId, request.operation);
            trace('request', { actor: ws.data.actorId, seq: request.seq, kind: request.operation.kind, status: result.status, buffered: ws.getBufferedAmount() });
            let author: ServerWebSocket<SocketData> | null = null;
            if (result.status === 'processed' || result.status === 'replayed') {
              control(ws, { type: 'receipt', requestId: request.requestId, seq: request.seq, result });
              author = ws;
            } else reject(ws, result.status);
            for (const peer of sockets) peer.data.snapshotDue = true;
            snapshots(author);
          });
        },
        drain() {},
        close(ws) {
          trace('socket-close', { actor: ws.data.actorId });
          slots.delete(ws.data);
          guarded(() => {
            sockets.delete(ws);
            if (!anyonePlaying()) { settle(); authority.checkpoint(); anchor = null; }
          });
        },
      },
    });
    cancel = clock.schedule(tick, 250);
  } catch (error) {
    authority.close();
    throw error;
  }
  return { server, failed, stop, get healthy() { return healthy && !stopped; } };
}
