import * as T from 'three';
import { disposeModel, scaffolding, type AssemblyPart, type ModelAssembly } from '../art';
import type { DustField } from './dust';

const SCAFFOLD_RAISE = .26;
const SCAFFOLD_STRIKE = .34;
const SCAFFOLD_INSET = .14;
const SCAFFOLD_GAP = .55;

export interface ConstructionSite {
  width: number;
  depth: number;
  dust: DustField;
}

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

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function restingPoint(part: T.Group): T.Vector3 {
  const bounds = new T.Box3();
  for (const child of part.children) {
    if (!(child instanceof T.Mesh)) continue;
    child.geometry.computeBoundingBox();
    bounds.union(child.geometry.boundingBox!);
  }
  const centre = bounds.getCenter(new T.Vector3());
  return new T.Vector3(centre.x, bounds.min.y, centre.z);
}

export class BuildingConstruction {
  readonly model = new T.Group();
  readonly duration: number;
  elapsed = 0;
  private readonly raised: number;
  private readonly scaffold: T.Group | null;
  private readonly landed = new Set<AssemblyPart>();
  private complete = false;

  constructor(private readonly finished: T.Group, private readonly assembly: ModelAssembly, private readonly site: ConstructionSite) {
    this.raised = assemblyDuration(assembly);
    this.scaffold = assembly.scaffolded ? this.raiseScaffold() : null;
    this.duration = this.raised + (this.scaffold ? SCAFFOLD_STRIKE : 0);
    this.model.add(finished, assembly.model);
    this.seek(0);
  }

  seek(elapsed: number): void {
    if (this.complete) return;
    this.elapsed = T.MathUtils.clamp(elapsed, 0, this.duration);
    poseAssembly(this.assembly, this.elapsed);
    const standing = this.elapsed >= this.raised;
    this.finished.visible = standing;
    this.assembly.model.visible = !standing;
    if (this.scaffold) this.poseScaffold();
  }

  advance(delta: number): boolean {
    if (this.complete) return true;
    const previous = this.elapsed;
    this.seek(this.elapsed + delta);
    if (delta > 0) this.raiseDust(previous);
    return this.elapsed >= this.duration;
  }

  settle(): void {
    if (this.complete) return;
    this.complete = true;
    this.assembly.model.removeFromParent();
    disposeModel(this.assembly.model);
    this.scaffold?.removeFromParent();
    if (this.scaffold) disposeModel(this.scaffold);
    this.finished.visible = true;
  }

  private raiseScaffold(): T.Group {
    const size = new T.Box3().setFromObject(this.finished).getSize(new T.Vector3());
    const width = Math.min(this.site.width - SCAFFOLD_INSET, size.x + SCAFFOLD_GAP);
    const depth = Math.min(this.site.depth - SCAFFOLD_INSET, size.z + SCAFFOLD_GAP);
    const frame = scaffolding(width, depth, Math.max(.6, size.y));
    this.model.add(frame);
    return frame;
  }

  private poseScaffold(): void {
    const raise = easeOutCubic(Math.min(1, this.elapsed / SCAFFOLD_RAISE));
    const strike = T.MathUtils.clamp((this.elapsed - this.raised) / SCAFFOLD_STRIKE, 0, 1);
    this.scaffold!.scale.y = Math.max(.001, raise * (1 - strike));
    this.scaffold!.visible = this.scaffold!.scale.y > .002;
  }

  private raiseDust(previous: number): void {
    this.model.updateWorldMatrix(true, false);
    for (const part of this.assembly.parts) {
      if (!part.dust || this.landed.has(part)) continue;
      const settles = part.delay + part.duration;
      if (settles > this.elapsed || settles <= previous) continue;
      this.landed.add(part);
      const point = restingPoint(part.model).applyMatrix4(this.model.matrixWorld);
      this.site.dust.puff(point, this.site.width * .4, this.site.depth * .4, .45);
    }
  }
}
