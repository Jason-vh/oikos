import { expect, test } from 'bun:test';
import * as T from 'three';
import { generateIsland, type IslandMap } from '../sim/island';
import { CoastalFoam } from './foam';
import { colors, material } from './primitives';

function positions(foam: CoastalFoam): number[] {
  return Array.from(foam.mesh.geometry.attributes.position.array);
}

function area(foam: CoastalFoam): number {
  const geometry = foam.mesh.geometry;
  const position = geometry.attributes.position;
  const indices = geometry.index!;
  let sum = 0;
  for (let index = 0; index < indices.count; index += 3) {
    const a = new T.Vector3().fromBufferAttribute(position, indices.getX(index));
    const b = new T.Vector3().fromBufferAttribute(position, indices.getX(index + 1));
    const c = new T.Vector3().fromBufferAttribute(position, indices.getX(index + 2));
    const normal = b.sub(a).cross(c.sub(a));
    expect(normal.y).toBeGreaterThanOrEqual(-1e-8);
    sum += normal.length() / 2;
  }
  return sum;
}

test('foam has a seeded still pose, changes over time, and repeats its wave cycle', () => {
  const map = generateIsland(1);
  const before = structuredClone(map);
  const foam = new CoastalFoam(map);
  const repeated = new CoastalFoam(map);
  const varied = new CoastalFoam({ ...map, seed: 2 });
  try {
    const still = positions(foam);
    expect(still).toEqual(positions(repeated));
    expect(still).not.toEqual(positions(varied));
    expect(area(foam)).toBeGreaterThan(0);
    foam.update(.75);
    expect(positions(foam)).not.toEqual(still);
    const advanced = positions(foam);
    foam.update(6.75);
    expect(positions(foam)).toEqual(advanced);
    expect(map).toEqual(before);
  } finally {
    for (const model of [foam, repeated, varied]) model.mesh.geometry.dispose();
  }
});

test('repeated still updates do not upload geometry or allocate new buffers', () => {
  const foam = new CoastalFoam(generateIsland(1));
  try {
    const geometry = foam.mesh.geometry;
    const attribute = geometry.attributes.position as T.BufferAttribute;
    const version = attribute.version;
    const array = attribute.array;
    foam.update(0);
    foam.update(0);
    expect(attribute.version).toBe(version);
    foam.update(1);
    expect(attribute.version).toBe(version + 1);
    foam.update(1);
    expect(attribute.version).toBe(version + 1);
    expect(attribute.array).toBe(array);
    expect(foam.mesh.geometry).toBe(geometry);
  } finally {
    foam.mesh.geometry.dispose();
  }
});

test('foam stays at the waterline, faces upward, and fits its fixed bounds on several seeds', () => {
  for (const seed of [1, 2, 8, 37]) {
    const foam = new CoastalFoam(generateIsland(seed));
    try {
      expect(foam.mesh.geometry.index!.count / 3).toBeLessThan(4000);
      expect(foam.mesh.material).toBe(material(colors.cream));
      expect(foam.mesh.material.transparent).toBe(false);
      expect(foam.mesh.castShadow).toBe(false);
      const bounds = foam.mesh.geometry.boundingBox!.clone().expandByScalar(1e-5);
      for (const time of [0, 1, 2, 3, 4, 5, 6]) {
        foam.update(time);
        const position = foam.mesh.geometry.attributes.position;
        for (let index = 0; index < position.count; index++) {
          const point = new T.Vector3().fromBufferAttribute(position, index);
          expect(bounds.containsPoint(point)).toBe(true);
          expect(point.y).toBeCloseTo(-.035, 5);
        }
        expect(area(foam)).toBeGreaterThan(0);
      }
    } finally {
      foam.mesh.geometry.dispose();
    }
  }
});

test('an empty sea has no foam or invalid bounds', () => {
  const map: IslandMap = { seed: 1, width: 1, depth: 1, terrain: ['water'], level: new Uint8Array(1), entry: { x: 0, z: 0 } };
  const foam = new CoastalFoam(map);
  try {
    foam.update(4);
    expect(positions(foam)).toEqual([]);
    expect(foam.mesh.geometry.boundingSphere!.isEmpty()).toBe(true);
  } finally {
    foam.mesh.geometry.dispose();
  }
});
