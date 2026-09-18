import { describe, expect, test } from 'bun:test';
import * as T from 'three';
import type { AnimalKind, BuildingKind } from '../sim/types';
import { generateIsland, tileIndexOn } from '../sim/island';
import { reachOutline } from '../render/reach';
import { buildRoads } from './roads';
import { bush } from './bushes';
import { cliffOutcrop } from './cliffs';
import { animalModel } from './animals';
import { axe, citizen, figure, spear } from './people';
import { boat } from './ships';
import { stump, tree } from './vegetation';
import { getBuildingModel } from './buildings';

const KINDS: BuildingKind[] = ['house', 'farm', 'granary', 'agora', 'fountain', 'maintenance', 'lodge', 'woodcutter', 'stockpile', 'harbour'];
const ANIMALS: AnimalKind[] = ['boar', 'rabbit', 'fish', 'gull'];

function walker(tool: T.Group): T.Group {
  const model = figure(0x8a5a3a, 'none').root;
  model.add(tool);
  return model;
}

function subjects(): Array<{ name: string; model: T.Object3D }> {
  const scene = new T.Group();
  tree(scene, 0, 0, 0, 1, false);
  tree(scene, 3, 0, 0, 1, true);
  stump(scene, 6, 0, 0, 1, .4, 'logged');
  const map = generateIsland(1);
  return [
    ...KINDS.map((kind) => ({ name: kind, model: getBuildingModel(kind, { tier: 1, stage: 3, stores: { wheat: 100, lumber: 100 } }) })),
    ...ANIMALS.map((kind) => ({ name: kind, model: animalModel(kind) })),
    { name: 'vegetation', model: scene },
    { name: 'citizen', model: citizen(0xb2c7bb, true) },
    { name: 'woodcutter', model: walker(axe()) },
    { name: 'hunter', model: walker(spear()) },
    { name: 'boat', model: boat(0x426f83, true) },
    { name: 'bush', model: bush('paired') },
    { name: 'outcrop', model: cliffOutcrop() },
    { name: 'roads', model: buildRoads(map, [tileIndexOn(map, 40, 40), tileIndexOn(map, 41, 40)]) },
  ];
}

describe('every drawn thing is lit and shaded the same way', () => {
  for (const { name, model } of subjects()) {
    test(`${name} carries normals on every mesh`, () => {
      let meshes = 0;
      model.traverse((child) => {
        if (!(child instanceof T.Mesh)) return;
        meshes++;
        const position = child.geometry.getAttribute('position');
        const normal = child.geometry.getAttribute('normal');
        expect(position).toBeDefined();
        expect(normal).toBeDefined();
        expect(normal.count).toBe(position.count);
        for (let index = 0; index < normal.count; index++) {
          expect(Number.isFinite(normal.getX(index) + normal.getY(index) + normal.getZ(index))).toBe(true);
        }
      });
      expect(meshes).toBeGreaterThan(0);
    });
  }
});

test('a ground overlay is double sided, because its quads do not agree on a facing', () => {
  const map = generateIsland(1);
  const tiles = [tileIndexOn(map, 40, 40), tileIndexOn(map, 41, 40), tileIndexOn(map, 40, 41)];
  const outline = reachOutline(map, tiles)!;
  expect(outline.material).toBeDefined();
  expect((outline.material as T.Material).side).toBe(T.DoubleSide);
  expect(outline.geometry.getAttribute('normal').count).toBe(outline.geometry.getAttribute('position').count);
});
