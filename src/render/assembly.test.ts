import { expect, test } from 'bun:test';
import * as T from 'three';
import { getBuildingAssembly, getBuildingModel, disposeModel } from '../art';
import { BuildingConstruction, assemblyDuration, poseAssembly } from './assembly';

function fixture() {
  const finished = getBuildingModel('house');
  const assembly = getBuildingAssembly('house')!;
  const construction = new BuildingConstruction(finished, assembly);
  return { finished, assembly, construction };
}

test('foundation confirms placement immediately; walls, roof and finishes follow in order', () => {
  const { finished, assembly, construction } = fixture();
  expect(finished.visible).toBe(false);
  expect(assembly.parts.filter((part) => part.model.visible).map((part) => part.model.name)).toEqual(['foundation']);
  expect(assembly.parts[0].model.position.y).toBe(0);
  construction.advance(.4);
  expect(assembly.parts.filter((part) => part.model.visible).map((part) => part.model.name)).toEqual(['foundation', 'back-wall', 'left-wall', 'right-wall']);
  expect(assembly.parts[1].model.position.y).toBe(0);
  construction.advance(.5);
  expect(assembly.model.getObjectByName('roof')!.visible).toBe(true);
  expect(assembly.model.getObjectByName('pot')!.visible).toBe(false);
  expect(construction.model.scale.toArray()).toEqual([1, 1, 1]);
  disposeModel(construction.model);
});

test('completion swaps to the baked model and releases temporary geometry exactly once', () => {
  const { finished, assembly, construction } = fixture();
  let owned = 0;
  let disposed = 0;
  assembly.model.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    owned++;
    child.geometry.addEventListener('dispose', () => { disposed++; });
  });
  expect(construction.advance(10)).toBe(true);
  expect(construction.elapsed).toBe(assemblyDuration(assembly));
  expect(construction.model.children).toEqual([finished]);
  expect(finished.visible).toBe(true);
  expect(disposed).toBe(owned);
  expect(construction.advance(10)).toBe(true);
  disposeModel(construction.model);
  expect(disposed).toBe(owned);
});

test('scrubbing is reversible and independent of frame partitioning', () => {
  const first = fixture();
  const second = fixture();
  first.construction.advance(.8);
  for (let frame = 0; frame < 8; frame++) second.construction.advance(.1);
  for (let index = 0; index < first.assembly.parts.length; index++) {
    expect(first.assembly.parts[index].model.position.y).toBeCloseTo(second.assembly.parts[index].model.position.y, 8);
    expect(first.assembly.parts[index].model.visible).toBe(second.assembly.parts[index].model.visible);
  }
  poseAssembly(first.assembly, assemblyDuration(first.assembly));
  poseAssembly(first.assembly, 0);
  expect(first.assembly.parts.filter((part) => part.model.visible)).toHaveLength(1);
  disposeModel(first.construction.model);
  disposeModel(second.construction.model);
});

test('interrupting construction disposes both temporary and finished models', () => {
  const { construction } = fixture();
  let owned = 0;
  let disposed = 0;
  construction.model.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    owned++;
    child.geometry.addEventListener('dispose', () => { disposed++; });
  });
  construction.advance(.5);
  disposeModel(construction.model);
  expect(disposed).toBe(owned);
});
