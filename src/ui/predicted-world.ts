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
  private pending: LocalCommand | null = null;
  private view: World;

  constructor(private authoritative: World) {
    this.view = authoritative;
  }

  get world(): World {
    return this.view;
  }

  get predicting(): boolean {
    return this.pending !== null;
  }

  sync(world: World): void {
    this.authoritative = world;
    this.rebuild();
  }

  predict(cityId: number, command: CityCommand): boolean {
    this.pending = { cityId, command };
    if (this.rebuild()) return true;
    this.discard();
    return false;
  }

  discard(): void {
    this.pending = null;
    this.rebuild();
  }

  private rebuild(): boolean {
    if (!this.pending) {
      this.view = this.authoritative;
      return true;
    }
    const world = copyBesideWildlife(this.authoritative);
    const applied = applyCommand(world, this.pending.cityId, this.pending.command).ok;
    this.view = world;
    return applied;
  }
}
