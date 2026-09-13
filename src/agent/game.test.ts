import { describe, expect, test } from 'bun:test';
import { LocalGame, MAX_CATCH_UP_SECONDS, type SaveSlot } from './game';
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

  test('runs the city by the clock, without the agent asking', async () => {
    let time = 1000;
    const game = LocalGame.start({ now: () => time });

    expect(game.view().world.time).toBe(0);
    time += 2000;
    expect(game.view().world.time).toBeGreaterThan(1.5);
    expect(game.view().world.time).toBeLessThan(2.5);
  });

  test('drops the time an idle agent was away, rather than fast-forwarding through it', async () => {
    let time = 1000;
    const game = LocalGame.start({ now: () => time });

    time += 60 * 60 * 1000;

    expect(game.view().world.time).toBeLessThanOrEqual(MAX_CATCH_UP_SECONDS);
  });

});
