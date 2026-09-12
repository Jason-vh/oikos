import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeStore, initStore, openStore, readWorldRow, selectOne, writeWorldRow } from './store';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function freshPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'authority-store-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'world.db');
}

describe('initStore', () => {
  test('creates a store with a seeded, empty shared World', () => {
    const path = freshPath();
    initStore(path);
    const store = openStore(path);
    const { revision, world } = readWorldRow(store.db);
    expect(revision).toBe(0);
    expect(world.cities).toEqual([]);
    closeStore(store);
  });

  test('refuses to initialise over an existing target', () => {
    const path = freshPath();
    initStore(path);
    expect(() => initStore(path)).toThrow();
  });
});

describe('openStore', () => {
  test('refuses a missing path', () => {
    expect(() => openStore(freshPath())).toThrow();
  });

  test('refuses an empty file', () => {
    const path = freshPath();
    writeFileSync(path, '');
    expect(() => openStore(path)).toThrow();
  });

  test('refuses a file that is not a valid database', () => {
    const path = freshPath();
    writeFileSync(path, 'not a database');
    expect(() => openStore(path)).toThrow();
  });

  test('refuses a database with an incompatible schema version', () => {
    const path = freshPath();
    initStore(path);
    const store = openStore(path);
    store.db.run('UPDATE meta SET format_version = 999 WHERE id = 1;');
    closeStore(store);
    expect(() => openStore(path)).toThrow();
  });
});

describe('writeWorldRow', () => {
  test('advances the revision and fails closed when the expected revision is stale', () => {
    const path = freshPath();
    initStore(path);
    const store = openStore(path);
    const { world, revision } = readWorldRow(store.db);
    writeWorldRow(store.db, revision, world);
    expect(readWorldRow(store.db).revision).toBe(revision + 1);
    expect(() => writeWorldRow(store.db, revision, world)).toThrow();
    closeStore(store);
  });
});

describe('statement lifetime', () => {
  test('closing and reopening still works after far more than 128 distinct prepared queries', () => {
    const path = freshPath();
    initStore(path);
    const store = openStore(path);
    for (let i = 0; i < 200; i++) {
      const row = selectOne<{ v: number }>(store.db, `SELECT ${i} as v /* distinct-${i} */;`);
      expect(row!.v).toBe(i);
    }
    closeStore(store);

    const reopened = openStore(path);
    expect(readWorldRow(reopened.db).revision).toBe(0);
    closeStore(reopened);
  });
});

describe('cross-process exclusion', () => {
  test('a second process is refused across several real commits, and a killed holder releases the lock, its committed data intact', async () => {
    const path = freshPath();
    initStore(path);

    const holderCode = `
      const { openStore, writeWorldRow, readWorldRow } = await import(${JSON.stringify(new URL('./store.ts', import.meta.url).href)});
      const store = openStore(${JSON.stringify(path)});
      for (let i = 0; i < 3; i++) {
        const { world, revision } = readWorldRow(store.db);
        writeWorldRow(store.db, revision, world);
      }
      console.log('holder-ready');
      await new Promise(() => {});
    `;
    const holder = Bun.spawn(['bun', '-e', holderCode], { stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = holder.stdout.getReader();
      let buffered = '';
      while (!buffered.includes('holder-ready')) {
        const { value, done } = await reader.read();
        if (done) throw new Error('holder exited before signalling readiness');
        buffered += Buffer.from(value).toString();
      }

      expect(() => openStore(path)).toThrow();

      holder.kill('SIGKILL');
      await holder.exited;

      const store = openStore(path);
      expect(readWorldRow(store.db).revision).toBe(3);
      closeStore(store);
    } finally {
      holder.kill('SIGKILL');
      await holder.exited;
    }
  });
});
