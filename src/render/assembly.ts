import * as T from 'three';
import { disposeModel, type ModelAssembly } from '../art';

export function assemblyDuration(assembly: ModelAssembly): number {
  return Math.max(...assembly.parts.map((part) => part.delay + part.duration));
}

export function poseAssembly(assembly: ModelAssembly, elapsed: number): void {
  for (const part of assembly.parts) {
    const progress = T.MathUtils.clamp((elapsed - part.delay) / part.duration, 0, 1);
    part.model.visible = elapsed >= part.delay;
    part.model.position.y = part.lift * (1 - progress) ** 3;
  }
}

export class BuildingConstruction {
  readonly model = new T.Group();
  readonly duration: number;
  elapsed = 0;
  private complete = false;

  constructor(private readonly finished: T.Group, private readonly assembly: ModelAssembly) {
    this.duration = assemblyDuration(assembly);
    finished.visible = false;
    this.model.add(finished, assembly.model);
    poseAssembly(assembly, 0);
  }

  advance(delta: number): boolean {
    if (this.complete) return true;
    this.elapsed = Math.min(this.duration, this.elapsed + delta);
    poseAssembly(this.assembly, this.elapsed);
    if (this.elapsed < this.duration) return false;
    this.assembly.model.removeFromParent();
    disposeModel(this.assembly.model);
    this.finished.visible = true;
    this.complete = true;
    return true;
  }
}
