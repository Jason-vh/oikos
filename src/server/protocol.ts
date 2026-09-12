import type { AuthorityRequest, RequestOutcome, RequestStatus, Session } from './authority';
import type { World } from '../sim/types';

export const PROTOCOL = 1;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const COOKIE = '__Host-oikos';
export type PublicSession = Omit<Session, 'actorId'>;
export interface ClientRequest {
  type: 'request';
  requestId: string;
  seq: number;
  operation: AuthorityRequest;
}
export type RejectCode = Exclude<RequestStatus, 'processed' | 'replayed'> | 'rate-limited';
export type ServerPacket =
  | { type: 'snapshot'; protocol: 1; realmId: string; streamId: string; serial: number; session: PublicSession; world: World }
  | { type: 'receipt'; requestId: string; seq: number; result: RequestOutcome }
  | { type: 'reject'; code: RejectCode; session: PublicSession };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseRequest(raw: string): ClientRequest | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !exactKeys(value, ['type', 'requestId', 'seq', 'operation'])) return null;
    if (value.type !== 'request' || typeof value.requestId !== 'string' || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value.requestId)) return null;
    if (!Number.isSafeInteger(value.seq) || (value.seq as number) <= 0 || !record(value.operation)) return null;
    const operation = value.operation;
    if (operation.kind === 'claim') {
      if (!exactKeys(operation, ['kind', 'home']) || !Number.isSafeInteger(operation.home)) return null;
    } else if (operation.kind === 'command') {
      if (!exactKeys(operation, ['kind', 'cityId', 'command']) || !Number.isSafeInteger(operation.cityId)) return null;
    } else return null;
    return value as unknown as ClientRequest;
  } catch {
    return null;
  }
}

export function publicSession(session: Session): PublicSession {
  return { ownedCityIds: session.ownedCityIds, nextSeq: session.nextSeq, receiptWatermark: session.receiptWatermark };
}

export function credentialFrom(request: Request): string {
  const values = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return '';
  const value = values[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}

export async function parseInvite(request: Request): Promise<string | null> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) return null;
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!record(value) || !exactKeys(value, ['invite']) || typeof value.invite !== 'string' || !/^[a-f0-9]{64}$/i.test(value.invite)) return null;
    return value.invite.toLowerCase();
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
