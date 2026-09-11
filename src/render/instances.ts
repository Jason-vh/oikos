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
  private readonly released: number[] = [];

  constructor(private readonly root: T.Object3D, private readonly geometry: T.BufferGeometry, private readonly material: T.Material) {
    this.mesh = this.create(this.capacity);
    this.root.add(this.mesh);
  }

  private create(capacity: number): T.InstancedMesh {
    const mesh = new T.InstancedMesh(this.geometry, this.material, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, HIDDEN);
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

  acquire(): number {
    const reused = this.released.pop();
    if (reused !== undefined) return reused;
    if (this.used === this.capacity) this.grow();
    return this.used++;
  }

  release(index: number): void {
    this.hide(index);
    this.released.push(index);
  }

  write(index: number, matrix: T.Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(index: number): void {
    this.write(index, HIDDEN);
  }
}

export class InstanceField {
  readonly root = new T.Group();
  private readonly batches = new Map<string, InstanceBatch>();

  get batchCount(): number {
    return this.batches.size;
  }

  reserve(geometry: T.BufferGeometry, material: T.Material): InstanceSlot {
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = new InstanceBatch(this.root, geometry, material);
      this.batches.set(key, batch);
    }
    return { batch, index: batch.acquire() };
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
  slot.batch.release(slot.index);
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
