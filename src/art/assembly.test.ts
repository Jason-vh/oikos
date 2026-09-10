import { expect, test } from 'bun:test';
import * as T from 'three';
import { getBuildingAssembly, getBuildingModel } from './buildings';
import { bake, box, colors, disposeModel, material } from './primitives';
import { poseAssembly, assemblyDuration } from '../render/assembly';
import { CELL_SIZE } from '../sim/island';
import { footprint } from '../sim/catalog';

function vertices(root: T.Group): string[] {
  root.updateMatrixWorld(true);
  const result: string[] = [];
  root.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    const color = (child.material as T.MeshStandardMaterial).color.getHexString();
    const positions = child.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      const point = new T.Vector3().fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      result.push(`${color}:${point.toArray().map((value) => value.toFixed(5)).join(':')}`);
    }
  });
  return result.sort();
}

test('assembled dwelling matches the baked model exactly', () => {
  const assembly = getBuildingAssembly('house')!;
  const finished = getBuildingModel('house');
  poseAssembly(assembly, assemblyDuration(assembly));
  expect(vertices(assembly.model)).toEqual(vertices(finished));
  expect(assembly.parts.map((part) => part.model.name)).toEqual([
    'foundation', 'back-wall', 'left-wall', 'right-wall', 'front-wall', 'cornice', 'roof', 'door', 'shutters', 'pot',
  ]);
  let meshes = 0;
  assembly.model.traverse((child) => { if (child instanceof T.Mesh) meshes++; });
  expect(meshes).toBeLessThanOrEqual(18);
  disposeModel(assembly.model);
  disposeModel(finished);
});

test('every assembly pose stays inside every rotated footprint and above ground', () => {
  const assembly = getBuildingAssembly('house')!;
  for (const rotation of [0, 1, 2, 3] as const) {
    assembly.model.rotation.y = -rotation * Math.PI / 2;
    const { width, depth } = footprint('house', rotation);
    for (let step = 0; step <= 30; step++) {
      poseAssembly(assembly, assemblyDuration(assembly) * step / 30);
      const bounds = new T.Box3().setFromObject(assembly.model);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.02);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-width * CELL_SIZE / 2 - .01);
      expect(bounds.max.x).toBeLessThanOrEqual(width * CELL_SIZE / 2 + .01);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-depth * CELL_SIZE / 2 - .01);
      expect(bounds.max.z).toBeLessThanOrEqual(depth * CELL_SIZE / 2 + .01);
    }
  }
  disposeModel(assembly.model);
});

test('only the dwelling prototype has an assembly', () => {
  expect(getBuildingAssembly('house', { tier: 2 })).toBeNull();
  expect(getBuildingAssembly('house', { tier: 3 })).toBeNull();
  expect(getBuildingAssembly('fountain')).toBeNull();
});

test('rebaking releases owned geometry without disposing shared primitives or palette', () => {
  const model = new T.Group();
  const primitive = box(model, colors.stone, 0, 0, 0, 1, 1, 1);
  let primitiveDisposed = false;
  let materialDisposed = false;
  primitive.geometry.addEventListener('dispose', () => { primitiveDisposed = true; });
  const onMaterialDisposed = () => { materialDisposed = true; };
  material(colors.stone).addEventListener('dispose', onMaterialDisposed);
  bake(model);
  const owned = (model.children[0] as T.Mesh).geometry;
  let ownedDisposed = false;
  owned.addEventListener('dispose', () => { ownedDisposed = true; });
  bake(model);
  expect(ownedDisposed).toBe(true);
  expect(primitiveDisposed).toBe(false);
  expect(materialDisposed).toBe(false);
  material(colors.stone).removeEventListener('dispose', onMaterialDisposed);
  disposeModel(model);
});
