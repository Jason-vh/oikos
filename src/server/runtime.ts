import type { ServerWebSocket } from 'bun';
import { createHash, randomUUID } from 'node:crypto';
import { Authority } from './authority';
import { COOKIE, MAX_REQUEST_BYTES, PROTOCOL, credentialFrom, parseInvite, parseRequest, publicSession, type RejectCode } from './protocol';

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
}
interface SocketData {
  credential: string;
  binding: string;
  actorId: number;
  snapshotDue: boolean;
  lastSnapshot: number;
}
interface Bucket { tokens: number; at: number }
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
  let checkpointAt = clock.now();
  let serial = 0;
  let cancel = () => {};
  let stopPromise: Promise<void> | undefined;
  let signalFailure!: () => void;
  const failed = new Promise<void>((resolve) => { signalFailure = resolve; });

  function hasOpenSocket(): boolean {
    return [...sockets].some((ws) => ws.readyState === 1);
  }

  function settle(): void {
    if (anchor === null) return;
    const now = clock.now();
    const elapsed = now - anchor;
    anchor = now;
    if (elapsed > 0 && elapsed <= 5000) authority.advance(elapsed / 1000);
  }

  function fatal(): void {
    if (!healthy) return;
    healthy = false;
    signalFailure();
    void stop();
  }

  function guarded(run: () => void): void {
    if (stopped) return;
    try { run(); } catch { fatal(); }
  }

  function session(ws: ServerWebSocket<SocketData>) {
    const value = authority.authenticate(ws.data.credential);
    if (!value) throw new Error('Authenticated session disappeared.');
    return publicSession(value, ws.data.binding);
  }

  function control(ws: ServerWebSocket<SocketData>, packet: unknown): void {
    if (ws.readyState !== 1) return;
    if (ws.getBufferedAmount() > 0 || ws.send(JSON.stringify(packet), true) <= 0) ws.terminate();
  }

  function reject(ws: ServerWebSocket<SocketData>, code: RejectCode): void {
    control(ws, { type: 'reject', code, session: session(ws) });
  }

  function snapshots(): void {
    const now = clock.now();
    const ready = [...sockets].filter((ws) => ws.readyState === 1 && ws.data.snapshotDue && now - ws.data.lastSnapshot >= 250 && ws.getBufferedAmount() === 0);
    if (!ready.length) return;
    if (serial >= Number.MAX_SAFE_INTEGER) throw new Error('Snapshot serial exhausted.');
    const world = JSON.stringify(authority.snapshot());
    const header = { type: 'snapshot', protocol: PROTOCOL, realmId: authority.realmId, streamId, serial: ++serial };
    for (const ws of ready) {
      const prefix = JSON.stringify({ ...header, session: session(ws) });
      const sent = ws.send(`${prefix.slice(0, -1)},"world":${world}}`, true);
      ws.data.snapshotDue = false;
      ws.data.lastSnapshot = now;
      if (sent === 0) ws.terminate();
    }
  }

  function tick(): void {
    guarded(() => {
      if (!hasOpenSocket()) return;
      settle();
      const now = clock.now();
      if (now - checkpointAt >= 5000 || now < checkpointAt) {
        authority.checkpoint();
        checkpointAt = now;
      }
      for (const ws of sockets) ws.data.snapshotDue = true;
      snapshots();
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

  let server: ReturnType<typeof Bun.serve<SocketData>>;
  try {
    server = Bun.serve({
      hostname: options.hostname ?? '127.0.0.1',
      port: options.port ?? 3000,
      maxRequestBodySize: 1024,
      fetch(request, listener) {
        if (!healthy || stopped) return response(503, 'unavailable');
        const path = new URL(request.url).pathname;
        if (path === '/healthz' && request.method === 'GET') return response(200, 'healthy');
        if (path !== '/api/session/redeem' && path !== '/api/world') return response(404, 'not-found');
        if (request.headers.get('origin') !== options.publicOrigin) return response(403, 'origin-denied');
        try {
          const credential = credentialFrom(request);
          const authenticated = credential ? authority.authenticate(credential) : null;
          if (path === '/api/session/redeem') {
            if (request.method !== 'POST') return response(405, 'method-not-allowed');
            if (authenticated) return response(409, 'already-authenticated');
            const ip = listener.requestIP(request)?.address;
            if (!ip || !take(admissions, ip, clock.now(), 5, 5 / 60)) return response(429, 'rate-limited');
            return parseInvite(request).then((invite) => {
              if (!invite) return response(400, 'invalid-invite');
              if (!healthy || stopped) return response(503, 'unavailable');
              const admission = authority.admitInvite(invite);
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
        perMessageDeflate: true,
        maxPayloadLength: MAX_REQUEST_BYTES,
        backpressureLimit: 1024 * 1024,
        closeOnBackpressureLimit: true,
        idleTimeout: 60,
        open(ws) {
          if (stopped) { slots.delete(ws.data); ws.terminate(); return; }
          guarded(() => {
            if (!hasOpenSocket()) { anchor = clock.now(); checkpointAt = anchor; }
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
            if (result.status === 'processed' || result.status === 'replayed') {
              control(ws, { type: 'receipt', requestId: request.requestId, seq: request.seq, result });
            } else reject(ws, result.status);
            for (const peer of sockets) peer.data.snapshotDue = true;
            snapshots();
          });
        },
        drain() {},
        close(ws) {
          slots.delete(ws.data);
          guarded(() => {
            sockets.delete(ws);
            if (!hasOpenSocket()) { settle(); authority.checkpoint(); anchor = null; }
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
