import { expect, test } from 'bun:test';
import * as T from 'three';
import { CloudLayer } from './clouds';

const FIELD = 600;
const ABOVE_ANY_TERRAIN = 25;

function instanceOrigins(mesh: T.InstancedMesh): T.Vector3[] {
  const points: T.Vector3[] = [];
  const pose = new T.Matrix4();
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, pose);
    points.push(new T.Vector3().setFromMatrixPosition(pose));
  }
  return points;
}

function positions(layer: CloudLayer): T.Vector3[] {
  const meshes = layer.root.children.slice(0, -1) as T.InstancedMesh[];
  return meshes.flatMap(instanceOrigins);
}

function shadows(layer: CloudLayer): T.Vector3[] {
  return instanceOrigins(layer.root.children[layer.root.children.length - 1] as T.InstancedMesh);
}

test('clouds stay hidden at city zoom and appear when the view widens', () => {
  const layer = new CloudLayer(new T.Scene(), FIELD, 1);
  const material = (layer.root.children[0] as T.InstancedMesh).material as T.MeshStandardMaterial;
  expect(layer.fade(44)).toBe(false);
  expect(layer.root.visible).toBe(false);
  expect(layer.fade(250)).toBe(false);
  expect(layer.root.visible).toBe(false);
  expect(layer.fade(450)).toBe(true);
  expect(layer.root.visible).toBe(true);
  expect(material.opacity).toBeGreaterThan(0);
  expect(layer.fade(1300)).toBe(true);
  expect(material.opacity).toBeGreaterThan(.9);
  expect(layer.fade(44)).toBe(true);
  expect(layer.root.visible).toBe(false);
  layer.dispose();
});

test('clouds drift without leaving the field and are the same at the same time', () => {
  const layer = new CloudLayer(new T.Scene(), FIELD, 7);
  const start = positions(layer);
  expect(start.length).toBeGreaterThan(0);
  for (const point of start) {
    expect(Math.abs(point.x)).toBeLessThanOrEqual(FIELD / 2);
    expect(Math.abs(point.z)).toBeLessThanOrEqual(FIELD / 2);
    expect(point.y).toBeGreaterThan(ABOVE_ANY_TERRAIN);
  }
  layer.drift(4000);
  const later = positions(layer);
  for (const point of later) {
    expect(Math.abs(point.x)).toBeLessThanOrEqual(FIELD / 2);
    expect(Math.abs(point.z)).toBeLessThanOrEqual(FIELD / 2);
  }
  expect(later.some((point, index) => point.distanceTo(start[index]) > 1)).toBe(true);
  for (const patch of shadows(layer)) expect(patch.y).toBeLessThan(1);
  layer.drift(0);
  expect(positions(layer).map((point) => point.toArray())).toEqual(start.map((point) => point.toArray()));
  layer.dispose();
});

test('the same seed lays out the same sky', () => {
  const first = new CloudLayer(new T.Scene(), FIELD, 3);
  const second = new CloudLayer(new T.Scene(), FIELD, 3);
  const other = new CloudLayer(new T.Scene(), FIELD, 4);
  expect(positions(second).map((point) => point.toArray())).toEqual(positions(first).map((point) => point.toArray()));
  expect(positions(other).map((point) => point.toArray())).not.toEqual(positions(first).map((point) => point.toArray()));
  first.dispose();
  second.dispose();
  other.dispose();
});
