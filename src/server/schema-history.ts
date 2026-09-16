const SCHEMA_2: Record<string, string> = {
  meta: 'CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), format_version INTEGER NOT NULL, realm_id TEXT NOT NULL) STRICT',
  world: 'CREATE TABLE world (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0), data TEXT NOT NULL) STRICT',
  actors: 'CREATE TABLE actors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT',
  credentials: 'CREATE TABLE credentials (actor_id INTEGER PRIMARY KEY REFERENCES actors(id), credential_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT',
  ownership: 'CREATE TABLE ownership (city_id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES actors(id), created_at INTEGER NOT NULL) STRICT',
  sequences: 'CREATE TABLE sequences (actor_id INTEGER PRIMARY KEY REFERENCES actors(id), high_watermark INTEGER NOT NULL CHECK (high_watermark >= 0)) STRICT',
  receipts:
    'CREATE TABLE receipts (actor_id INTEGER NOT NULL REFERENCES actors(id), seq INTEGER NOT NULL CHECK (seq > 0), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (actor_id, seq)) STRICT',
};

const SCHEMA_3: Record<string, string> = {
  ...SCHEMA_2,
  actors: 'CREATE TABLE actors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT',
};

export const SCHEMA_HISTORY: Record<number, Record<string, string>> = {
  2: SCHEMA_2,
  3: SCHEMA_3,
};

export const EARLIEST_SCHEMA = 2;
