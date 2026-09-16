import { describe, expect, test, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimHarbour } from '../sim/claims';
import { CITY_COLORS, cityColor } from '../sim/colors';
import { findHarbourSite } from '../sim/founding';
import { islandFor } from '../sim/island';
import { serializeWorld } from '../sim/save';
import { createSharedWorld } from '../sim/world';
import { Authority } from './authority';
import { STEPS } from './migrations';
import { EARLIEST_SCHEMA, SCHEMA_HISTORY } from './schema-history';
import { closeStore, openStore, readWorldRow, selectAll, selectOne, SCHEMA_VERSION, TABLE_SCHEMA } from './store';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function freshPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'authority-migration-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'world.db');
}

function colourlessWorldOfTwoCities(): string {
  const world = createSharedWorld();
  const founders = [0, 1].map((home) => {
    const site = findHarbourSite(islandFor(world.seed), home)!;
    const result = claimHarbour(world, `City ${home}`, CITY_COLORS[0], site.x, site.z, site.rotation);
    return result.city!;
  });
  expect(founders).toHaveLength(2);
  const saved = JSON.parse(serializeWorld(world)) as { version: number; cities: Array<Record<string, unknown>> };
  saved.version = 16;
  for (const city of saved.cities) delete city.color;
  return JSON.stringify(saved);
}

function hash(seed: number): string {
  return seed.toString(16).padStart(64, '0');
}

function storeOfSchema2(path: string): { cityIds: number[] } {
  const db = new Database(path, { create: true, readwrite: true });
  const data = colourlessWorldOfTwoCities();
  const cityIds = (JSON.parse(data) as { cities: Array<{ id: number }> }).cities.map((city) => city.id);
  try {
    db.run('PRAGMA journal_mode = WAL;');
    for (const sql of Object.values(SCHEMA_HISTORY[EARLIEST_SCHEMA])) db.run(`${sql};`);
    db.run('INSERT INTO meta (id, format_version, realm_id) VALUES (1, ?, ?);', [EARLIEST_SCHEMA, randomUUID()]);
    db.run('INSERT INTO world (id, revision, data) VALUES (1, 4, ?);', [data]);
    db.run('INSERT INTO actors (id, name, created_at) VALUES (1, ?, 1000), (2, ?, 2000);', ['Massalia', 'Kyrene']);
    db.run('INSERT INTO credentials (actor_id, credential_hash, created_at) VALUES (1, ?, 1000), (2, ?, 2000);', [hash(1), hash(2)]);
    db.run('INSERT INTO sequences (actor_id, high_watermark) VALUES (1, 0), (2, 0);');
    db.run('INSERT INTO ownership (city_id, actor_id, created_at) VALUES (?, 1, 1000), (?, 2, 2000);', cityIds);
  } finally {
    db.close(true);
  }
  return { cityIds };
}

describe('the schema ladder', () => {
  test('records the schema this authority declares', () => {
    expect(SCHEMA_HISTORY[SCHEMA_VERSION]).toEqual(TABLE_SCHEMA);
  });

  test('carries one step for every version since the earliest', () => {
    expect(STEPS.map((step) => step.to)).toEqual(Array.from({ length: SCHEMA_VERSION - EARLIEST_SCHEMA }, (_, index) => EARLIEST_SCHEMA + index + 1));
    expect(Object.keys(SCHEMA_HISTORY).map(Number)).toEqual(Array.from({ length: SCHEMA_VERSION - EARLIEST_SCHEMA + 1 }, (_, index) => EARLIEST_SCHEMA + index));
  });
});

describe('opening a store older than this authority', () => {
  test('raises it to the current schema and keeps the world', () => {
    const path = freshPath();
    const { cityIds } = storeOfSchema2(path);
    const store = openStore(path);
    try {
      for (const [table, expected] of Object.entries(TABLE_SCHEMA)) {
        expect(selectOne<{ sql: string }>(store.db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?;", table)!.sql).toBe(expected);
      }
      expect(selectOne<{ format_version: number }>(store.db, 'SELECT format_version FROM meta WHERE id = 1;')!.format_version).toBe(SCHEMA_VERSION);
      const { revision, world } = readWorldRow(store.db);
      expect(revision).toBe(4);
      expect(world.cities.map((city) => city.id)).toEqual(cityIds);
      expect(selectAll<{ actor_id: number }>(store.db, 'SELECT actor_id FROM credentials ORDER BY actor_id;').map((row) => row.actor_id)).toEqual([1, 2]);
    } finally {
      closeStore(store);
    }
  });

  test('gives every actor the colour the city it owns already flies', () => {
    const path = freshPath();
    const { cityIds } = storeOfSchema2(path);
    const store = openStore(path);
    try {
      const { world } = readWorldRow(store.db);
      const actors = selectAll<{ id: number; color: string }>(store.db, 'SELECT id, color FROM actors ORDER BY id;');
      expect(actors.every((actor) => cityColor(actor.color) !== null)).toBe(true);
      for (const [index, actor] of actors.entries()) {
        expect(actor.color).toBe(world.cities.find((city) => city.id === cityIds[index])!.color);
      }
    } finally {
      closeStore(store);
    }
  });

  test('gives an actor without a city a colour no other actor holds', () => {
    const path = freshPath();
    storeOfSchema2(path);
    const opening = new Database(path, { create: false, readwrite: true });
    opening.run('DELETE FROM ownership WHERE actor_id = 2;');
    opening.close(true);
    const store = openStore(path);
    try {
      const colors = selectAll<{ color: string }>(store.db, 'SELECT color FROM actors;').map((row) => row.color);
      expect(new Set(colors).size).toBe(2);
      expect(colors.every((color) => cityColor(color) !== null)).toBe(true);
    } finally {
      closeStore(store);
    }
  });

  test('leaves a store the authority can keep playing', () => {
    const path = freshPath();
    storeOfSchema2(path);
    const authority = Authority.open(path);
    try {
      expect(authority.snapshot().cities).toHaveLength(2);
      expect(authority.authenticate(hash(1))).toBeNull();
    } finally {
      authority.close();
    }
  });

  test('is refused when no step reaches it', () => {
    const path = freshPath();
    storeOfSchema2(path);
    const older = new Database(path, { create: false, readwrite: true });
    older.run('UPDATE meta SET format_version = 1 WHERE id = 1;');
    older.close(true);
    expect(() => openStore(path)).toThrow(/predates every migration/);
  });

  test('is refused when the store is newer than this authority', () => {
    const path = freshPath();
    storeOfSchema2(path);
    const newer = new Database(path, { create: false, readwrite: true });
    newer.run('UPDATE meta SET format_version = ? WHERE id = 1;', [SCHEMA_VERSION + 1]);
    newer.close(true);
    expect(() => openStore(path)).toThrow(/newer authority/);
  });
});
