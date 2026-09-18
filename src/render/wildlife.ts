import * as T from 'three';
import { animalModel, animateAnimal } from '../art';
import type { AnimalKind } from '../sim/types';
import { hide, InstanceField, instanceableMeshes, release, write, type InstanceSlot } from './instances';
import { glowMaterial } from './emphasis';

const KIND_SCALE: Record<AnimalKind, number> = { boar: 1.15, rabbit: 1.25, fish: 1.1, gull: .9 };

export interface AnimalPose {
  position: T.Vector3;
  facing: number;
  roll: number;
  phase: number;
  moving: boolean;
  stride: number;
  swell: number;
}

interface Species {
  model: T.Group;
  meshes: T.Mesh[];
}

interface Drawn {
  kind: AnimalKind;
  slots: InstanceSlot[];
}

export class WildlifeField {
  readonly root: T.Group;
  private readonly field = new InstanceField();
  private readonly species = new Map<AnimalKind, Species>();
  private readonly drawn = new Map<number, Drawn>();
  private emphasised: number | null = null;

  constructor(scene: T.Object3D) {
    this.root = this.field.root;
    this.root.name = 'wildlife';
    scene.add(this.root);
  }

  get batchCount(): number {
    return this.field.batchCount;
  }

  private speciesFor(kind: AnimalKind): Species {
    let species = this.species.get(kind);
    if (!species) {
      const model = animalModel(kind);
      species = { model, meshes: instanceableMeshes(model) };
      this.species.set(kind, species);
    }
    return species;
  }

  private reserve(kind: AnimalKind, lit: boolean): InstanceSlot[] {
    const species = this.speciesFor(kind);
    return species.meshes.map((mesh) => {
      const material = mesh.material as T.Material;
      return this.field.reserve(mesh.geometry, lit ? glowMaterial(material, 'hover') : material);
    });
  }

  add(id: number, kind: AnimalKind): void {
    this.drawn.set(id, { kind, slots: this.reserve(kind, id === this.emphasised) });
  }

  remove(id: number): void {
    const entry = this.drawn.get(id);
    if (!entry) return;
    for (const slot of entry.slots) release(slot);
    this.drawn.delete(id);
  }

  conceal(id: number): void {
    for (const slot of this.drawn.get(id)?.slots ?? []) hide(slot);
  }

  emphasise(id: number | null): void {
    if (id === this.emphasised) return;
    const previous = this.emphasised;
    this.emphasised = id;
    if (previous !== null) this.reseat(previous);
    if (id !== null) this.reseat(id);
  }

  private reseat(id: number): void {
    const entry = this.drawn.get(id);
    if (!entry) return;
    for (const slot of entry.slots) release(slot);
    entry.slots = this.reserve(entry.kind, id === this.emphasised);
  }

  pose(id: number, kind: AnimalKind, pose: AnimalPose): void {
    const entry = this.drawn.get(id);
    if (!entry) return;
    const species = this.speciesFor(kind);
    species.model.position.copy(pose.position);
    species.model.rotation.set(0, pose.facing, pose.roll);
    species.model.scale.setScalar(KIND_SCALE[kind] * pose.swell);
    animateAnimal(species.model, kind, pose.phase, pose.moving, pose.stride);
    species.model.updateWorldMatrix(false, true);
    species.meshes.forEach((mesh, index) => write(entry.slots[index], mesh.matrixWorld));
  }

  dispose(): void {
    this.field.dispose();
    this.drawn.clear();
    this.species.clear();
  }
}
