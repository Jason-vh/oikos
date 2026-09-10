import { describe, expect, test } from 'bun:test';
import { createWorld } from '../sim/world';
import { deserializeWorld } from '../sim/save';
import { AUTOSAVE_KEY, CHECKPOINT_KEY, islandFilename, readCheckpoint, writeAutosave, writeCheckpoint, type SaveStorage } from './save-slots';

function memoryStorage(): SaveStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('island save slots', () => {
  test('autosaving a new island preserves the manual checkpoint', () => {
    const storage = memoryStorage();
    const original = createWorld(1);
    writeCheckpoint(storage, original);
    writeAutosave(storage, createWorld(2));
    expect(readCheckpoint(storage)).toEqual(original);
    expect(deserializeWorld(storage.getItem(AUTOSAVE_KEY)!)).toEqual(createWorld(2));
  });

  test('uses the existing autosave key so existing islands still resume', () => {
    expect(AUTOSAVE_KEY).toBe('oikos.island.v1');
  });

  test('missing or corrupt checkpoints are never substituted with an autosave', () => {
    const storage = memoryStorage();
    writeAutosave(storage, createWorld());
    expect(readCheckpoint(storage)).toBeNull();
    storage.setItem(CHECKPOINT_KEY, '{"version":999}');
    expect(readCheckpoint(storage)).toBeNull();
  });

  test('failed checkpoint writes preserve the previous checkpoint', () => {
    const storage = memoryStorage();
    const original = createWorld();
    writeCheckpoint(storage, original);
    const unavailable = { ...storage, setItem: () => { throw new Error('Storage full'); } };
    expect(() => writeCheckpoint(unavailable, createWorld(2))).toThrow('Storage full');
    expect(readCheckpoint(storage)).toEqual(original);
  });

  test('export filenames identify the island and simulated time', () => {
    const world = createWorld(2);
    world.time = 91.25;
    expect(islandFilename(world)).toBe('oikos-2-91.json');
  });
});
