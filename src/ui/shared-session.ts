import type { AuthorityRequest } from '../server/authority';
import type { ClientRequest, PublicSession, RejectCode } from '../server/protocol';
import { copySession, highWatermark, parsePacket, parsePending, validWire, type PendingEnvelope, type ReceiptResult, type SharedSnapshot } from './shared-session-protocol';

export type { SharedSnapshot } from './shared-session-protocol';

export interface SharedSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SendOutcome {
  ok: boolean;
  reason: string;
  cityId?: number;
  status: ReceiptResult['status'] | RejectCode | 'unsent' | 'indeterminate';
}

export type SharedSessionStatus = 'connecting' | 'open' | 'ready' | 'pending' | 'reconciling' | 'exhausted' | 'offline' | 'closed' | 'protocol-error' | 'storage-error' | 'indeterminate';

export interface SharedRequestOutcome {
  requestId: string;
  seq: number;
  outcome: SendOutcome;
}

export interface SharedSessionEvents {
  snapshot(snapshot: SharedSnapshot): void;
  realmChanged(): void;
  status(status: SharedSessionStatus, reason: string): void;
  outcome?(result: SharedRequestOutcome): void;
}

export interface SharedSessionInit {
  connect(): WebSocket;
  storage: SharedSessionStorage;
  schedule?(callback: () => void, milliseconds: number): () => void;
}

const PENDING_KEY = 'oikos.shared.pending.v1';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];
const RESPONSE_TIMEOUT = 15000;

function defaultSchedule(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

function failure(status: 'unsent' | 'indeterminate', reason: string): SendOutcome {
  return { ok: false, status, reason };
}

export class SharedSession {
  private socket: WebSocket | null = null;
  private generation = 0;
  private cancelReconnect: (() => void) | null = null;
  private cancelDeadline: (() => void) | null = null;
  private detach: (() => void) | null = null;
  private closed = false;
  private handshake = false;
  private attempt = 0;
  private phase: SharedSessionStatus = 'connecting';
  private blocked: 'protocol-error' | 'storage-error' | 'indeterminate' | null = null;
  private reason = '';
  private realmId: string | null = null;
  private streamId: string | null = null;
  private serial = 0;
  private session: PublicSession | null = null;
  private cityIds = new Set<number>();
  private pending: PendingEnvelope | null = null;
  private reconcileFloor: number | null = null;
  private awaitingReconcile = false;
  private resolvePending: ((outcome: SendOutcome) => void) | null = null;
  private readonly schedule: (callback: () => void, milliseconds: number) => () => void;

  constructor(private readonly init: SharedSessionInit, private readonly events: SharedSessionEvents) {
    this.schedule = init.schedule ?? defaultSchedule;
    try {
      const raw = init.storage.getItem(PENDING_KEY);
      if (raw !== null) {
        this.pending = parsePending(raw);
        if (!this.pending) this.block('storage-error', 'Pending request is corrupt. Preserve storage and resolve it before sending.');
      }
    } catch {
      this.block('storage-error', 'Pending storage is unreadable. Restore access before sending.');
    }
    this.open();
  }

  get currentStatus(): SharedSessionStatus {
    if (this.closed) return 'closed';
    if (this.blocked) return this.blocked;
    if (!this.handshake) return this.phase;
    if (this.pending) return 'pending';
    if (this.awaitingReconcile) return 'reconciling';
    if (this.session?.nextSeq === null) return 'exhausted';
    return 'ready';
  }

  get statusReason(): string { return this.reason; }

  private notify(): void {
    this.events.status(this.currentStatus, this.reason);
  }

  private block(status: 'protocol-error' | 'storage-error' | 'indeterminate', reason: string, reportRecovered = false): void {
    this.blocked = status;
    this.reason = reason;
    this.settle(failure('indeterminate', reason), reportRecovered);
    this.notify();
  }

  private open(): void {
    if (this.closed || this.blocked === 'protocol-error') return;
    const generation = ++this.generation;
    this.handshake = false;
    this.phase = 'connecting';
    this.notify();
    if (this.closed) return;
    let socket: WebSocket;
    try {
      socket = this.init.connect();
    } catch {
      this.disconnected();
      return;
    }
    this.socket = socket;
    const current = () => !this.closed && generation === this.generation;
    const opened = () => {
      if (!current()) return;
      this.phase = 'open';
      this.notify();
    };
    const message = (event: MessageEvent) => {
      if (current()) this.onMessage(event.data);
    };
    const lost = () => { if (current()) this.disconnected(); };
    socket.addEventListener('open', opened);
    socket.addEventListener('message', message);
    socket.addEventListener('close', lost);
    socket.addEventListener('error', lost);
    this.detach = () => {
      socket.removeEventListener('open', opened);
      socket.removeEventListener('message', message);
      socket.removeEventListener('close', lost);
      socket.removeEventListener('error', lost);
    };
    this.deadline();
  }

  private deadline(): void {
    this.cancelDeadline?.();
    this.cancelDeadline = null;
    if (this.closed || !this.socket) return;
    const generation = this.generation;
    this.cancelDeadline = this.schedule(() => {
      if (generation !== this.generation || this.closed) return;
      this.cancelDeadline = null;
      this.disconnected();
    }, RESPONSE_TIMEOUT);
  }

  private releaseSocket(): void {
    ++this.generation;
    this.handshake = false;
    this.cancelDeadline?.();
    this.cancelDeadline = null;
    this.detach?.();
    this.detach = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch {}
  }

  private disconnected(): void {
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.releaseSocket();
    this.phase = 'offline';
    this.settle(failure('indeterminate', 'Connection lost. The exact pending request is retained for recovery.'));
    this.notify();
    if (this.closed || this.blocked === 'protocol-error') return;
    const delay = RECONNECT_DELAYS[Math.min(this.attempt++, RECONNECT_DELAYS.length - 1)];
    this.cancelReconnect = this.schedule(() => {
      this.cancelReconnect = null;
      this.open();
    }, delay);
  }

  private protocolFailure(): void {
    this.releaseSocket();
    this.block('protocol-error', 'Invalid server protocol. Reload only after resolving the connection problem; pending intent is preserved.');
  }

  private cursorRegresses(session: PublicSession): boolean {
    return this.session !== null && highWatermark(session) < highWatermark(this.session);
  }

  private onMessage(raw: unknown): void {
    if (this.blocked === 'protocol-error') return;
    const packet = parsePacket(raw);
    if (!packet) { this.protocolFailure(); return; }
    if (packet.type === 'snapshot') { this.onSnapshot(packet); return; }
    if (!this.handshake) { this.protocolFailure(); return; }
    const wasPending = this.pending !== null;
    if (packet.type === 'receipt') {
      if (!this.pending || this.pending.requestId !== packet.requestId || this.pending.seq !== packet.seq) return;
      this.awaitingReconcile = true;
      this.reconcileFloor = packet.seq;
      this.settle(packet.result);
      this.clearPending();
    } else {
      if (packet.session.binding !== this.session?.binding || this.cursorRegresses(packet.session)) { this.protocolFailure(); return; }
      this.session = copySession(packet.session);
      this.awaitingReconcile = true;
      if (this.pending) {
        this.settle({ ok: false, reason: `Request rejected: ${packet.code}.`, status: packet.code });
        this.clearPending();
      }
    }
    if (wasPending || this.cancelDeadline === null) this.deadline();
    this.notify();
  }

  private onSnapshot(snapshot: SharedSnapshot): void {
    const { realmId, streamId, serial, session, world } = snapshot;
    const realmChanged = this.realmId !== null && this.realmId !== realmId;
    const streamChanged = this.streamId !== null && this.streamId !== streamId;
    const bindingChanged = this.session !== null && this.session.binding !== session.binding;
    if (this.handshake && (realmChanged || streamChanged || bindingChanged)) { this.protocolFailure(); return; }
    if (!realmChanged && !bindingChanged && this.cursorRegresses(session)) { this.protocolFailure(); return; }
    if (!realmChanged && !streamChanged && serial <= this.serial) return;
    const first = !this.handshake;
    this.handshake = true;
    this.attempt = 0;
    this.realmId = realmId;
    this.streamId = streamId;
    this.serial = serial;
    this.session = copySession(session);
    this.cityIds = new Set(world.cities.map((city) => city.id));
    if (realmChanged || bindingChanged) {
      this.awaitingReconcile = false;
      this.reconcileFloor = null;
    }
    if (this.awaitingReconcile && (this.reconcileFloor === null || highWatermark(session) >= this.reconcileFloor)) {
      this.awaitingReconcile = false;
      this.reconcileFloor = null;
    }
    if (first || (!this.pending && !this.awaitingReconcile)) {
      this.cancelDeadline?.();
      this.cancelDeadline = null;
    }
    if (this.pending && (this.pending.realmId !== realmId || this.pending.binding !== session.binding)) {
      this.settle(failure('indeterminate', 'The realm or login changed. Old intent will never be sent to this session.'), true);
      this.clearPending();
    }
    if (first && this.pending && !this.blocked) {
      if (this.pending.seq <= highWatermark(session)) this.transmit();
      else this.block('indeterminate', 'Pending intent is not proven consumed. Preserve it for explicit recovery; it will not be automatically applied.', true);
    }
    if (first && this.awaitingReconcile) this.deadline();
    if (realmChanged) this.events.realmChanged();
    if (this.closed) return;
    this.events.snapshot({ world, realmId, streamId, serial, session: copySession(session) });
    this.notify();
  }

  private settle(outcome: SendOutcome, reportRecovered = false): void {
    const resolve = this.resolvePending;
    this.resolvePending = null;
    resolve?.(outcome);
    if (this.pending && (resolve || reportRecovered || outcome.status !== 'indeterminate')) {
      this.events.outcome?.({ requestId: this.pending.requestId, seq: this.pending.seq, outcome: { ...outcome } });
    }
  }

  private clearPending(): boolean {
    try {
      this.init.storage.removeItem(PENDING_KEY);
      if (this.init.storage.getItem(PENDING_KEY) !== null) throw new Error('Pending removal was not durable.');
      this.pending = null;
      return true;
    } catch {
      this.block('storage-error', 'Could not confirm pending removal. Preserve storage; writes remain blocked.');
      return false;
    }
  }

  discardPending(): boolean {
    this.settle(failure('indeterminate', 'Pending recovery was explicitly abandoned. The original request may already have applied.'));
    if (!this.clearPending()) return false;
    if (this.blocked !== 'protocol-error') {
      this.blocked = null;
      this.reason = '';
    }
    this.awaitingReconcile = true;
    this.reconcileFloor = null;
    if (!this.closed && this.blocked !== 'protocol-error') this.disconnected();
    else this.notify();
    return true;
  }

  private transmit(): void {
    if (!this.pending || this.blocked) return;
    if (!this.handshake || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.disconnected();
      return;
    }
    try {
      const stored = this.init.storage.getItem(PENDING_KEY);
      if (stored === null || JSON.stringify(parsePending(stored)) !== JSON.stringify(this.pending)) {
        this.block('storage-error', 'Pending storage changed. Preserve it and resolve the request before sending.');
        return;
      }
    } catch {
      this.block('storage-error', 'Cannot verify durable pending bytes. Restore storage access before recovery.');
      return;
    }
    this.deadline();
    try {
      this.socket.send(this.pending.wire);
    } catch {
      this.disconnected();
    }
  }

  canSend(): boolean {
    return !this.closed && !this.blocked && this.handshake && this.socket?.readyState === WebSocket.OPEN
      && !this.pending && !this.awaitingReconcile && this.session !== null && this.session.nextSeq !== null;
  }

  send(operation: AuthorityRequest): Promise<SendOutcome> {
    if (!this.canSend()) return Promise.resolve(failure('unsent', 'Not ready to send a request.'));
    let envelope: PendingEnvelope;
    let raw: string;
    try {
      const requestId = crypto.randomUUID();
      const seq = this.session!.nextSeq!;
      const binding = this.session!.binding;
      const request: ClientRequest = { type: 'request', binding, requestId, seq, operation };
      const wire = JSON.stringify(request);
      if (!validWire(wire)) return Promise.resolve(failure('unsent', 'Invalid request or request exceeds 64 KiB.'));
      const parsed = JSON.parse(wire) as ClientRequest;
      if (parsed.operation.kind === 'command' && (!this.cityIds.has(parsed.operation.cityId) || !this.session!.ownedCityIds.includes(parsed.operation.cityId))) {
        return Promise.resolve(failure('unsent', 'The command requires an owned city in the current snapshot.'));
      }
      envelope = { realmId: this.realmId!, binding, wire, requestId, seq };
      raw = JSON.stringify(envelope);
    } catch {
      return Promise.resolve(failure('unsent', 'The request could not be serialized.'));
    }
    if (!this.canSend()) return Promise.resolve(failure('unsent', 'The session changed while preparing the request.'));
    try {
      if (this.init.storage.getItem(PENDING_KEY) !== null) {
        this.block('storage-error', 'Existing pending storage must be resolved before sending.');
        return Promise.resolve(failure('unsent', this.reason));
      }
    } catch {
      this.block('storage-error', 'Pending storage is unreadable. Restore access before sending.');
      return Promise.resolve(failure('unsent', this.reason));
    }
    let wrote = true;
    try { this.init.storage.setItem(PENDING_KEY, raw); } catch { wrote = false; }
    let confirmed: string | null;
    try { confirmed = this.init.storage.getItem(PENDING_KEY); } catch {
      this.pending = envelope;
      this.block('storage-error', 'Persistence is uncertain. The request may recover after reload; do not reissue it.');
      return Promise.resolve(failure('indeterminate', this.reason));
    }
    if (!wrote || confirmed !== raw) {
      if (confirmed !== null) this.pending = envelope;
      this.block('storage-error', 'Could not confirm persistence. Preserve pending storage before retrying.');
      return Promise.resolve(failure(confirmed === null ? 'unsent' : 'indeterminate', this.reason));
    }
    this.pending = envelope;
    const promise = new Promise<SendOutcome>((resolve) => { this.resolvePending = resolve; });
    this.transmit();
    this.notify();
    return promise;
  }

  get currentSession(): PublicSession | null {
    if (!this.session) return null;
    return copySession(this.session);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.releaseSocket();
    this.settle(failure('indeterminate', 'Session closed. Exact pending intent remains stored for recovery.'));
    this.notify();
  }
}
