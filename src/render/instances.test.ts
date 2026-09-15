import { expect, test } from 'bun:test';
import * as T from 'three';
import { InstanceField, release, write, type InstanceSlot } from './instances';

function batchOf(field: InstanceField): T.InstancedMesh {
  return field.root.children[0] as T.InstancedMesh;
}

function placed(slot: InstanceSlot, x: number): void {
  write(slot, new T.Matrix4().makeTranslation(x, 0, 0));
}

function xAt(mesh: T.InstancedMesh, index: number): number {
  const matrix = new T.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.elements[12];
}

function field(): { field: InstanceField; reserve: () => InstanceSlot } {
  const instances = new InstanceField();
  const geometry = new T.BoxGeometry(1, 1, 1);
  const material = new T.MeshBasicMaterial();
  return { field: instances, reserve: () => instances.reserve(geometry, material) };
}

test('a batch draws only the instances it is holding', () => {
  const { field: instances, reserve } = field();
  expect(instances.batchCount).toBe(0);
  const slots = [reserve(), reserve(), reserve()];
  expect(batchOf(instances).count).toBe(3);
  release(slots[2]);
  expect(batchOf(instances).count).toBe(2);
  release(slots[0]);
  release(slots[1]);
  expect(batchOf(instances).count).toBe(0);
});

test('releasing from the middle moves the last holder into the gap, not the other way about', () => {
  const { field: instances, reserve } = field();
  const first = reserve();
  const middle = reserve();
  const last = reserve();
  placed(first, 1);
  placed(middle, 2);
  placed(last, 3);
  release(middle);
  const mesh = batchOf(instances);
  expect(mesh.count).toBe(2);
  expect(last.index).toBe(1);
  expect(xAt(mesh, last.index)).toBe(3);
  expect(xAt(mesh, first.index)).toBe(1);
  placed(last, 9);
  expect(xAt(mesh, 1)).toBe(9);
});

test('a slot released and taken again draws where it is put, not where it was', () => {
  const { field: instances, reserve } = field();
  const first = reserve();
  placed(first, 5);
  release(first);
  const second = reserve();
  const mesh = batchOf(instances);
  expect(mesh.count).toBe(1);
  expect(xAt(mesh, second.index)).toBe(0);
  placed(second, 7);
  expect(xAt(mesh, second.index)).toBe(7);
});

test('a batch that has grown still draws only what it holds', () => {
  const { field: instances, reserve } = field();
  const slots = Array.from({ length: 70 }, () => reserve());
  expect(batchOf(instances).count).toBe(70);
  for (const slot of slots.slice(0, 60)) release(slot);
  expect(batchOf(instances).count).toBe(10);
});
