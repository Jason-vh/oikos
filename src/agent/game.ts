import { primaryCity } from '../sim/city';
import { applyCommand, type CityCommand } from '../sim/commands';
import { deserializeWorld, serializeWorld } from '../sim/save';
import type { ActionResult, City, World } from '../sim/types';
import { advance, createWorld } from '../sim/world';

export interface AgentView { world: World; city: City }

export interface AgentGame {
  view(): AgentView;
  submit(command: CityCommand): Promise<ActionResult>;
  pass(seconds: number): Promise<ActionResult>;
}

export interface SaveSlot {
  read(): string | null;
  write(saved: string): void;
}

export interface LocalGameOptions {
  seed?: number;
  home?: number;
  founded?: boolean;
  slot?: SaveSlot;
}

export const MAX_PASS_SECONDS = 600;

export class LocalGame implements AgentGame {
  private constructor(private world_: World, private readonly slot: SaveSlot | null) {}

  static start(options: LocalGameOptions = {}): LocalGame {
    const saved = options.slot?.read() ?? null;
    if (saved !== null) {
      const world = deserializeWorld(saved);
      if (!world) throw new Error('The saved city could not be read.');
      return new LocalGame(world, options.slot ?? null);
    }
    const world = createWorld(options.seed, options.home, options.founded ?? true);
    const game = new LocalGame(world, options.slot ?? null);
    game.persist();
    return game;
  }

  view(): AgentView {
    return { world: this.world_, city: primaryCity(this.world_) };
  }

  async submit(command: CityCommand): Promise<ActionResult> {
    const result = applyCommand(this.world_, primaryCity(this.world_).id, command);
    if (result.ok) this.persist();
    return result;
  }

  async pass(seconds: number): Promise<ActionResult> {
    if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: 'Ask for a positive number of seconds.' };
    if (!primaryCity(this.world_).founded) return { ok: false, reason: 'Time does not pass until the city is founded.' };
    const passing = Math.min(seconds, MAX_PASS_SECONDS);
    advance(this.world_, passing);
    this.persist();
    const capped = passing < seconds ? ` Only ${MAX_PASS_SECONDS} seconds pass at a time.` : '';
    return { ok: true, reason: `${Math.round(passing)} seconds pass.${capped}` };
  }

  private persist(): void {
    this.slot?.write(serializeWorld(this.world_));
  }
}
