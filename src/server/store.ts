import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { World } from '../sim/types';
import { createSharedWorld } from '../sim/world';
import { deserializeSharedWorld, serializeWorld } from '../sim/save';

export const SCHEMA_VERSION = 1;

const REALM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLE_SCHEMA: Record<string, string> = {
  meta: 'CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), format_version INTEGER NOT NULL, realm_id TEXT NOT NULL) STRICT',
  world: 'CREATE TABLE world (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0), data TEXT NOT NULL) STRICT',
  actors: 'CREATE TABLE actors (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL) STRICT',
  credentials: 'CREATE TABLE credentials (actor_id INTEGER PRIMARY KEY REFERENCES actors(id), credential_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT',
  invites: 'CREATE TABLE invites (code_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, consumed_by INTEGER REFERENCES actors(id), consumed_at INTEGER) STRICT',
  ownership: 'CREATE TABLE ownership (city_id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES actors(id), created_at INTEGER NOT NULL) STRICT',
  sequences: 'CREATE TABLE sequences (actor_id INTEGER PRIMARY KEY REFERENCES actors(id), high_watermark INTEGER NOT NULL CHECK (high_watermark >= 0)) STRICT',
  receipts:
    'CREATE TABLE receipts (actor_id INTEGER NOT NULL REFERENCES actors(id), seq INTEGER NOT NULL CHECK (seq > 0), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (actor_id, seq)) STRICT',
};

export interface AuthorityDb {
  db: Database;
  path: string;
  realmId: string;
}

export function selectOne<T>(db: Database, sql: string, ...params: SQLQueryBindings[]): T | null {
  const statement = db.prepare<T, SQLQueryBindings[]>(sql);
  try {
    return statement.get(...params);
  } finally {
    statement.finalize();
  }
}

export function selectAll<T>(db: Database, sql: string, ...params: SQLQueryBindings[]): T[] {
  const statement = db.prepare<T, SQLQueryBindings[]>(sql);
  try {
    return statement.all(...params);
  } finally {
    statement.finalize();
  }
}

function applyPragmas(db: Database): void {
  db.run('PRAGMA journal_mode = DELETE;');
  db.run('PRAGMA locking_mode = EXCLUSIVE;');
  db.run('PRAGMA busy_timeout = 0;');
  db.run('PRAGMA foreign_keys = ON;');
}

function acquireExclusiveFileLock(db: Database, path: string): void {
  try {
    db.run('BEGIN EXCLUSIVE;');
    db.run('COMMIT;');
  } catch (error) {
    throw new Error(`Authority store at ${path} is already open by another process: ${(error as Error).message}`);
  }
}

export function initStore(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let reservation: number;
  try {
    reservation = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Authority store already exists at ${path}.`);
    throw error;
  }
  closeSync(reservation);
  const db = new Database(path, { create: false, readwrite: true });
  try {
    applyPragmas(db);
    acquireExclusiveFileLock(db, path);
    for (const sql of Object.values(TABLE_SCHEMA)) db.run(`${sql};`);
    const world = createSharedWorld();
    const transaction = db.transaction(() => {
      db.run('INSERT INTO meta (id, format_version, realm_id) VALUES (1, ?, ?)', [SCHEMA_VERSION, randomUUID()]);
      db.run('INSERT INTO world (id, revision, data) VALUES (1, 0, ?)', [serializeWorld(world)]);
    });
    transaction.exclusive();
  } finally {
    db.close(true);
  }
}

function checkReferentialIntegrity(db: Database): void {
  if (selectAll<unknown>(db, 'PRAGMA foreign_key_check;').length > 0) throw new Error('Authority store has invalid foreign key references.');
}

function checkSchemaShape(db: Database, path: string): void {
  for (const [table, expectedSql] of Object.entries(TABLE_SCHEMA)) {
    const row = selectOne<{ sql: string }>(db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;", table);
    if (!row) throw new Error(`Authority store at ${path} is missing its ${table} table.`);
    if (row.sql !== expectedSql) throw new Error(`Authority store at ${path} has an unexpected schema for its ${table} table.`);
  }
}

export function openStore(path: string): AuthorityDb {
  if (!existsSync(path)) throw new Error(`No authority store at ${path}.`);
  if (statSync(path).size === 0) throw new Error(`Authority store at ${path} is empty.`);
  const db = new Database(path, { create: false, readwrite: true });
  try {
    applyPragmas(db);
    acquireExclusiveFileLock(db, path);
    checkSchemaShape(db, path);
    const meta = selectOne<{ format_version: number; realm_id: string }>(db, 'SELECT format_version, realm_id FROM meta WHERE id = 1;');
    if (!meta || meta.format_version !== SCHEMA_VERSION) throw new Error(`Authority store at ${path} is corrupt or incompatible.`);
    if (!REALM_ID_PATTERN.test(meta.realm_id)) throw new Error(`Authority store at ${path} has a malformed realm id.`);
    checkReferentialIntegrity(db);
    return { db, path, realmId: meta.realm_id };
  } catch (error) {
    db.close(true);
    throw error;
  }
}

export function closeStore(store: AuthorityDb): void {
  store.db.close(true);
}

export function readWorldRow(db: Database): { revision: number; world: World } {
  const row = selectOne<{ revision: number; data: string }>(db, 'SELECT revision, data FROM world WHERE id = 1;');
  if (!row) throw new Error('Authority store has no world row.');
  if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Authority store world revision is invalid.');
  const world = deserializeSharedWorld(row.data);
  if (!world) throw new Error('Authority store world data is corrupt or incompatible.');
  return { revision: row.revision, world };
}

export function writeWorldRow(db: Database, expectedRevision: number, world: World): void {
  const changes = db.run('UPDATE world SET revision = revision + 1, data = ? WHERE id = 1 AND revision = ?;', [serializeWorld(world), expectedRevision]);
  if (changes.changes !== 1) throw new Error('Authority store world revision changed underneath this transaction.');
}
