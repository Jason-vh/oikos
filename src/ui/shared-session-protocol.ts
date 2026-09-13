import { MAX_REQUEST_BYTES, PROTOCOL, parseRequest, type PublicSession, type RejectCode } from '../server/protocol';
import { deserializeSharedWorld } from '../sim/save';
import type { World } from '../sim/types';

export interface SharedSnapshot {
  world: World;
  session: PublicSession;
  realmId: string;
  streamId: string;
  serial: number;
}

export interface PendingEnvelope {
  realmId: string;
  binding: string;
  wire: string;
  requestId: string;
  seq: number;
}

export interface ReceiptResult {
  ok: boolean;
  reason: string;
  status: 'processed' | 'replayed';
  cityId?: number;
}

type Packet =
  | (SharedSnapshot & { type: 'snapshot'; protocol: 2 })
  | { type: 'receipt'; requestId: string; seq: number; result: ReceiptResult }
  | { type: 'reject'; code: RejectCode; session: PublicSession };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REQUEST_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
const REJECT_CODES = new Set<unknown>(['invalid-request', 'unauthenticated', 'gap', 'conflict', 'pruned', 'exhausted', 'rate-limited', 'session-mismatch']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function highWatermark(session: PublicSession): number {
  if (session.nextSeq === null) return Number.MAX_SAFE_INTEGER;
  return session.nextSeq - 1;
}

export function copySession(session: PublicSession): PublicSession {
  return { ...session, ownedCityIds: [...session.ownedCityIds] };
}

function validSession(value: unknown): value is PublicSession {
  if (!record(value) || !keys(value, ['binding', 'ownedCityIds', 'nextSeq', 'receiptWatermark'])) return false;
  if (typeof value.binding !== 'string' || !/^[a-f0-9]{64}$/.test(value.binding)) return false;
  if (!Array.isArray(value.ownedCityIds) || !value.ownedCityIds.every(positive)) return false;
  if (new Set(value.ownedCityIds).size !== value.ownedCityIds.length) return false;
  if (value.nextSeq !== null && !positive(value.nextSeq)) return false;
  const session = value as unknown as PublicSession;
  return value.receiptWatermark === Math.max(0, highWatermark(session) - 256);
}

export function validWire(wire: string): boolean {
  return new TextEncoder().encode(wire).byteLength <= MAX_REQUEST_BYTES && parseRequest(wire) !== null;
}

export function parsePending(raw: string): PendingEnvelope | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !keys(value, ['realmId', 'binding', 'wire', 'requestId', 'seq'])) return null;
    if (!uuid(value.realmId) || typeof value.wire !== 'string' || !validWire(value.wire)) return null;
    const request = parseRequest(value.wire)!;
    if (request.binding !== value.binding || request.requestId !== value.requestId || request.seq !== value.seq) return null;
    return value as unknown as PendingEnvelope;
  } catch {
    return null;
  }
}

export function parsePacket(raw: unknown): Packet | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value)) return null;
    if (value.type === 'snapshot') {
      if (!keys(value, ['type', 'protocol', 'realmId', 'streamId', 'serial', 'session', 'world'])) return null;
      if (value.protocol !== PROTOCOL || !uuid(value.realmId) || !uuid(value.streamId) || !positive(value.serial) || !validSession(value.session)) return null;
      const world = deserializeSharedWorld(JSON.stringify(value.world));
      if (!world || !value.session.ownedCityIds.every((id) => world.cities.some((city) => city.id === id))) return null;
      return { ...value, world } as Packet;
    }
    if (value.type === 'reject') {
      if (!keys(value, ['type', 'code', 'session']) || !REJECT_CODES.has(value.code) || !validSession(value.session)) return null;
      return value as unknown as Packet;
    }
    if (value.type !== 'receipt' || !keys(value, ['type', 'requestId', 'seq', 'result'])) return null;
    if (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) || !positive(value.seq) || !record(value.result)) return null;
    const result = value.result;
    const expected = ['ok', 'reason', 'status'];
    if (Object.hasOwn(result, 'cityId')) {
      if (!positive(result.cityId)) return null;
      expected.push('cityId');
    }
    if (!keys(result, expected) || typeof result.ok !== 'boolean' || typeof result.reason !== 'string') return null;
    if (result.status !== 'processed' && result.status !== 'replayed') return null;
    return value as unknown as Packet;
  } catch {
    return null;
  }
}
