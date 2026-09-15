import * as T from 'three';

const HIDDEN = new T.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const INITIAL_CAPACITY = 32;

export interface InstanceSlot {
  batch: InstanceBatch;
  index: number;
}



class InstanceBatch {
  mesh: T.InstancedMesh;
  private capacity = INITIAL_CAPACITY;
  private used = 0;
  private readonly holders: Array<InstanceSlot | null> = [];
  private readonly moved = new T.Matrix4();

  constructor(private readonly root: T.Object3D, private readonly geometry: T.BufferGeometry, private readonly material: T.Material, private readonly confinement: T.Sphere | null) {
    this.mesh = this.create(this.capacity);
    this.root.add(this.mesh);
  }

  private create(capacity: number): T.InstancedMesh {
    const mesh = new T.InstancedMesh(this.geometry, this.material, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = this.confinement !== null;
    if (this.confinement) mesh.boundingSphere = this.confinement;
    for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, HIDDEN);
    mesh.count = this.used;
    return mesh;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const replacement = this.create(capacity);
    replacement.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
    replacement.instanceMatrix.needsUpdate = true;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh = replacement;
    this.capacity = capacity;
    this.root.add(replacement);
  }

  acquire(slot: InstanceSlot): number {
    if (this.used === this.capacity) this.grow();
    const index = this.used++;
    this.holders[index] = slot;
    this.mesh.count = this.used;
    this.hide(index);
    return index;
  }

  release(slot: InstanceSlot): void {
    const last = this.used - 1;
    if (slot.index !== last) {
      const tenant = this.holders[last];
      this.mesh.getMatrixAt(last, this.moved);
      this.write(slot.index, this.moved);
      this.holders[slot.index] = tenant;
      if (tenant) tenant.index = slot.index;
    }
    this.holders[last] = null;
    this.used = last;
    this.mesh.count = this.used;
  }

  write(index: number, matrix: T.Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.addUpdateRange(index * 16, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(index: number): void {
    this.write(index, HIDDEN);
  }
}

export class InstanceField {
  readonly root = new T.Group();
  private readonly batches = new Map<string, InstanceBatch>();
  private confinement: T.Sphere | null = null;

  confine(centre: T.Vector3, radius: number): void {
    this.confinement = new T.Sphere(centre.clone(), radius);
  }

  get batchCount(): number {
    return this.batches.size;
  }

  reserve(geometry: T.BufferGeometry, material: T.Material): InstanceSlot {
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new InstanceBatch(this.root, geometry, material, this.confinement);
      this.batches.set(key, batch);
    }
    const slot: InstanceSlot = { batch, index: 0 };
    slot.index = batch.acquire(slot);
    return slot;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const batch of this.batches.values()) batch.mesh.dispose();
    this.batches.clear();
    this.root.clear();
  }
}

export function write(slot: InstanceSlot, matrix: T.Matrix4): void {
  slot.batch.write(slot.index, matrix);
}

export function hide(slot: InstanceSlot): void {
  slot.batch.hide(slot.index);
}

export function release(slot: InstanceSlot): void {
  slot.batch.release(slot);
}

export function instanceableMeshes(source: T.Object3D): T.Mesh[] {
  const meshes: T.Mesh[] = [];
  source.traverse((child) => {
    if (child instanceof T.Mesh && !Array.isArray(child.material)) meshes.push(child);
  });
  return meshes;
}

export interface LocalPiece {
  geometry: T.BufferGeometry;
  material: T.Material;
  local: T.Matrix4;
}

export function piecesAround(source: T.Object3D, pivot: T.Matrix4): LocalPiece[] {
  source.updateWorldMatrix(true, true);
  const inverse = pivot.clone().invert();
  return instanceableMeshes(source).map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material as T.Material,
    local: new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
  }));
}
