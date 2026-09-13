import { primaryCity } from '../sim/city';
import { applyCommand, type CityCommand } from '../sim/commands';
import { deserializeWorld, serializeWorld } from '../sim/save';
import type { ActionResult, City, World } from '../sim/types';
import { advance, createWorld } from '../sim/world';

export interface AgentView { world: World; city: City | null }

export interface AgentGame {
  view(): AgentView;
  submit(command: CityCommand): Promise<ActionResult>;
  claim(home: number): Promise<ActionResult>;
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
  now?: () => number;
}

export const MAX_CATCH_UP_SECONDS = 5;

export class LocalGame implements AgentGame {
  private lastSettled: number;

  private constructor(private world_: World, private readonly slot: SaveSlot | null, private readonly now: () => number) {
    this.lastSettled = now();
  }

  static start(options: LocalGameOptions = {}): LocalGame {
    const now = options.now ?? Date.now;
    const saved = options.slot?.read() ?? null;
    if (saved !== null) {
      const world = deserializeWorld(saved);
      if (!world) throw new Error('The saved city could not be read.');
      return new LocalGame(world, options.slot ?? null, now);
    }
    const world = createWorld(options.seed, options.home, options.founded ?? true);
    const game = new LocalGame(world, options.slot ?? null, now);
    game.persist();
    return game;
  }

  view(): AgentView {
    this.settle();
    return { world: this.world_, city: primaryCity(this.world_) };
  }

  async submit(command: CityCommand): Promise<ActionResult> {
    this.settle();
    const result = applyCommand(this.world_, primaryCity(this.world_).id, command);
    if (result.ok) this.persist();
    return result;
  }

  async claim(): Promise<ActionResult> {
    return { ok: false, reason: 'This city is already yours. Claiming islands belongs to the shared archipelago.' };
  }

  private settle(): void {
    const now = this.now();
    const elapsed = (now - this.lastSettled) / 1000;
    this.lastSettled = now;
    if (elapsed <= 0) return;
    advance(this.world_, Math.min(elapsed, MAX_CATCH_UP_SECONDS));
    this.persist();
  }

  private persist(): void {
    this.slot?.write(serializeWorld(this.world_));
  }
}
