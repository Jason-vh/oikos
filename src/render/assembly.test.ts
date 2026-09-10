import { expect, test } from 'bun:test';
import * as T from 'three';
import { getBuildingAssembly, getBuildingModel, disposeModel } from '../art';
import { BuildingConstruction, assemblyDuration, poseAssembly } from './assembly';
import { DustField } from './dust';

function fixture() {
  const finished = getBuildingModel('house');
  const assembly = getBuildingAssembly('house')!;
  const scene = new T.Scene();
  const dust = new DustField(scene);
  const construction = new BuildingConstruction(finished, assembly, { width: 2.5, depth: 2.5, dust });
  scene.add(construction.model);
  return { finished, assembly, construction, dust };
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

test('scaffolding stands over the work and is struck once the building is up', () => {
  const { assembly, construction } = fixture();
  const scaffold = () => construction.model.children.find((child) => child !== assembly.model && child.name === '')!;
  const raised = assemblyDuration(assembly);
  expect(construction.duration).toBeGreaterThan(raised);
  construction.seek(.5);
  expect(scaffold().scale.y).toBe(1);
  construction.seek(raised + (construction.duration - raised) / 2);
  expect(scaffold().scale.y).toBeCloseTo(.5, 2);
  construction.advance(10);
  construction.settle();
  expect(construction.model.children.map((child) => child.type)).toEqual(['Group']);
  disposeModel(construction.model);
});

test('a laid-out kind has no scaffolding to raise', () => {
  const finished = getBuildingModel('farm', { stage: 0 });
  const assembly = getBuildingAssembly('farm', { stage: 0 })!;
  const construction = new BuildingConstruction(finished, assembly, { width: 5, depth: 5, dust: new DustField(new T.Scene()) });
  expect(assembly.scaffolded).toBe(false);
  expect(construction.duration).toBe(assemblyDuration(assembly));
  expect(construction.model.children).toEqual([finished, assembly.model]);
  disposeModel(construction.model);
});

test('each landing raises one puff, and only going forwards', () => {
  const { construction, assembly, dust } = fixture();
  const dusty = assembly.parts.filter((part) => part.dust).length;
  expect(dusty).toBeGreaterThan(0);
  construction.advance(10);
  expect(dust.count).toBe(dusty);
  construction.seek(0);
  construction.advance(10);
  expect(dust.count).toBe(dusty);
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
  expect(construction.elapsed).toBe(construction.duration);
  construction.settle();
  expect(construction.model.children).toEqual([finished]);
  expect(finished.visible).toBe(true);
  expect(disposed).toBe(owned);
  construction.settle();
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
