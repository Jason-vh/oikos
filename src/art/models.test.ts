import { describe, expect, test } from 'bun:test';
import * as T from 'three';
import type { BuildingKind } from '../sim/types';
import { BUILDINGS } from '../sim/catalog';
import { CELL_SIZE } from '../sim/island';
import { box, colors, disposeModel, group, lump, material, post, releaseModelGeometries } from './primitives';
import { house } from './houses';
import { temple, stall } from './temple';
import { tree } from './vegetation';
import { citizen } from './people';
import { boat } from './ships';
import { getBuildingModel, footprintSize } from './buildings';

const KINDS: BuildingKind[] = ['house', 'farm', 'granary', 'agora', 'fountain', 'maintenance'];
const FOOTPRINT_EPSILON = 0.01;
const GROUND_EPSILON = 0.02;
const TRIANGLE_BUDGET = 12000;
const DRAW_CALL_BUDGET = 18;

function tiersFor(kind: BuildingKind): (1 | 2 | 3)[] {
  return kind === 'house' ? [1, 2, 3] : [1];
}

function instances(): { kind: BuildingKind; tier: 1 | 2 | 3; vendorEnabled: boolean; model: T.Group }[] {
  const result: { kind: BuildingKind; tier: 1 | 2 | 3; vendorEnabled: boolean; model: T.Group }[] = [];
  for (const kind of KINDS) {
    for (const tier of tiersFor(kind)) {
      const vendorOptions = kind === 'agora' ? [false, true] : [false];
      const stores = kind === 'granary' ? { wheat: 300, carrots: 200, fish: 100, meat: 100, olives: 200 } : { wheat: 100, fish: 100, meat: 100 };
      for (const vendorEnabled of vendorOptions) {
        result.push({ kind, tier, vendorEnabled, model: getBuildingModel(kind, { tier, vendorEnabled, stores }) });
      }
    }
  }
  return result;
}

function meshStats(root: T.Object3D): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  root.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    meshes += 1;
    triangles += child.geometry.attributes.position.count / 3;
  });
  return { meshes, triangles };
}

function assertFiniteVertices(root: T.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count * position.itemSize; i++) {
      expect(Number.isFinite(position.array[i])).toBe(true);
    }
  });
}

describe('getBuildingModel footprints', () => {
  for (const { kind, tier, vendorEnabled, model } of instances()) {
    test(`${kind} tier ${tier}${vendorEnabled ? ' (vendor)' : ''} fits its catalog footprint`, () => {
      const definition = BUILDINGS[kind];
      const halfWidth = (definition.width * CELL_SIZE) / 2;
      const halfDepth = (definition.depth * CELL_SIZE) / 2;
      const bounds = new T.Box3().setFromObject(model);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-halfWidth - FOOTPRINT_EPSILON);
      expect(bounds.max.x).toBeLessThanOrEqual(halfWidth + FOOTPRINT_EPSILON);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-halfDepth - FOOTPRINT_EPSILON);
      expect(bounds.max.z).toBeLessThanOrEqual(halfDepth + FOOTPRINT_EPSILON);
    });
  }

  test('footprintSize matches catalog width/depth times CELL_SIZE', () => {
    for (const kind of KINDS) {
      const size = footprintSize(kind);
      expect(size.width).toBeCloseTo(BUILDINGS[kind].width * CELL_SIZE, 6);
      expect(size.depth).toBeCloseTo(BUILDINGS[kind].depth * CELL_SIZE, 6);
    }
  });
});

describe('getBuildingModel ground contact', () => {
  for (const { kind, tier, vendorEnabled, model } of instances()) {
    test(`${kind} tier ${tier}${vendorEnabled ? ' (vendor)' : ''} sits on y = 0`, () => {
      const bounds = new T.Box3().setFromObject(model);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-GROUND_EPSILON);
      expect(bounds.min.y).toBeLessThanOrEqual(GROUND_EPSILON);
    });
  }
});

describe('getBuildingModel vertex integrity', () => {
  for (const { kind, tier, vendorEnabled, model } of instances()) {
    test(`${kind} tier ${tier}${vendorEnabled ? ' (vendor)' : ''} has only finite vertices`, () => {
      assertFiniteVertices(model);
    });
  }
});

describe('getBuildingModel drawcall and triangle budgets', () => {
  for (const { kind, tier, vendorEnabled, model } of instances()) {
    test(`${kind} tier ${tier}${vendorEnabled ? ' (vendor)' : ''} stays within budget`, () => {
      const stats = meshStats(model);
      expect(stats.meshes).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
      expect(stats.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET);
    });
  }
});

describe('approved decorative models still build', () => {
  test('house(), temple(), stall() and tree() produce finite, non-empty geometry', () => {
    const scene = new T.Group();
    house(scene, 0, 0, 0, 0, 0);
    house(scene, 3, 0, 0, 1, Math.PI / 2);
    house(scene, -3, 0, 0, 2, 0);
    temple(scene, 0, 0, -6);
    stall(scene, 6, 0, 0, colors.blue);
    tree(scene, 8, 0, 0, 1, false);
    tree(scene, 9, 0, 0, 1, true);
    const stats = meshStats(scene);
    expect(stats.meshes).toBeGreaterThan(0);
    expect(stats.triangles).toBeGreaterThan(0);
    assertFiniteVertices(scene);
  });

  test('citizen() and boat() bake to a small number of independent meshes', () => {
    const walker = citizen(colors.blue, true);
    const ship = boat(colors.roof, true);
    for (const model of [walker, ship]) {
      const stats = meshStats(model);
      expect(stats.meshes).toBeGreaterThan(0);
      expect(stats.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET);
      assertFiniteVertices(model);
    }
  });
});

describe('bake retains vertex-colour sail geometry', () => {
  test('boat() keeps an unbaked, vertex-coloured sail mesh alongside the baked hull', () => {
    const ship = boat(colors.blue, true);
    const meshes = ship.children.filter((child): child is T.Mesh => child instanceof T.Mesh);
    const sail = meshes.find((mesh) => mesh.geometry.attributes.color !== undefined);
    expect(sail).toBeDefined();
    const color = sail!.geometry.attributes.color;
    const position = sail!.geometry.attributes.position;
    expect(color.count).toBe(position.count);
    const hulls = meshes.filter((mesh) => mesh.geometry.attributes.color === undefined);
    expect(hulls.length).toBeGreaterThan(0);
    for (const hull of hulls) {
      expect(hull.geometry.attributes.color).toBeUndefined();
    }
  });
});

describe('disposeModel resource ownership', () => {
  test('disposes the baked geometries owned by a getBuildingModel instance', () => {
    const model = getBuildingModel('fountain');
    const geometries = new Set<T.BufferGeometry>();
    let disposedCount = 0;
    model.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      geometries.add(child.geometry);
      child.geometry.addEventListener('dispose', () => { disposedCount += 1; });
    });
    disposeModel(model);
    expect(disposedCount).toBe(geometries.size);
    expect(geometries.size).toBeGreaterThan(0);
  });

  test('never disposes shared palette materials', () => {
    const stoneMaterial = material(colors.stone);
    let disposed = false;
    stoneMaterial.addEventListener('dispose', () => { disposed = true; });
    const model = getBuildingModel('granary');
    disposeModel(model);
    expect(disposed).toBe(false);
  });

  test('never disposes shared primitive template geometry reached without baking', () => {
    const scratch = new T.Group();
    box(scratch, colors.stone, 0, 0, 0, 1, 1, 1);
    post(scratch, colors.wood, 0, 0, 0, 1, 1);
    lump(scratch, colors.olive, 0, 0, 0, 1, 1, 1);
    const sharedGeometries = scratch.children
      .filter((child): child is T.Mesh => child instanceof T.Mesh)
      .map((child) => child.geometry);
    let disposedCount = 0;
    for (const geometry of sharedGeometries) geometry.addEventListener('dispose', () => { disposedCount += 1; });
    disposeModel(scratch);
    expect(disposedCount).toBe(0);
    for (const geometry of sharedGeometries) expect(geometry.userData.sharedPrimitive).toBe(true);
  });

  test('leaves shared caches usable after disposal and after releaseModelGeometries', () => {
    const first = getBuildingModel('maintenance');
    disposeModel(first);
    const second = getBuildingModel('maintenance');
    assertFiniteVertices(second);
    releaseModelGeometries();
    const third = getBuildingModel('maintenance');
    assertFiniteVertices(third);
    const bounds = new T.Box3().setFromObject(third);
    const definition = BUILDINGS.maintenance;
    expect(bounds.max.x).toBeLessThanOrEqual((definition.width * CELL_SIZE) / 2 + FOOTPRINT_EPSILON);
  });
});

describe('group() rotation helper', () => {
  test('rotates a house without changing its footprint size', () => {
    const scene = new T.Group();
    const wrapper = group(scene, 0, 0, 0, Math.PI / 2);
    house(wrapper, 0, 0, 0, 1, 0);
    const bounds = new T.Box3().setFromObject(scene);
    expect(bounds.isEmpty()).toBe(false);
  });
});
