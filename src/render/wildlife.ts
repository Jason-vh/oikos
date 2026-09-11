import * as T from 'three';
import { animalModel, animateAnimal } from '../art';
import type { AnimalKind } from '../sim/types';
import { hide, InstanceField, instanceableMeshes, release, write, type InstanceSlot } from './instances';

const KIND_SCALE: Record<AnimalKind, number> = { boar: 1.15, rabbit: 1.25, fish: 1.1, gull: .9 };

export interface AnimalPose {
  position: T.Vector3;
  facing: number;
  roll: number;
  phase: number;
  moving: boolean;
}

interface Species {
  model: T.Group;
  meshes: T.Mesh[];
}

export class WildlifeField {
  readonly root: T.Group;
  private readonly field = new InstanceField();
  private readonly species = new Map<AnimalKind, Species>();
  private readonly slots = new Map<number, InstanceSlot[]>();

  constructor(scene: T.Object3D) {
    this.root = this.field.root;
    scene.add(this.root);
  }

  get batchCount(): number {
    return this.field.batchCount;
  }

  private speciesFor(kind: AnimalKind): Species {
    let species = this.species.get(kind);
    if (!species) {
      const model = animalModel(kind);
      model.scale.setScalar(KIND_SCALE[kind]);
      species = { model, meshes: instanceableMeshes(model) };
      this.species.set(kind, species);
    }
    return species;
  }

  add(id: number, kind: AnimalKind): void {
    const species = this.speciesFor(kind);
    this.slots.set(id, species.meshes.map((mesh) => this.field.reserve(mesh.geometry, mesh.material as T.Material)));
  }

  remove(id: number): void {
    const slots = this.slots.get(id);
    if (!slots) return;
    for (const slot of slots) release(slot);
    this.slots.delete(id);
  }

  conceal(id: number): void {
    for (const slot of this.slots.get(id) ?? []) hide(slot);
  }

  pose(id: number, kind: AnimalKind, pose: AnimalPose): void {
    const slots = this.slots.get(id);
    if (!slots) return;
    const species = this.speciesFor(kind);
    species.model.position.copy(pose.position);
    species.model.rotation.set(0, pose.facing, pose.roll);
    animateAnimal(species.model, kind, pose.phase, pose.moving);
    species.model.updateWorldMatrix(false, true);
    species.meshes.forEach((mesh, index) => write(slots[index], mesh.matrixWorld));
  }

  dispose(): void {
    this.field.dispose();
    this.slots.clear();
    this.species.clear();
  }
}
