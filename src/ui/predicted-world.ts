import { applyCommand, type CityCommand } from '../sim/commands';
import type { Animal, World } from '../sim/types';

interface LocalCommand {
  cityId: number;
  command: CityCommand;
}

function copyBesideWildlife(world: World): World {
  const copy: World = structuredClone({ ...world, wildlife: [] as Animal[] });
  copy.wildlife = world.wildlife;
  return copy;
}

export class PredictedWorld {
  private pending: LocalCommand[] = [];
  private view: World;

  constructor(private authoritative: World) {
    this.view = authoritative;
  }

  get world(): World {
    return this.view;
  }

  get predicting(): boolean {
    return this.pending.length > 0;
  }

  sync(world: World): void {
    this.authoritative = world;
    this.rebuild();
  }

  predict(cityId: number, command: CityCommand): void {
    this.pending.push({ cityId, command });
    this.rebuild();
  }

  settled(): void {
    this.pending.shift();
    this.rebuild();
  }

  discard(): void {
    this.pending = [];
    this.rebuild();
  }

  private rebuild(): void {
    if (this.pending.length === 0) {
      this.view = this.authoritative;
      return;
    }
    const world = copyBesideWildlife(this.authoritative);
    for (const entry of this.pending) applyCommand(world, entry.cityId, entry.command);
    this.view = world;
  }
}
