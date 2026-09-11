import { expect, test } from 'bun:test';
import * as T from 'three';
import { animalModel } from '../art';
import { WildlifeField } from './wildlife';
import type { AnimalKind } from '../sim/types';

const KINDS: AnimalKind[] = ['boar', 'rabbit', 'fish', 'gull'];

function batches(field: WildlifeField): T.InstancedMesh[] {
  const found: T.InstancedMesh[] = [];
  field.root.traverse((child) => { if ((child as T.InstancedMesh).isInstancedMesh) found.push(child as T.InstancedMesh); });
  return found;
}

function matrixAt(mesh: T.InstancedMesh, index: number): T.Matrix4 {
  const matrix = new T.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

test('a herd draws as one batch per part, not per animal', () => {
  const scene = new T.Scene();
  const field = new WildlifeField(scene);
  try {
    for (let id = 1; id <= 80; id++) field.add(id, 'boar');
    expect(batches(field).length).toBeLessThanOrEqual(8);
  } finally {
    field.dispose();
  }
});

test('posing an animal places every part of its model', () => {
  const scene = new T.Scene();
  const field = new WildlifeField(scene);
  try {
    field.add(7, 'boar');
    field.pose(7, 'boar', { position: new T.Vector3(4, 1, -2), facing: .5, roll: 0, phase: 3, moving: true });
    const placed = batches(field).flatMap((mesh) => {
      const matrices: T.Matrix4[] = [];
      for (let index = 0; index < mesh.count; index++) {
        const matrix = matrixAt(mesh, index);
        if (matrix.elements.some((value) => value !== 0)) matrices.push(matrix);
      }
      return matrices;
    });
    const parts = animalModel('boar');
    let meshes = 0;
    parts.traverse((child) => { if ((child as T.Mesh).isMesh) meshes++; });
    expect(placed).toHaveLength(meshes);
    const origin = new T.Vector3();
    for (const matrix of placed) expect(origin.setFromMatrixPosition(matrix).distanceTo(new T.Vector3(4, 1, -2))).toBeLessThan(2);
  } finally {
    field.dispose();
  }
});

test('concealed and removed animals leave nothing drawn', () => {
  const scene = new T.Scene();
  const field = new WildlifeField(scene);
  try {
    for (const [index, kind] of KINDS.entries()) {
      field.add(index + 1, kind);
      field.pose(index + 1, kind, { position: new T.Vector3(index, 0, 0), facing: 0, roll: 0, phase: 1, moving: false });
    }
    field.conceal(1);
    field.remove(2);
    const drawn = batches(field).flatMap((mesh) => {
      const matrices: T.Matrix4[] = [];
      for (let index = 0; index < mesh.count; index++) matrices.push(matrixAt(mesh, index));
      return matrices;
    }).filter((matrix) => matrix.elements.some((value) => value !== 0));
    const remaining = KINDS.slice(2).map((kind) => animalModel(kind)).reduce((sum, model) => {
      let meshes = 0;
      model.traverse((child) => { if ((child as T.Mesh).isMesh) meshes++; });
      return sum + meshes;
    }, 0);
    expect(drawn).toHaveLength(remaining);
  } finally {
    field.dispose();
  }
});

test('a removed animal hands its instance slots to the next one', () => {
  const scene = new T.Scene();
  const field = new WildlifeField(scene);
  try {
    for (let id = 1; id <= 40; id++) field.add(id, 'rabbit');
    const before = batches(field).map((mesh) => mesh.count);
    for (let id = 1; id <= 40; id++) field.remove(id);
    for (let id = 41; id <= 80; id++) field.add(id, 'rabbit');
    expect(batches(field).map((mesh) => mesh.count)).toEqual(before);
  } finally {
    field.dispose();
  }
});
