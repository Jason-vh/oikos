import { describe, expect, test } from 'bun:test';
import { LocalGame, MAX_PASS_SECONDS, type SaveSlot } from './game';
import { primaryCity } from '../sim/city';
import { spotFor } from '../sim/testing';

function memorySlot(initial: string | null = null): SaveSlot & { saved: string | null } {
  return {
    saved: initial,
    read() { return this.saved; },
    write(saved: string) { this.saved = saved; },
  };
}

describe('the local game', () => {
  test('writes every accepted command to its slot and reads it back', async () => {
    const slot = memorySlot();
    const game = LocalGame.start({ slot });
    const spot = spotFor(game.view().world, 'granary')!;

    await game.submit({ type: 'build', tool: 'granary', x: spot.x, z: spot.z, rotation: 0 });
    const resumed = LocalGame.start({ slot });

    expect(slot.saved).toBeString();
    expect(primaryCity(resumed.view().world).buildings).toHaveLength(1);
    expect(resumed.view().city!.money).toBe(game.view().city!.money);
  });

  test('refuses to open a corrupt slot rather than starting a new city over it', () => {
    expect(() => LocalGame.start({ slot: memorySlot('{"version":"broken"}') })).toThrow('The saved city could not be read.');
  });

  test('caps how much time one call may pass', async () => {
    const game = LocalGame.start();

    const result = await game.pass(MAX_PASS_SECONDS * 4);

    expect(result.ok).toBe(true);
    expect(result.reason).toContain(`Only ${MAX_PASS_SECONDS} seconds`);
    expect(game.view().world.time).toBeLessThanOrEqual(MAX_PASS_SECONDS);
  });

  test('says why time does not pass before the city is founded', async () => {
    const game = LocalGame.start({ home: 3, founded: false });

    expect((await game.pass(60)).reason).toContain('until the city is founded');
    expect((await game.pass(-5)).reason).toContain('positive number');
  });
});
