import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import type { World } from '../sim/types';
import { claimIsland } from '../sim/claims';
import { applyCommand, parseCommand } from '../sim/commands';
import { ISLAND_COUNT } from '../sim/island';
import { type AuthorityDb, closeStore, openStore, readWorldRow, selectAll, selectOne, writeWorldRow } from './store';

export const ACTOR_CAP = ISLAND_COUNT;
export const RETAINED_RECEIPTS = 256;

export type AuthorityRequest = { kind: 'claim'; home: number } | { kind: 'command'; cityId: number; command: unknown };

export type RequestStatus = 'unauthenticated' | 'invalid-request' | 'gap' | 'pruned' | 'conflict' | 'replayed' | 'processed' | 'exhausted';

export interface RequestOutcome {
  ok: boolean;
  reason: string;
  cityId?: number;
  status: RequestStatus;
}

export interface Session {
  actorId: number;
  nextSeq: number | null;
  ownedCityIds: number[];
  receiptWatermark: number;
}

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{32}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

function copyFiniteJson(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Unrepresentable command payload.');
    return value;
  }
  if (Array.isArray(value)) {
    const length = value.length;
    if (seen.has(value) || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== length + 1) throw new Error('Unrepresentable command payload.');
    seen.add(value);
    const copied: unknown[] = [];
    for (let index = 0; index < length; index++) {
      if (!Object.getOwnPropertyDescriptor(value, String(index))?.enumerable) throw new Error('Unrepresentable command payload.');
      copied.push(copyFiniteJson(value[index], seen));
    }
    return copied;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    const keys = Object.keys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      seen.has(value) ||
      Object.getOwnPropertySymbols(value).length > 0 ||
      keys.length !== Object.getOwnPropertyNames(value).length
    ) {
      throw new Error('Unrepresentable command payload.');
    }
    seen.add(value);
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of keys.sort()) sorted[key] = copyFiniteJson((value as Record<string, unknown>)[key], seen);
    return sorted;
  }
  throw new Error('Unrepresentable command payload.');
}

function normalizeRequestOnce(request: unknown): AuthorityRequest | null {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const candidate = request as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind === 'claim') {
    const home = candidate.home;
    if (typeof home !== 'number' || !Number.isInteger(home)) return null;
    return { kind, home };
  }
  if (kind !== 'command') return null;
  const cityId = candidate.cityId;
  if (typeof cityId !== 'number' || !Number.isSafeInteger(cityId) || !('command' in candidate)) return null;
  const command = candidate.command;
  return { kind, cityId, command: copyFiniteJson(parseCommand(command) ?? command) };
}

function fingerprintOf(normalized: AuthorityRequest): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(normalized))).digest('hex');
}

const STORED_OUTCOME_KEYS = new Set(['ok', 'reason', 'status', 'cityId']);

function isValidStoredOutcome(value: unknown): value is RequestOutcome {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as Record<string, unknown>;
  for (const key of Object.keys(outcome)) if (!STORED_OUTCOME_KEYS.has(key)) return false;
  if (typeof outcome.ok !== 'boolean' || typeof outcome.reason !== 'string') return false;
  if (outcome.cityId !== undefined && !Number.isSafeInteger(outcome.cityId)) return false;
  return outcome.status === 'processed';
}

function assertSafePositiveInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`Authority store has an invalid ${label}.`);
}

function assertSafeNonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Authority store has an invalid ${label}.`);
}

function verifyStoredInvariants(db: Database, world: World): void {
  const actorIds = new Set(selectAll<{ id: number }>(db, 'SELECT id FROM actors;').map((row) => row.id));
  if (actorIds.size > ACTOR_CAP) throw new Error('Authority store holds more actors than the cap allows.');
  for (const id of actorIds) assertSafePositiveInteger(id, 'actor id');

  const ownedByActor = new Map<number, Set<number>>();
  const cityIds = new Set(world.cities.map((city) => city.id));
  const owned = new Set<number>();
  for (const row of selectAll<{ city_id: number; actor_id: number }>(db, 'SELECT city_id, actor_id FROM ownership;')) {
    if (!cityIds.has(row.city_id)) throw new Error('Authority store ownership references a city absent from the World.');
    if (owned.has(row.city_id)) throw new Error('Authority store holds more than one owner for a city.');
    if (!actorIds.has(row.actor_id)) throw new Error('Authority store ownership references an actor that does not exist.');
    owned.add(row.city_id);
    if (!ownedByActor.has(row.actor_id)) ownedByActor.set(row.actor_id, new Set());
    ownedByActor.get(row.actor_id)!.add(row.city_id);
  }
  for (const cityId of cityIds) if (!owned.has(cityId)) throw new Error('Authority store is missing an owner for a canonical city.');

  const credentialActorIds = new Set<number>();
  const credentialHashes = new Set<string>();
  for (const row of selectAll<{ actor_id: number; credential_hash: string }>(db, 'SELECT actor_id, credential_hash FROM credentials;')) {
    if (!actorIds.has(row.actor_id)) throw new Error('Authority store has a credential for an actor that does not exist.');
    if (!HASH_PATTERN.test(row.credential_hash)) throw new Error('Authority store has a malformed credential hash.');
    if (credentialHashes.has(row.credential_hash)) throw new Error('Authority store has a duplicate credential hash.');
    credentialHashes.add(row.credential_hash);
    credentialActorIds.add(row.actor_id);
  }
  if (credentialActorIds.size !== actorIds.size) throw new Error('Authority store actors do not each have exactly one credential row.');

  for (const row of selectAll<{ code_hash: string; consumed_by: number | null; consumed_at: number | null }>(db, 'SELECT code_hash, consumed_by, consumed_at FROM invites;')) {
    if (!HASH_PATTERN.test(row.code_hash)) throw new Error('Authority store has a malformed invite hash.');
    if ((row.consumed_by === null) !== (row.consumed_at === null)) throw new Error('Authority store has an invite whose consumption fields disagree.');
    if (row.consumed_by !== null && !actorIds.has(row.consumed_by)) throw new Error('Authority store has an invite consumed by an actor that does not exist.');
  }

  const watermarkByActor = new Map<number, number>();
  const sequenceActorIds = new Set<number>();
  for (const row of selectAll<{ actor_id: number; high_watermark: number }>(db, 'SELECT actor_id, high_watermark FROM sequences;')) {
    if (!actorIds.has(row.actor_id)) throw new Error('Authority store has a sequence row for an actor that does not exist.');
    assertSafeNonNegativeInteger(row.high_watermark, 'sequence watermark');
    watermarkByActor.set(row.actor_id, row.high_watermark);
    sequenceActorIds.add(row.actor_id);
  }
  if (sequenceActorIds.size !== actorIds.size) throw new Error('Authority store actors do not each have exactly one sequence row.');

  const receiptSeqsByActor = new Map<number, number[]>([...actorIds].map((id) => [id, []]));
  const seenRequestIds = new Map<string, number>();
  for (const row of selectAll<{ actor_id: number; seq: number; request_id: string; fingerprint: string; outcome: string }>(
    db,
    'SELECT actor_id, seq, request_id, fingerprint, outcome FROM receipts;',
  )) {
    assertSafePositiveInteger(row.seq, 'receipt sequence');
    if (!REQUEST_ID_PATTERN.test(row.request_id)) throw new Error('Authority store has a malformed receipt request id.');
    if (!HASH_PATTERN.test(row.fingerprint)) throw new Error('Authority store has a malformed receipt fingerprint.');
    const watermark = watermarkByActor.get(row.actor_id);
    if (watermark === undefined || row.seq > watermark) throw new Error('Authority store has a receipt beyond its actor watermark.');
    const idKey = `${row.actor_id}:${row.request_id}`;
    const seenSeq = seenRequestIds.get(idKey);
    if (seenSeq !== undefined && seenSeq !== row.seq) throw new Error('Authority store has one request id bound to more than one sequence.');
    seenRequestIds.set(idKey, row.seq);
    let outcome: unknown;
    try {
      outcome = JSON.parse(row.outcome);
    } catch {
      throw new Error('Authority store has a malformed receipt outcome.');
    }
    if (!isValidStoredOutcome(outcome)) throw new Error('Authority store has a malformed or non-final receipt outcome.');
    if (outcome.ok && outcome.cityId === undefined) throw new Error('Authority store has a successful receipt missing its city.');
    if (outcome.cityId !== undefined && !cityIds.has(outcome.cityId)) throw new Error('Authority store has a receipt naming a city absent from the World.');
    if (outcome.ok && !ownedByActor.get(row.actor_id)?.has(outcome.cityId!)) {
      throw new Error('Authority store has a successful receipt naming a city its actor does not own.');
    }
    receiptSeqsByActor.get(row.actor_id)!.push(row.seq);
  }

  for (const [actorId, seqs] of receiptSeqsByActor) {
    const watermark = watermarkByActor.get(actorId)!;
    const expectedCount = Math.min(watermark, RETAINED_RECEIPTS);
    if (seqs.length !== expectedCount) throw new Error('Authority store does not retain exactly the expected receipt window for an actor.');
    const sorted = [...seqs].sort((a, b) => a - b);
    const floor = watermark - expectedCount + 1;
    for (let i = 0; i < sorted.length; i++) if (sorted[i] !== floor + i) throw new Error('Authority store retains a non-contiguous receipt window for an actor.');
  }
}

interface ResolvedOutcome {
  ok: boolean;
  reason: string;
  cityId?: number;
  world?: World;
  ownerCityId?: number;
}

function resolveOutcome(world: World, db: Database, actorId: number, request: AuthorityRequest): ResolvedOutcome {
  if (request.kind === 'claim') {
    const owned = selectOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM ownership WHERE actor_id = ?;', actorId)!.count;
    if (owned > 0) return { ok: false, reason: 'This actor already holds an island claim.' };
    const candidate = structuredClone(world);
    const result = claimIsland(candidate, request.home);
    if (!result.ok || !result.city) return { ok: false, reason: result.reason };
    return { ok: true, reason: result.reason, cityId: result.city.id, world: candidate, ownerCityId: result.city.id };
  }

  const owner = selectOne<{ actor_id: number }>(db, 'SELECT actor_id FROM ownership WHERE city_id = ?;', request.cityId);
  if (!owner) return { ok: false, reason: 'No such city.' };
  if (owner.actor_id !== actorId) return { ok: false, reason: 'Foreign city.', cityId: request.cityId };

  const candidate = structuredClone(world);
  const result = applyCommand(candidate, request.cityId, request.command);
  if (!result.ok) return { ok: false, reason: result.reason, cityId: request.cityId };
  return { ok: true, reason: result.reason, world: candidate, cityId: request.cityId };
}

export class Authority {
  private readonly store: AuthorityDb;
  readonly realmId: string;
  private world: World;
  private revision: number;
  private poisoned = false;

  private constructor(store: AuthorityDb, world: World, revision: number) {
    this.store = store;
    this.realmId = store.realmId;
    this.world = world;
    this.revision = revision;
  }

  static open(path: string): Authority {
    const store = openStore(path);
    try {
      const { revision, world } = readWorldRow(store.db);
      verifyStoredInvariants(store.db, world);
      return new Authority(store, world, revision);
    } catch (error) {
      closeStore(store);
      throw error;
    }
  }

  close(): void {
    closeStore(this.store);
  }

  snapshot(): World {
    return structuredClone(this.world);
  }

  private guardWritable(): void {
    if (this.poisoned) throw new Error('Authority store is in a terminal fault state; reopen the store to continue.');
  }

  private poison<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      this.poisoned = true;
      throw error;
    }
  }

  authenticate(credential: string): Session | null {
    return this.poison(() => {
      const db = this.store.db;
      const actor = selectOne<{ actor_id: number }>(db, 'SELECT actor_id FROM credentials WHERE credential_hash = ?;', hashToken(credential));
      if (!actor) return null;
      const watermark = selectOne<{ high_watermark: number }>(db, 'SELECT high_watermark FROM sequences WHERE actor_id = ?;', actor.actor_id)!.high_watermark;
      const ownedCityIds = selectAll<{ city_id: number }>(db, 'SELECT city_id FROM ownership WHERE actor_id = ?;', actor.actor_id).map((row) => row.city_id);
      const nextSeq = watermark < Number.MAX_SAFE_INTEGER ? watermark + 1 : null;
      const receiptWatermark = Math.max(0, watermark - RETAINED_RECEIPTS);
      return { actorId: actor.actor_id, nextSeq, ownedCityIds, receiptWatermark };
    });
  }

  issueInvite(): string {
    this.guardWritable();
    return this.poison(() => {
      const code = randomToken();
      this.store.db.run('INSERT INTO invites (code_hash, created_at) VALUES (?, ?);', [hashToken(code), Date.now()]);
      return code;
    });
  }

  admitInvite(inviteCode: string): { ok: true; actorId: number; credential: string } | { ok: false; reason: string } {
    this.guardWritable();
    return this.poison(() => {
      const db = this.store.db;
      const codeHash = hashToken(inviteCode);
      const invite = selectOne<{ consumed_by: number | null }>(db, 'SELECT consumed_by FROM invites WHERE code_hash = ?;', codeHash);
      if (!invite || invite.consumed_by !== null) return { ok: false, reason: 'Invalid or already-used invite.' };
      const actorCount = selectOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM actors;')!.count;
      if (actorCount >= ACTOR_CAP) return { ok: false, reason: 'No admission slots remain.' };

      const now = Date.now();
      const credential = randomToken();
      const admit = db.transaction(() => {
        const actorId = Number(db.run('INSERT INTO actors (created_at) VALUES (?);', [now]).lastInsertRowid);
        db.run('INSERT INTO credentials (actor_id, credential_hash, created_at) VALUES (?, ?, ?);', [actorId, hashToken(credential), now]);
        db.run('INSERT INTO sequences (actor_id, high_watermark) VALUES (?, 0);', [actorId]);
        const changes = db.run('UPDATE invites SET consumed_by = ?, consumed_at = ? WHERE code_hash = ? AND consumed_by IS NULL;', [actorId, now, codeHash]);
        if (changes.changes !== 1) throw new Error('Authority store invite state changed underneath this transaction.');
        return actorId;
      });
      const actorId = admit.exclusive();
      return { ok: true, actorId, credential };
    });
  }

  submit(credential: string, seq: number, requestId: string, request: AuthorityRequest): RequestOutcome {
    this.guardWritable();
    if (!Number.isSafeInteger(seq) || seq <= 0) return { ok: false, reason: 'Invalid sequence.', status: 'invalid-request' };
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return { ok: false, reason: 'Invalid request id.', status: 'invalid-request' };
    let normalized: AuthorityRequest;
    let fingerprint: string;
    try {
      const captured = normalizeRequestOnce(request);
      if (!captured) return { ok: false, reason: 'Unrecognized request shape.', status: 'invalid-request' };
      normalized = captured;
      fingerprint = fingerprintOf(normalized);
    } catch {
      return { ok: false, reason: 'Malformed request payload.', status: 'invalid-request' };
    }

    return this.poison(() => {
      const db = this.store.db;
      const actor = selectOne<{ actor_id: number }>(db, 'SELECT actor_id FROM credentials WHERE credential_hash = ?;', hashToken(credential));
      if (!actor) return { ok: false, reason: 'Unauthenticated.', status: 'unauthenticated' };

      const actorId = actor.actor_id;
      const watermark = selectOne<{ high_watermark: number }>(db, 'SELECT high_watermark FROM sequences WHERE actor_id = ?;', actorId)!.high_watermark;

      if (seq <= watermark) {
        const receipt = selectOne<{ request_id: string; fingerprint: string; outcome: string }>(
          db,
          'SELECT request_id, fingerprint, outcome FROM receipts WHERE actor_id = ? AND seq = ?;',
          actorId,
          seq,
        );
        if (!receipt) return { ok: false, reason: 'Sequence already processed; history not retained.', status: 'pruned' };
        if (receipt.request_id !== requestId || receipt.fingerprint !== fingerprint) return { ok: false, reason: 'Sequence already used with a different request.', status: 'conflict' };
        const stored = JSON.parse(receipt.outcome) as RequestOutcome;
        return { ok: stored.ok, reason: stored.reason, cityId: stored.cityId, status: 'replayed' };
      }
      if (watermark >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'Actor sequence exhausted.', status: 'exhausted' };
      if (seq > watermark + 1) return { ok: false, reason: `Sequence gap; expected ${watermark + 1}.`, status: 'gap' };

      const priorById = selectOne<{ seq: number }>(db, 'SELECT seq FROM receipts WHERE actor_id = ? AND request_id = ?;', actorId, requestId);
      if (priorById) return { ok: false, reason: 'Request id already used for a different sequence or payload.', status: 'conflict' };

      const outcome = resolveOutcome(this.world, db, actorId, normalized);
      const publicOutcome: RequestOutcome = { ok: outcome.ok, reason: outcome.reason, cityId: outcome.cityId, status: 'processed' };
      const persisting = outcome.ok && outcome.world;
      if (persisting && this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Authority store world revision is exhausted.');

      const commit = db.transaction(() => {
        const sequenceChanges = db.run('UPDATE sequences SET high_watermark = ? WHERE actor_id = ? AND high_watermark = ?;', [seq, actorId, watermark]);
        if (sequenceChanges.changes !== 1) throw new Error('Authority store sequence watermark changed underneath this transaction.');
        db.run('INSERT INTO receipts (actor_id, seq, request_id, fingerprint, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?);', [actorId, seq, requestId, fingerprint, JSON.stringify(publicOutcome), Date.now()]);
        db.run('DELETE FROM receipts WHERE actor_id = ? AND seq <= ?;', [actorId, seq - RETAINED_RECEIPTS]);
        if (persisting) {
          writeWorldRow(db, this.revision, outcome.world!);
          if (outcome.ownerCityId !== undefined) db.run('INSERT INTO ownership (city_id, actor_id, created_at) VALUES (?, ?, ?);', [outcome.ownerCityId, actorId, Date.now()]);
        }
      });
      commit.exclusive();

      if (persisting) {
        this.world = outcome.world!;
        this.revision += 1;
      }
      return publicOutcome;
    });
  }
}
